import * as THREE from 'three';
import { MapControls } from 'three/addons/controls/MapControls.js';
import { buildCityModel } from './city-model';
import { CITY_DISTRICTS, CITY_OVERVIEW, getCityCamera, getCityMarkers, projectCityCoordinate, type CityMarker } from './city-data';
import { normaliseDiorama, selectionStopId, type CameraPreset, type DioramaSelection } from './data';
import type { TourSettings, TourStatus } from './tour';
import urbanIndex from './seongnam-urban-index.json';
import { getPlace } from '../places';
import { storyCameraSchema, type StoryCameraView } from '../city-story';
import { decorateLandmarkButton } from './landmark-visuals';
import { CITY_FOOD_PLACES } from '../city-food';

type UrbanLabel = { id: string; coordinates: readonly [number, number]; name: string; point: THREE.Vector3; category: 'cafe' | 'restaurant' | 'bar' | 'shop' };
const urbanPlaces = (urbanIndex.pois as unknown as { id: string; coordinates: [number, number]; tags: Record<string, string> }[])
  .filter(poi => poi.tags.shop || ['restaurant', 'cafe', 'fast_food', 'bar', 'pub', 'food_court'].includes(poi.tags.amenity))
  .map((poi): UrbanLabel => {
    const [x, , z] = projectCityCoordinate(...poi.coordinates);
    const category = poi.tags.amenity === 'cafe' ? 'cafe' : ['bar', 'pub'].includes(poi.tags.amenity) ? 'bar' : ['restaurant', 'fast_food', 'food_court'].includes(poi.tags.amenity) ? 'restaurant' : 'shop';
    return { id: poi.id, coordinates: poi.coordinates, name: poi.tags.name, point: new THREE.Vector3(x, .15, z), category };
  });
const foodSymbol = (category: UrbanLabel['category']) => category === 'cafe' ? '☕' : category === 'bar' ? '🍷' : category === 'restaurant' ? '🍽' : '▣';

export type NavigationMode = 'pan' | 'rotate';
export type RenderOptions = TourSettings & {
  requestId: number; phase: TourStatus; reducedMotion: boolean; navigationMode?: NavigationMode;
  storyStops?: readonly { placeId: string }[];
  storyFocus?: { requestId: number; placeId: string; camera?: StoryCameraView };
  hoveredDistrictId?: string | null;
};
export type RenderCallbacks = {
  onReady: (stopId: string, requestId: number) => void;
  onArrived: (stopId: string, requestId: number) => void;
  onManual: () => void;
  onHidden?: () => void;
  onSelect?: (selection: DioramaSelection) => void;
  onHotspot: (id: string) => void;
  onUrbanSelect?: (id: string) => void;
  onFood?: (id: string) => void;
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
    renderer.domElement.setAttribute('aria-label', '드래그로 이동하고 휠이나 두 손가락으로 확대하는 성남 입체 지도');
    renderer.domElement.tabIndex = 0;
    host.appendChild(renderer.domElement);
    const labelLayer = document.createElement('div');
    cleanups.push(() => labelLayer.remove());
    labelLayer.className = 'diorama-label-layer';
    host.appendChild(labelLayer);
    const centerIndicator = document.createElement('span');
    centerIndicator.className = 'diorama-center-indicator';
    centerIndicator.setAttribute('aria-hidden', 'true');
    centerIndicator.hidden = true;
    host.appendChild(centerIndicator);
    let centerTimer: ReturnType<typeof setTimeout> | undefined;
    cleanups.push(() => { clearTimeout(centerTimer); centerIndicator.remove(); });
    const scene = new THREE.Scene();
    cleanups.push(() => scene.clear());
    const camera = new THREE.OrthographicCamera(-25, 25, 18, -18, .1, 1500);
    // Include HTML place labels in the same gesture surface as the canvas.
    const controls = new MapControls(camera, host);
    cleanups.push(() => controls.dispose());
    controls.enableDamping = false;
    controls.minPolarAngle = .02;
    controls.maxPolarAngle = Math.PI / 2.6;
    controls.autoRotateSpeed = .22;
    controls.enablePan = true;
    controls.zoomToCursor = true;
    controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
    controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
    controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
    controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
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
    let transition: { elapsed: number; duration: number; position: THREE.Vector3; target: THREE.Vector3; zoom: number; destination: CameraPreset; endZoom: number; stopId: string; requestId: number; story: boolean } | null = null;
    let lastStoryRequestId: number | undefined;
    let storyKey = '';
    let storyLine: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial> | null = null;
    let storyOrder = new Map<string, number>();
    const releaseStoryLine = () => { storyLine?.removeFromParent(); storyLine?.geometry.dispose(); storyLine?.material.dispose(); storyLine = null; };
    cleanups.push(releaseStoryLine);
    cleanups.push(() => { transition = null; labels = []; });
    const urbanLabels = Array.from({ length: 24 }, () => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'diorama-pin diorama-urban-pin'; button.hidden = true;
      labelLayer.appendChild(button);
      const entry: { button: HTMLButtonElement; place?: UrbanLabel } = { button };
      button.onclick = () => { if (!disposed && !lost && entry.place) { focusCoordinate(entry.place.coordinates); callbacks.onUrbanSelect?.(entry.place.id); } };
      return entry;
    });
    const foodLabels = CITY_FOOD_PLACES.flatMap(food => {
      const [west, south, east, north] = urbanIndex.metadata.bbox;
      if (food.lng === null || food.lat === null || !Number.isFinite(food.lng) || !Number.isFinite(food.lat) || food.lng < west || food.lng > east || food.lat < south || food.lat > north) return [];
      const [x, , z] = projectCityCoordinate(food.lng, food.lat);
      const place: UrbanLabel = { id: food.id, coordinates: [food.lng, food.lat], name: food.name, point: new THREE.Vector3(x, .2, z), category: food.category };
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'diorama-pin diorama-food-pin'; button.hidden = true;
      button.textContent = `${foodSymbol(food.category)} ${food.name}`;
      button.setAttribute('aria-label', `${food.name} 먹거리 정보 보기`);
      button.setAttribute('title', `${food.badge}${food.sourceDate ? ` · ${food.sourceDate}` : ''}`);
      button.setAttribute('data-city-food', food.id); button.setAttribute('data-food-category', food.category);
      button.onclick = () => { if (!disposed && !lost) { focusCoordinate(place.coordinates); callbacks.onFood?.(food.id); } };
      labelLayer.appendChild(button);
      return [{ button, place }];
    });
    cleanups.push(() => { for (const entry of [...urbanLabels, ...foodLabels]) entry.button.onclick = null; });
    let urbanTarget = new THREE.Vector3(Infinity, Infinity, Infinity), urbanZoom = 0;
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    const activePointers = new Set<number>();
    let pointerStart: { x: number; y: number; id: number; dragged: boolean; button?: HTMLButtonElement } | null = null;
    let hoveredDistrictId: string | null = null;
    const groundPlane = new THREE.Plane();

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
      const priority = (entry: typeof labels[number]) => entry.marker.kind === 'hotspot' && entry.marker.selection.hotspotId === selection?.hotspotId ? 0
        : entry.marker.kind === 'district' && entry.marker.selection.hotspotId === selection?.hotspotId ? 1
          : entry.marker.kind === 'landmark' && entry.marker.selection.placeId === selection?.placeId ? 2
            : entry.marker.kind === 'district' ? 3 : storyOrder.has(entry.marker.selection.placeId) ? 4 : entry.marker.kind === 'hotspot' ? 5 : 6;
      const ordered = [...labels].sort((a, b) => priority(a) - priority(b) || a.point.distanceToSquared(controls.target) - b.point.distanceToSquared(controls.target) || a.key.localeCompare(b.key));
      for (const entry of ordered) {
        const projected = entry.point.clone().project(camera);
        const visible = options.labels && projected.z >= -1 && projected.z <= 1 && Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1;
        entry.button.hidden = !visible;
        if (visible) {
          const x = (projected.x + 1) * width / 2;
          const y = (1 - projected.y) * height / 2;
          const labelWidth = entry.button.offsetWidth || 110;
          const labelHeight = entry.button.offsetHeight || 34;
          // Keep all three district names legible at overview before considering landmarks.
          const offsets = entry.marker.kind === 'district' || entry.marker.kind === 'hotspot' || entry.marker.selection.placeId === selection?.placeId || storyOrder.has(entry.marker.selection.placeId)
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
          entry.button.textContent = entry.place ? `${foodSymbol(entry.place.category)} ${entry.place.name}` : '';
          entry.button.setAttribute('data-food-category', entry.place?.category ?? 'shop');
          entry.button.setAttribute('aria-label', `${entry.place?.name ?? ''} 가게 위치 보기`);
          entry.button.setAttribute('data-urban-poi', entry.place?.id ?? '');
        });
      }
      for (const entry of [...foodLabels, ...urbanLabels]) {
        entry.button.hidden = true;
        const minimumZoom = foodLabels.includes(entry as typeof foodLabels[number]) ? 5 : 12;
        if (!options.labels || camera.zoom / fitZoom < minimumZoom || !entry.place) continue;
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
      const markers = getCityMarkers(selection);
      const currentPlace = getPlace(selection.placeId);
      if (currentPlace && !markers.some(marker => marker.kind === 'landmark' && marker.selection.placeId === currentPlace.id)) {
        const [x, , z] = projectCityCoordinate(currentPlace.lng, currentPlace.lat);
        markers.push({ id: currentPlace.id, label: currentPlace.name, point: [x, 3.5, z], kind: 'landmark', selection: { placeId: currentPlace.id, hotspotId: null } });
      }
      labels = markers.map(marker => {
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
        const place = marker.kind === 'landmark' ? getPlace(marker.selection.placeId) : undefined;
        // Whole-city labels formerly floated 350m above the source point, which
        // projects outside a street-level camera. Keep photo pins near the ground.
        if (place && marker.id === place.id) entry.point.y = .4;
        if (place) decorateLandmarkButton(entry.button, place, storyOrder.get(place.id));
        else entry.button.textContent = marker.label;
        entry.button.setAttribute('aria-label', `${marker.label} ${marker.kind === 'landmark' ? '모형 선택' : marker.kind === 'district' ? '모형에서 보기' : '관찰'}`);
        entry.button.setAttribute('aria-pressed', String(selectionStopId(marker.selection) === selectionStopId(selection!)));
        entry.button.setAttribute('data-city-marker', marker.id);
        entry.button.setAttribute('data-city-kind', marker.kind);
        entry.button.setAttribute('data-city-place', marker.selection.placeId);
        entry.button.setAttribute('data-selected-place', String(marker.selection.placeId === selection?.placeId));
        return entry;
      });
      previous.forEach(entry => { entry.button.onclick = null; entry.button.remove(); });
      const priority = (entry: typeof labels[number]) => entry.marker.kind === 'hotspot' && entry.marker.selection.hotspotId === selection?.hotspotId ? 0
        : entry.marker.kind === 'district' && entry.marker.selection.hotspotId === selection?.hotspotId ? 1
          : entry.marker.kind === 'district' ? 2 : entry.marker.kind === 'hotspot' ? 3 : 4;
      labels.sort((a, b) => priority(a) - priority(b) || a.key.localeCompare(b.key));
    }

    function updateStory(stops: RenderOptions['storyStops']): boolean {
      const places = (stops ?? []).slice(0, 30).flatMap(stop => { const place = getPlace(stop.placeId); return place ? [place] : []; });
      const key = places.map(place => place.id).join('|');
      if (key === storyKey) return false;
      storyKey = key; storyOrder = new Map(places.map((place, index) => [place.id, index + 1]));
      releaseStoryLine();
      if (places.length > 1) {
        const points = places.map(place => { const [x, , z] = projectCityCoordinate(place.lng, place.lat); return new THREE.Vector3(x, .4, z); });
        const geometry = new THREE.BufferGeometry().setFromPoints(points);
        const material = new THREE.LineDashedMaterial({ color: '#b27835', dashSize: .65, gapSize: .4, transparent: true, opacity: .85, depthTest: false, depthWrite: false });
        storyLine = new THREE.Line(geometry, material);
        storyLine.name = 'city-story-order'; storyLine.renderOrder = 5;
        storyLine.userData = { purpose: '이야기 순서', placeIds: places.map(place => place.id) };
        storyLine.computeLineDistances(); scene.add(storyLine);
      }
      return true;
    }

    function arrive(stopId: string, requestId: number) {
      queueMicrotask(() => {
        if (!disposed && !lost && !interrupted && !document.hidden && selection && selectionStopId(selection) === stopId && options?.requestId === requestId && options.phase === 'transition') callbacks.onArrived(stopId, requestId);
      });
    }

    function focus(preset: CameraPreset, animate: boolean, story = false) {
      if (!options || !selection) return;
      const stopId = selectionStopId(selection), requestId = options.requestId;
      fitZoom = measureFit(CITY_OVERVIEW);
      controls.minZoom = fitZoom * .55;
      controls.maxZoom = fitZoom * 100;
      const endZoom = fitZoom * preset.zoom;
      if (animate && options.motion && !options.reducedMotion) {
        transition = { elapsed: 0, duration: 1250 / options.speed, position: camera.position.clone(), target: controls.target.clone(), zoom: camera.zoom, destination: preset, endZoom, stopId, requestId, story };
      } else {
        transition = null;
        camera.position.fromArray(preset.position);
        controls.target.fromArray(preset.target);
        camera.zoom = endZoom;
        camera.updateProjectionMatrix();
        controls.update();
        if (!story) arrive(stopId, requestId);
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
        const scale = newFit / Math.max(fitZoom, .001);
        camera.zoom *= scale;
        fitZoom = newFit;
        controls.minZoom = fitZoom * .55; controls.maxZoom = fitZoom * 100;
        if (transition) { transition.zoom *= scale; transition.endZoom = fitZoom * transition.destination.zoom; }
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
      if (options?.storyFocus && !nextOptions.storyFocus && transition?.story) transition = null;
      selection = nextSelection; options = nextOptions;
      if (changedIntent) {
        lastTime = 0;
        controls.autoRotate = false;
        if (!document.hidden && !paused) { interrupted = false; manualInterrupted = false; }
      }
      const pan = nextOptions.navigationMode !== 'rotate';
      controls.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
      controls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
      controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE;
      controls.touches.ONE = pan ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
      controls.cursorStyle = pan ? 'grab' : 'auto';
      renderer.domElement.setAttribute('aria-label', '왼쪽 끌기로 이동하고 휠 버튼 끌기로 회전하며 휠로 확대하는 성남 입체 지도');
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
      const changedStory = updateStory(options.storyStops);
      if (changedSelection || initialCity || changedStory) makeLabels();
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
      const storyIntent = options.storyFocus;
      if (storyIntent && Number.isFinite(storyIntent.requestId) && storyIntent.requestId !== lastStoryRequestId) {
        lastStoryRequestId = storyIntent.requestId;
        const place = getPlace(storyIntent.placeId);
        if (place && !document.hidden) {
          interrupted = false;
          controls.autoRotate = false;
          const saved = storyCameraSchema.safeParse(storyIntent.camera);
          const preset = saved.success ? saved.data : getCityCamera({ placeId: place.id, hotspotId: null });
          focus(preset, !initialCity, true);
        }
      }
      if (transition && (!options.motion || options.reducedMotion)) focus(transition.destination, false, transition.story);
      emphasizeDistricts();
      dirty = true;
    }

    function manual() {
      if (disposed || lost) return;
      manualInterrupted = true;
      transition = null;
      controls.autoRotate = false;
      clearTimeout(centerTimer);
      centerIndicator.hidden = true;
      callbacks.onManual();
      dirty = true;
    }
    controls.addEventListener('start', manual);
    cleanups.push(() => controls.removeEventListener('start', manual));
    const changed = () => { dirty = true; };
    controls.addEventListener('change', changed);
    cleanups.push(() => controls.removeEventListener('change', changed));
    function groundPoint(x: number, y: number) {
      const bounds = host.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return null;
      pointer.set((x - bounds.left) / bounds.width * 2 - 1, 1 - (y - bounds.top) / bounds.height * 2);
      camera.updateMatrixWorld(true);
      raycaster.setFromCamera(pointer, camera);
      groundPlane.setFromNormalAndCoplanarPoint(camera.up, controls.target);
      return raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
    }
    function moveTarget(target: THREE.Vector3) {
      camera.position.add(target.clone().sub(controls.target));
      controls.target.copy(target);
      controls.update(); dirty = true;
    }
    const setOrbitCursor = (on: boolean) => {
      host.classList?.toggle('is-orbiting', on);
      if (host.style) host.style.cursor = on ? 'move' : '';
    };
    const down = (event: PointerEvent) => {
      activePointers.add(event.pointerId);
      if (event.button === 1) queueMicrotask(() => setOrbitCursor(true));
      if (activePointers.size > 1 || event.button !== 0) { pointerStart = null; return; }
      const button = [...labels, ...urbanLabels, ...foodLabels].find(entry => entry.button.contains(event.target as Node | null))?.button;
      pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId, dragged: false, button };
      if (!button) renderer.domElement.focus({ preventScroll: true });
    };
    function emphasizedDistrictId() {
      const selected = selection?.placeId === 'seongnam' ? selection.hotspotId : null;
      return hoveredDistrictId || options?.hoveredDistrictId || selected || null;
    }
    function emphasizeDistricts() {
      if (!model) return;
      const active = emphasizedDistrictId();
      for (const district of CITY_DISTRICTS) {
        const idle = model.group.getObjectByName(`city-district-edge-${district.id}`);
        const emphasis = model.group.getObjectByName(`city-district-edge-active-${district.id}`);
        const on = district.id === active;
        if (idle) { idle.visible = !on; idle.renderOrder = 4; }
        if (emphasis) { emphasis.visible = on; emphasis.renderOrder = on ? 12 : 4; }
      }
      dirty = true;
    }
    function districtAt(x: number, y: number) {
      if (!model) return null;
      const top = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(x, y) : null;
      const overLabel = labels.find(entry => entry.marker.kind === 'district' && entry.button.getClientRects().length > 0 && top === entry.button);
      if (overLabel) return overLabel.marker.id;
      groundPoint(x, y);
      const hit = raycaster.intersectObjects(model.pickTargets.filter(target => target.userData.districtId), true)[0];
      let object: THREE.Object3D | undefined = hit?.object;
      while (object) {
        if (typeof object.userData.districtId === 'string') return object.userData.districtId;
        object = object.parent ?? undefined;
      }
      return null;
    }
    const move = (event: PointerEvent) => {
      if (pointerStart?.id === event.pointerId && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) pointerStart.dragged = true;
      if (pointerStart) return;
      const next = districtAt(event.clientX, event.clientY);
      if (next !== hoveredDistrictId) { hoveredDistrictId = next; emphasizeDistricts(); }
    };
    const leaveHost = () => {
      if (hoveredDistrictId === null) return;
      hoveredDistrictId = null;
      emphasizeDistricts();
    };
    const cancelPointer = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
      pointerStart = null;
      if (event.button === 1 || activePointers.size === 0) setOrbitCursor(false);
    };
    const up = (event: PointerEvent) => {
      activePointers.delete(event.pointerId);
      if (event.button === 1 || activePointers.size === 0) setOrbitCursor(false);
      if (!pointerStart || pointerStart.id !== event.pointerId) return;
      const start = pointerStart; pointerStart = null;
      if (!model || start.dragged || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
      const bounds = host.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.left + bounds.width || event.clientY < bounds.top || event.clientY > bounds.top + bounds.height) return;
      // Pointer capture retargets release to the host; preserve ordinary label clicks.
      if (start.button) { start.button.focus({ preventScroll: true }); start.button.click(); return; }
      const target = groundPoint(event.clientX, event.clientY);
      // District polygons cover the city; select districts through their labels
      // so ordinary ground clicks can move the map instead of changing places.
      const hit = raycaster.intersectObjects(model.pickTargets.filter(target => !target.userData.districtId), true)[0];
      let object: THREE.Object3D | undefined = hit?.object;
      let hotspotId: string | null = null, placeId: string | null = null;
      while (object) {
        if (!hotspotId && typeof object.userData.hotspotId === 'string') hotspotId = object.userData.hotspotId;
        if (!placeId && typeof object.userData.placeId === 'string') placeId = object.userData.placeId;
        object = object.parent ?? undefined;
      }
      if (placeId) select(normaliseDiorama({ placeId, hotspotId }));
      else if (hotspotId) callbacks.onHotspot(hotspotId);
      else if (target) {
        manual(); moveTarget(target);
        centerIndicator.hidden = false;
        centerTimer = setTimeout(() => { centerIndicator.hidden = true; }, 900);
      }
    };
    const click = (event: MouseEvent) => {
      // Physical clicks are handled above after drag/pinch detection. Keyboard
      // activation and our deliberate button.click() have detail 0 and still work.
      if (event.detail > 0) { event.preventDefault(); event.stopPropagation(); }
    };
    const keydown = (event: KeyboardEvent) => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(event.key)) return;
      event.preventDefault(); manual();
      if (event.key === 'Home') focus(currentPreset(), false);
      else if (event.key === '+' || event.key === '=') zoom(1.2);
      else if (event.key === '-') zoom(1 / 1.2);
      else if (options?.navigationMode !== 'rotate' && !event.shiftKey) {
        const bounds = host.getBoundingClientRect();
        const x = bounds.left + bounds.width / 2 + (event.key === 'ArrowRight' ? 64 : event.key === 'ArrowLeft' ? -64 : 0);
        const y = bounds.top + bounds.height / 2 + (event.key === 'ArrowDown' ? 64 : event.key === 'ArrowUp' ? -64 : 0);
        const target = groundPoint(x, y);
        if (target) moveTarget(target);
      } else {
        const offset = camera.position.clone().sub(controls.target);
        const spherical = new THREE.Spherical().setFromVector3(offset);
        if (event.key === 'ArrowLeft') spherical.theta -= .12;
        if (event.key === 'ArrowRight') spherical.theta += .12;
        if (event.key === 'ArrowUp') spherical.phi = Math.max(controls.minPolarAngle, spherical.phi - .1);
        if (event.key === 'ArrowDown') spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + .1);
        camera.position.copy(controls.target).add(offset.setFromSpherical(spherical)); controls.update();
      }
    };
    host.addEventListener('pointerdown', down, true);
    host.addEventListener('pointerleave', leaveHost);
    host.addEventListener('lostpointercapture', cancelPointer);
    host.addEventListener('click', click, true);
    document.addEventListener('pointermove', move, true);
    document.addEventListener('pointerup', up, true);
    document.addEventListener('pointercancel', cancelPointer, true);
    cleanups.push(() => {
      host.removeEventListener('pointerdown', down, true);
      host.removeEventListener('pointerleave', leaveHost);
      host.removeEventListener('lostpointercapture', cancelPointer);
      host.removeEventListener('click', click, true);
      document.removeEventListener('pointermove', move, true);
      document.removeEventListener('pointerup', up, true);
      document.removeEventListener('pointercancel', cancelPointer, true);
      activePointers.clear(); pointerStart = null;
    });
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
    function viewFromAbove() {
      if (disposed || lost || !model) return;
      manual();
      const distance = camera.position.distanceTo(controls.target);
      camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(new THREE.Spherical(distance, controls.minPolarAngle, 0)));
      controls.update();
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
      if (transition && !(transition.story ? interrupted : paused)) {
        const active = transition;
        active.elapsed += delta * 1000;
        const t = Math.min(1, active.elapsed / active.duration);
        const eased = t * t * (3 - 2 * t);
        camera.position.lerpVectors(active.position, new THREE.Vector3(...active.destination.position), eased);
        controls.target.lerpVectors(active.target, new THREE.Vector3(...active.destination.target), eased);
        camera.zoom = THREE.MathUtils.lerp(active.zoom, active.endZoom, eased);
        camera.updateProjectionMatrix();
        controls.update();
        dirty = true;
        if (t === 1) { transition = null; if (!active.story) arrive(active.stopId, active.requestId); }
      }
      controls.autoRotate = !options.storyFocus && !manualInterrupted && !transition && moving && options.phase === 'dwelling';
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
      viewFromAbove,
      focusCoordinate,
      getCameraSnapshot: (): StoryCameraView | null => {
        if (disposed || lost || !model || !options) return null;
        const result = storyCameraSchema.safeParse({ position: camera.position.toArray(), target: controls.target.toArray(), zoom: camera.zoom / fitZoom });
        return result.success ? result.data : null;
      },
      reset: () => { if (!disposed && !lost) { manual(); focus(currentPreset(), false); } },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}

export type DioramaRenderer = ReturnType<typeof createDioramaRenderer>;
