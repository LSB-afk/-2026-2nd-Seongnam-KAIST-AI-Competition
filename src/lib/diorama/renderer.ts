import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildCityModel } from './city-model';
import { CITY_OVERVIEW, getCityCamera, getCityMarkers, projectCityCoordinate, type CityMarker } from './city-data';
import { normaliseDiorama, selectionStopId, type CameraPreset, type DioramaSelection } from './data';
import type { TourSettings, TourStatus } from './tour';
import urbanIndex from './seongnam-urban-index.json';

type UrbanLabel = { id: string; coordinates: readonly [number, number]; name: string; point: THREE.Vector3 };
const urbanPlaces = (urbanIndex.pois as unknown as { id: string; coordinates: [number, number]; tags: Record<string, string> }[])
  .filter(poi => poi.tags.shop || ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court'].includes(poi.tags.amenity))
  .map((poi): UrbanLabel => { const [x, , z] = projectCityCoordinate(...poi.coordinates); return { id: poi.id, coordinates: poi.coordinates, name: poi.tags.name, point: new THREE.Vector3(x, .15, z) }; });

export type RenderOptions = TourSettings & { requestId: number; phase: TourStatus; reducedMotion: boolean };
export type RenderCallbacks = {
  onReady: (stopId: string, requestId: number) => void;
  onArrived: (stopId: string, requestId: number) => void;
  onManual: () => void;
  onHidden?: () => void;
  onSelect?: (selection: DioramaSelection) => void;
  onHotspot: (id: string) => void;
  onUrbanSelect?: (id: string) => void;
  onError: (message: string) => void;
};

/** Owns one canvas, one scene, and all the model resources attached to it. */
export function createDioramaRenderer(host: HTMLDivElement, callbacks: RenderCallbacks) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  let disposed = false;
  let lost = false;
  const cleanups: (() => void)[] = [() => renderer.dispose(), () => renderer.domElement.remove(), () => renderer.setAnimationLoop(null)];
  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const cleanup of cleanups.reverse()) {
      try { cleanup(); } catch { /* Finish releasing other resources if the context is already unusable. */ }
    }
    cleanups.length = 0;
  }
  function fail(message: string) {
    if (disposed || lost) return;
    lost = true;
    dispose();
    callbacks.onError(message);
  }
  try {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.domElement.setAttribute('aria-label', '드래그로 회전하고 두 손가락으로 확대하는 성남 입체 모형');
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    const labelLayer = document.createElement('div');
    cleanups.push(() => labelLayer.remove());
    labelLayer.className = 'diorama-label-layer';
    host.appendChild(labelLayer);
    const scene = new THREE.Scene();
    cleanups.push(() => scene.clear());
    const camera = new THREE.OrthographicCamera(-25, 25, 18, -18, .1, 1500);
    const controls = new OrbitControls(camera, renderer.domElement);
    cleanups.push(() => controls.dispose());
    controls.enableDamping = true;
    controls.dampingFactor = .12;
    controls.minPolarAngle = .15;
    controls.maxPolarAngle = Math.PI / 2.15;
    controls.autoRotateSpeed = .22;
    controls.enablePan = true;
    controls.zoomSpeed = .7;
    controls.rotateSpeed = .55;
    scene.add(new THREE.HemisphereLight(0xeef7ff, 0x7c876a, 2.8));
    const sun = new THREE.DirectionalLight(0xfff3d6, 4);
    cleanups.push(() => sun.shadow.map?.dispose());
    sun.position.set(-180, 330, 200);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -180, right: 180, top: 180, bottom: -180, near: 1, far: 1000 });
    sun.shadow.bias = -.00025;
    sun.shadow.normalBias = .04;
    scene.add(sun);
    let dirty = true;
    let model: ReturnType<typeof buildCityModel> | null = null;
    cleanups.push(() => { model?.dispose(); model = null; });
    let selection: DioramaSelection | null = null;
    let options: RenderOptions | null = null;
    let appliedKey = '', readyKey = '';
    let interrupted = document.hidden;
    let manualInterrupted = false;
    let width = 1, height = 1, lastTime = 0, fitZoom = 1, modelElapsed = 0;
    let modelBounds = new THREE.Box3();
    let labels: { button: HTMLButtonElement; point: THREE.Vector3; marker: CityMarker; key: string }[] = [];
    let transition: { elapsed: number; duration: number; position: THREE.Vector3; target: THREE.Vector3; zoom: number; destination: CameraPreset; endZoom: number; stopId: string; requestId: number } | null = null;
    cleanups.push(() => { transition = null; labels = []; });
    const urbanLabels = Array.from({ length: 24 }, () => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'diorama-pin diorama-urban-pin'; button.hidden = true;
      labelLayer.appendChild(button);
      const entry: { button: HTMLButtonElement; place?: UrbanLabel } = { button };
      button.onclick = () => { if (entry.place) { focusCoordinate(entry.place.coordinates); callbacks.onUrbanSelect?.(entry.place.id); } };
      return entry;
    });
    let urbanTarget = new THREE.Vector3(Infinity, Infinity, Infinity), urbanZoom = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number; id: number } | null = null;

    function currentPreset() {
      return selection ? getCityCamera(selection) : CITY_OVERVIEW;
    }

    function measureFit(preset: CameraPreset): number {
      const measuring = camera.clone();
      measuring.position.fromArray(preset.position);
      measuring.lookAt(...preset.target);
      measuring.updateMatrixWorld(true);
      const projected = new THREE.Box3();
      for (const x of [modelBounds.min.x, modelBounds.max.x]) for (const y of [modelBounds.min.y, modelBounds.max.y]) for (const z of [modelBounds.min.z, modelBounds.max.z]) {
        projected.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(measuring.matrixWorldInverse));
      }
      // Account for bounds that are not centered on the geographic overview target.
      const extentX = 2 * Math.max(Math.abs(projected.min.x), Math.abs(projected.max.x), .5);
      const extentY = 2 * Math.max(Math.abs(projected.min.y), Math.abs(projected.max.y), .5);
      return Math.min((camera.right - camera.left) / extentX, (camera.top - camera.bottom) / extentY) * .94;
    }

    function updateLabels() {
      if (!options) return;
      camera.updateMatrixWorld();
      const placed: { left: number; right: number; top: number; bottom: number }[] = [];
      for (const entry of labels) {
        const projected = entry.point.clone().project(camera);
        const visible = options.labels && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
        entry.button.hidden = !visible;
        if (visible) {
          const x = (projected.x + 1) * width / 2;
          const y = (1 - projected.y) * height / 2;
          const labelWidth = entry.button.offsetWidth || 110;
          const labelHeight = entry.button.offsetHeight || 34;
          // Keep all three district names legible at overview before considering landmarks.
          const offsets = entry.marker.kind === 'district' || entry.marker.kind === 'hotspot'
            ? [[0, 0], [0, -labelHeight - 10], [0, labelHeight + 10], [0, -2 * (labelHeight + 10)], [0, 2 * (labelHeight + 10)], [-labelWidth / 2 - 8, 0], [labelWidth / 2 + 8, 0]]
            : [[0, 0]];
          let fitted = false;
          for (const [dx, dy] of offsets) {
            const candidate = { left: x + dx - labelWidth / 2, right: x + dx + labelWidth / 2, top: y + dy - labelHeight, bottom: y + dy };
            if (candidate.left < 12 || candidate.right > width - 12 || candidate.top < 58 || candidate.bottom > height - 44) continue;
            if (placed.some(other => candidate.left < other.right + 8 && candidate.right > other.left - 8 && candidate.top < other.bottom + 8 && candidate.bottom > other.top - 8)) continue;
            placed.push(candidate);
            entry.button.style.transform = `translate(${x + dx}px,${y + dy}px) translate(-50%,-100%)`;
            fitted = true;
            break;
          }
          entry.button.hidden = !fitted;
        }
      }
      const closeEnough = camera.zoom / fitZoom >= 12;
      if (options.labels && closeEnough && (urbanTarget.distanceToSquared(controls.target) > .04 || Math.abs(urbanZoom - camera.zoom / fitZoom) > 1)) {
        urbanTarget = controls.target.clone(); urbanZoom = camera.zoom / fitZoom;
        const radius = 145 / urbanZoom;
        const candidates = urbanPlaces.filter(place => Math.hypot(place.point.x - urbanTarget.x, place.point.z - urbanTarget.z) < radius)
          .sort((a, b) => a.point.distanceToSquared(urbanTarget) - b.point.distanceToSquared(urbanTarget)).slice(0, urbanLabels.length);
        urbanLabels.forEach((entry, index) => {
          entry.place = candidates[index];
          entry.button.textContent = entry.place?.name ?? '';
          entry.button.setAttribute('aria-label', `${entry.place?.name ?? ''} 가게 위치 보기`);
          entry.button.setAttribute('data-urban-poi', entry.place?.id ?? '');
        });
      }
      for (const entry of urbanLabels) {
        entry.button.hidden = true;
        if (!options.labels || !closeEnough || !entry.place) continue;
        const point = entry.place.point.clone().project(camera);
        if (Math.abs(point.x) >= 1 || Math.abs(point.y) >= 1 || point.z < -1 || point.z > 1) continue;
        const x = (point.x + 1) * width / 2, y = (1 - point.y) * height / 2;
        entry.button.hidden = false;
        const w = entry.button.offsetWidth || 105, h = entry.button.offsetHeight || 28;
        const box = { left: x - w / 2, right: x + w / 2, top: y - h, bottom: y };
        if (box.left < 12 || box.right > width - 12 || box.top < 58 || box.bottom > height - 44 || placed.some(other => box.left < other.right + 8 && box.right > other.left - 8 && box.top < other.bottom + 8 && box.bottom > other.top - 8)) {
          entry.button.hidden = true;
          continue;
        }
        placed.push(box);
        entry.button.style.transform = `translate(${x}px,${y}px) translate(-50%,-100%)`;
      }
    }

    function select(next: DioramaSelection) {
      if (disposed || lost) return;
      if (callbacks.onSelect) callbacks.onSelect(next);
      else if (next.placeId === selection?.placeId && next.hotspotId) callbacks.onHotspot(next.hotspotId);
    }

    function makeLabels() {
      if (!selection) return;
      const previous = new Map(labels.map(entry => [entry.key, entry]));
      labels = getCityMarkers(selection).map(marker => {
        const key = `${marker.kind}:${marker.selection.placeId}:${marker.id}`;
        let entry = previous.get(key);
        previous.delete(key);
        if (!entry) {
          const button = document.createElement('button');
          button.type = 'button'; button.className = 'diorama-pin';
          button.hidden = true;
          entry = { button, point: new THREE.Vector3(...marker.point), marker, key };
          button.onclick = () => select(entry!.marker.selection);
          labelLayer.appendChild(button);
        }
        entry.marker = marker; entry.point.fromArray(marker.point);
        entry.button.textContent = marker.label;
        entry.button.setAttribute('aria-label', `${marker.label} ${marker.kind === 'landmark' ? '모형 선택' : marker.kind === 'district' ? '모형에서 보기' : '관찰'}`);
        entry.button.setAttribute('aria-pressed', String(selectionStopId(marker.selection) === selectionStopId(selection!)));
        entry.button.setAttribute('data-city-marker', marker.id);
        entry.button.setAttribute('data-city-kind', marker.kind);
        entry.button.setAttribute('data-city-place', marker.selection.placeId);
        return entry;
      });
      previous.forEach(entry => { entry.button.onclick = null; entry.button.remove(); });
      const priority = (entry: typeof labels[number]) => entry.marker.kind === 'hotspot' && entry.marker.selection.hotspotId === selection?.hotspotId ? 0
        : entry.marker.kind === 'district' && entry.marker.selection.hotspotId === selection?.hotspotId ? 1
          : entry.marker.kind === 'district' ? 2 : entry.marker.kind === 'hotspot' ? 3 : 4;
      labels.sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
    }

    function arrive(stopId: string, requestId: number) {
      queueMicrotask(() => {
        if (!disposed && !lost && !interrupted && !document.hidden && selection && selectionStopId(selection) === stopId && options?.requestId === requestId && options.phase === 'transition') callbacks.onArrived(stopId, requestId);
      });
    }

    function focus(preset: CameraPreset, animate: boolean) {
      if (!options || !selection) return;
      const stopId = selectionStopId(selection), requestId = options.requestId;
      fitZoom = measureFit(CITY_OVERVIEW);
      controls.minZoom = fitZoom * .55;
      controls.maxZoom = fitZoom * 100;
      const endZoom = fitZoom * preset.zoom;
      if (animate && options.motion && !options.reducedMotion) {
        transition = { elapsed: 0, duration: 1250 / options.speed, position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, destination: preset, endZoom, stopId, requestId };
      } else {
        transition = null;
        camera.position.fromArray(preset.position);
        controls.target.fromArray(preset.target);
        camera.zoom = endZoom;
        camera.updateProjectionMatrix();
        controls.update();
        arrive(stopId, requestId);
      }
      dirty = true;
    }

    function resize() {
      if (disposed) return;
      const box = host.getBoundingClientRect();
      width = Math.max(1, box.width); height = Math.max(1, box.height);
      renderer.setSize(width, height);
      const aspect = width / height;
      camera.left = -18 * aspect; camera.right = 18 * aspect;
      camera.top = 18; camera.bottom = -18;
      camera.updateProjectionMatrix();
      if (model && selection) {
        const newFit = measureFit(CITY_OVERVIEW);
        camera.zoom *= newFit / Math.max(fitZoom, .001);
        fitZoom = newFit;
        controls.minZoom = fitZoom * .55; controls.maxZoom = fitZoom * 100;
        if (transition) transition.endZoom = fitZoom * transition.destination.zoom;
        camera.updateProjectionMatrix();
      }
      dirty = true;
    }

    function apply(nextSelection: DioramaSelection, nextOptions: RenderOptions) {
      if (disposed || lost) return;
      const initialCity = model === null;
      const changedSelection = !selection || selectionStopId(selection) !== selectionStopId(nextSelection);
      const stopId = selectionStopId(nextSelection);
      const paused = nextOptions.phase === 'paused' || nextOptions.phase === 'manual' || nextOptions.phase === 'error';
      const key = `${stopId}:${nextOptions.requestId}:${nextOptions.phase}`;
      const changedIntent = key !== appliedKey;
      selection = nextSelection; options = nextOptions;
      if (changedIntent) {
        lastTime = 0;
        controls.autoRotate = false;
        if (!document.hidden && !paused) { interrupted = false; manualInterrupted = false; }
      }
      controls.enableDamping = nextOptions.motion && !nextOptions.reducedMotion && !paused;
      if (initialCity) {
        transition = null;
        model = buildCityModel();
        modelElapsed = 0;
        scene.add(model.group);
        modelBounds = new THREE.Box3().setFromObject(model.group);
        if (modelBounds.isEmpty()) throw new Error('입체 모형을 준비하지 못했어요.');
        camera.position.fromArray(CITY_OVERVIEW.position);
        controls.target.fromArray(CITY_OVERVIEW.target);
        fitZoom = measureFit(CITY_OVERVIEW);
        camera.zoom = fitZoom;
        controls.minZoom = fitZoom * .55; controls.maxZoom = fitZoom * 100;
        camera.updateProjectionMatrix();
        controls.update();
        renderer.shadowMap.needsUpdate = true;
      }
      if (changedSelection || initialCity) makeLabels();
      if (model) {
        model.visitors.visible = options.tourists;
        if (model.traffic) model.traffic.visible = options.traffic;
        model.configurePopulation?.({ density: options.density, peopleScale: options.peopleScale });
      }
      const nextReadyKey = `${stopId}:${nextOptions.requestId}`;
      // A stop can load while paused; the reducer needs readiness again on resume.
      if (nextReadyKey !== readyKey || (changedIntent && nextOptions.phase === 'loading')) {
        readyKey = nextReadyKey;
        queueMicrotask(() => { if (!disposed && !lost && options?.requestId === nextOptions.requestId && selection && selectionStopId(selection) === stopId) callbacks.onReady(stopId, nextOptions.requestId); });
      }
      if (changedIntent) {
        appliedKey = key;
        transition = null;
        if (!paused && !interrupted && (options.phase === 'transition' || (options.phase === 'idle' && (changedSelection || initialCity)))) focus(currentPreset(), !initialCity);
      }
      if (transition && (!options.motion || options.reducedMotion)) focus(currentPreset(), false);
      dirty = true;
    }

    function manual() {
      if (disposed || lost) return;
      manualInterrupted = true;
      transition = null;
      controls.autoRotate = false;
      callbacks.onManual();
      dirty = true;
    }
    controls.addEventListener('start', manual);
    cleanups.push(() => controls.removeEventListener('start', manual));
    const changed = () => { dirty = true; };
    controls.addEventListener('change', changed);
    cleanups.push(() => controls.removeEventListener('change', changed));
    const down = (event: PointerEvent) => { pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId }; };
    const up = (event: PointerEvent) => {
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const start = pointerStart; pointerStart = null;
      if (!model || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
      const bounds = renderer.domElement.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / bounds.width * 2 - 1, 1 - (event.clientY - bounds.top) / bounds.height * 2);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(model.pickTargets, true)[0];
      let object: THREE.Object3D | undefined = hit?.object;
      let hotspotId: string | null = null, placeId: string | null = null;
      while (object) {
        if (!hotspotId && typeof object.userData.hotspotId === 'string') hotspotId = object.userData.hotspotId;
        if (!placeId && typeof object.userData.placeId === 'string') placeId = object.userData.placeId;
        object = object.parent ?? undefined;
      }
      if (placeId) select(normaliseDiorama({ placeId, hotspotId }));
      else if (hotspotId) callbacks.onHotspot(hotspotId);
    };
    const keydown = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
      event.preventDefault(); manual();
      if (event.key === 'Home') focus(currentPreset(), false);
      else if (event.key === '+' || event.key === '=') zoom(1.2);
      else if (event.key === '-') zoom(1 / 1.2);
      else {
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        if (event.key === 'ArrowLeft') spherical.theta -= .12;
        if (event.key === 'ArrowRight') spherical.theta += .12;
        if (event.key === 'ArrowUp') spherical.phi = Math.max(.15, spherical.phi - .1);
        if (event.key === 'ArrowDown') spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + .1);
        camera.position.copy(controls.target).add(offset.setFromSpherical(spherical)); controls.update();
      }
    };
    renderer.domElement.addEventListener('pointerdown', down);
    cleanups.push(() => renderer.domElement.removeEventListener('pointerdown', down));
    renderer.domElement.addEventListener('pointerup', up);
    cleanups.push(() => renderer.domElement.removeEventListener('pointerup', up));
    renderer.domElement.addEventListener('keydown', keydown);
    cleanups.push(() => renderer.domElement.removeEventListener('keydown', keydown));
    const contextLost = (event: Event) => {
      event.preventDefault();
      fail('입체 화면 연결이 끊겼어요. 사진과 정보를 먼저 살펴보거나 다시 불러와 주세요.');
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);
    cleanups.push(() => renderer.domElement.removeEventListener('webglcontextlost', contextLost));
    function zoom(factor: number) {
      if (disposed || lost || !Number.isFinite(factor) || factor <= 0) return;
      manual(); camera.zoom = THREE.MathUtils.clamp(camera.zoom * factor, controls.minZoom, controls.maxZoom); camera.updateProjectionMatrix(); controls.update();
    }
    function focusCoordinate(coordinate: readonly [number, number]) {
      const [longitude, latitude] = coordinate;
      if (disposed || lost || !model || !selection || !options || !Number.isFinite(longitude) || !Number.isFinite(latitude)) return;
      const [west, south, east, north] = urbanIndex.metadata.bbox;
      if (longitude < west || longitude > east || latitude < south || latitude > north) return;
      manual();
      const target = projectCityCoordinate(longitude, latitude);
      focus({ position: [target[0] + 220, 265, target[2] + 260], target, zoom: 55 }, false);
    }
    function renderFrame(time: number) {
      if (disposed || lost || document.hidden || !options || !model) return;
      const delta = lastTime ? THREE.MathUtils.clamp((time - lastTime) / 1000, 0, .1) : 0;
      lastTime = time;
      const paused = interrupted || options.phase === 'paused' || options.phase === 'error';
      const moving = options.motion && !options.reducedMotion && !paused;
      if (moving) modelElapsed += delta;
      model.update(modelElapsed, moving);
      if (transition && !paused) {
        const active = transition;
        active.elapsed += delta * 1000;
        const t = Math.min(1, active.elapsed / active.duration);
        const eased = t * t * (3 - 2 * t);
        camera.position.lerpVectors(active.position, new THREE.Vector3(...active.destination.position), eased);
        controls.target.lerpVectors(active.target, new THREE.Vector3(...active.destination.target), eased);
        camera.zoom = THREE.MathUtils.lerp(active.zoom, active.endZoom, eased);
        camera.updateProjectionMatrix(); dirty = true;
        if (t === 1) { transition = null; arrive(active.stopId, active.requestId); }
      }
      controls.autoRotate = !manualInterrupted && !transition && moving && options.phase === 'dwelling';
      const controlsChanged = paused ? false : controls.update(delta);
      if (dirty || controlsChanged || (moving && (options.tourists || options.traffic)) || transition || controls.autoRotate) {
        renderer.render(scene, camera); updateLabels(); dirty = false;
      }
    }
    function frame(time: number) {
      try { renderFrame(time); }
      catch { fail('입체 화면을 표시하는 중 문제가 생겼어요. 사진과 장소 정보는 계속 볼 수 있어요.'); }
    }
    const visibility = () => {
      if (disposed || lost) return;
      lastTime = 0;
      if (document.hidden) {
        interrupted = true; transition = null; controls.autoRotate = false;
        callbacks.onHidden?.();
      }
      renderer.setAnimationLoop(document.hidden || disposed || lost ? null : frame);
      if (!document.hidden) dirty = true;
    };
    document.addEventListener('visibilitychange', visibility);
    cleanups.push(() => document.removeEventListener('visibilitychange', visibility));
    const observer = new ResizeObserver(() => {
      try { resize(); } catch { fail('입체 화면 크기를 조정하지 못했어요. 다시 불러와 주세요.'); }
    });
    cleanups.push(() => observer.disconnect());
    observer.observe(host); resize(); visibility();
    return {
      apply: (nextSelection: DioramaSelection, nextOptions: RenderOptions) => {
        try { apply(nextSelection, nextOptions); }
        catch { fail('입체 모형을 불러오지 못했어요. 실제 사진과 장소 정보를 확인해 주세요.'); }
      },
      zoom,
      focusCoordinate,
      reset: () => { if (!disposed && !lost) { manual(); focus(currentPreset(), false); } },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export type DioramaRenderer = ReturnType<typeof createDioramaRenderer>;
