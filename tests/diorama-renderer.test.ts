import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import * as models from '../src/lib/diorama/city-model';
import * as cityData from '../src/lib/diorama/city-data';
import { createDioramaRenderer, type DioramaRenderer, type RenderOptions } from '../src/lib/diorama/renderer';
import { createTourState, defaultTourSettings, reduceTour } from '../src/lib/diorama/tour';
import { selectionFromStop, type DioramaSelection } from '../src/lib/diorama/data';
import { CITY_FOOD_PLACES } from '../src/lib/city-food';

class ElementStub extends EventTarget {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  style: { transform?: string } = {};
  className = '';
  textContent: string | null = '';
  hidden = false;
  attributes = new Map<string, string>();
  onclick: (() => void) | null = null;
  focus() {}
  click() { this.onclick?.(); }
  constructor(public width = 960, public height = 600) { super(); }
  get offsetWidth() { return this.hidden ? 0 : this.width; }
  get offsetHeight() { return this.hidden ? 0 : this.height; }
  appendChild(child: ElementStub) { this.children.push(child); child.parent = this; return child; }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(child => child !== this); }
  replaceChildren() { this.children = []; }
  contains(child: EventTarget | null): boolean { return child === this || this.children.some(entry => entry.contains(child)); }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  getBoundingClientRect() { return { x: 0, y: 0, left: 0, top: 0, width: this.width, height: this.height }; }
  getClientRects() { return this.hidden ? [] : [{ width: this.width, height: this.height }]; }
}

const gpu = vi.hoisted(() => ({
  renderer: null as unknown as {
    loop: ((time: number) => void) | null;
    render: ReturnType<typeof vi.fn>;
    dispose: ReturnType<typeof vi.fn>;
    domElement: ElementStub;
  },
  observeFailure: false,
  disconnected: false,
  controls: null as unknown as { autoRotate: boolean; minZoom: number; maxZoom: number; target: THREE.Vector3; mouseButtons: { LEFT: number; RIGHT: number }; touches: { ONE: number; TWO: number }; screenSpacePanning: boolean; zoomToCursor: boolean; enableDamping: boolean },
  resize: null as (() => void) | null,
}));

vi.mock('three', async importOriginal => {
  const actual = await importOriginal<typeof THREE>();
  return { ...actual, WebGLRenderer: class {
    domElement = new ElementStub();
    shadowMap = {};
    loop: ((time: number) => void) | null = null;
    render = vi.fn();
    dispose = vi.fn();
    constructor() { gpu.renderer = this; }
    setPixelRatio() {}
    setSize() {}
    setAnimationLoop(loop: ((time: number) => void) | null) { this.loop = loop; }
  } };
});

vi.mock('three/addons/controls/MapControls.js', async () => {
  const actual = await vi.importActual<typeof THREE>('three');
  return { MapControls: class extends actual.EventDispatcher {
    target = new actual.Vector3();
    mouseButtons = { LEFT: actual.MOUSE.PAN, MIDDLE: actual.MOUSE.DOLLY, RIGHT: actual.MOUSE.ROTATE };
    touches = { ONE: actual.TOUCH.PAN, TWO: actual.TOUCH.DOLLY_ROTATE };
    screenSpacePanning = false;
    autoRotate = false;
    minZoom = 0;
    maxZoom = Infinity;
    constructor(private camera: THREE.Camera) { super(); gpu.controls = this as unknown as typeof gpu.controls; }
    update() { this.camera.lookAt(this.target); return false; }
    dispose() {}
  } };
});

// Renderer ownership and camera tests use a bounded city-shaped fixture; real city
// geometry and GPU behavior are covered by the model tests and browser suite.
vi.mock('../src/lib/diorama/city-model', async () => {
  const actual = await vi.importActual<typeof THREE>('three');
  return { buildCityModel() {
    const group = new actual.Group(); group.name = 'seongnam-city-fixture';
    const geometry = new actual.BoxGeometry(150, 16, 160);
    const material = new actual.MeshStandardMaterial();
    const ground = new actual.Mesh(geometry, material); ground.position.set(12, 2, -8); group.add(ground);
    const visitors = new actual.Group(); group.add(visitors);
    return { group, visitors, pickTargets: [], update() {}, dispose() { geometry.dispose(); material.dispose(); group.clear(); } };
  } };
});

const selection = { placeId: 'pangyo-museum', hotspotId: 'museum-exterior' } as const;
const nextSelection = { ...selection, hotspotId: 'museum-garden' };
const options = (phase: RenderOptions['phase'], requestId: number): RenderOptions => ({ ...defaultTourSettings(), phase, requestId, reducedMotion: false });
let host: ElementStub;
let documentStub: EventTarget & { hidden: boolean; createElement: (tag: string) => ElementStub };
let owner: DioramaRenderer | undefined;

function setup() {
  const callbacks = { onReady: vi.fn(), onArrived: vi.fn(), onManual: vi.fn(), onHotspot: vi.fn(), onSelect: vi.fn(), onFood: vi.fn(), onError: vi.fn() };
  owner = createDioramaRenderer(host as unknown as HTMLDivElement, callbacks);
  return { owner, callbacks };
}

beforeEach(() => {
  host = new ElementStub();
  gpu.observeFailure = false; gpu.disconnected = false;
  documentStub = Object.assign(new EventTarget(), { hidden: false, createElement: (tag: string) => tag === 'button' ? new ElementStub(110, 34) : new ElementStub(), elementFromPoint: () => null });
  vi.stubGlobal('document', documentStub);
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { gpu.resize = callback; }
    observe() { if (gpu.observeFailure) throw new Error('observe failed'); }
    disconnect() { gpu.disconnected = true; }
  });
});

describe('story camera and landmark identity', () => {
  it('captures independent camera values and restores relative zoom once across viewport sizes', () => {
    const { owner, callbacks } = setup();
    expect(owner.getCameraSnapshot()).toBeNull();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    owner.zoom(1.25);
    const saved = owner.getCameraSnapshot()!;
    const independent = owner.getCameraSnapshot()!;
    independent.position[0] += 100;
    expect(owner.getCameraSnapshot()).toEqual(saved);
    host.width = 390; host.height = 700; gpu.resize?.();
    owner.zoom(1.2);
    callbacks.onManual.mockClear();
    const intent = { requestId: 7, placeId: selection.placeId, camera: saved };
    owner.apply(selection, { ...options('paused', 1), storyFocus: intent, reducedMotion: true });
    expect(owner.getCameraSnapshot()).toEqual(saved);
    expect(callbacks.onManual).not.toHaveBeenCalled();
    owner.zoom(1.2);
    const moved = owner.getCameraSnapshot();
    owner.apply(selection, { ...options('paused', 1), storyFocus: intent, reducedMotion: true });
    expect(owner.getCameraSnapshot()).toEqual(moved);
    owner.dispose();
    expect(owner.getCameraSnapshot()).toBeNull();
  });

  it('validates saved cameras and lets user input interrupt story flights without replay', () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    owner.apply(selection, { ...options('idle', 0), storyFocus: { requestId: 1, placeId: 'central-park', camera: { position: [NaN, 1, 2], target: [0, 0, 0], zoom: -1 } }, reducedMotion: true });
    expect(owner.getCameraSnapshot()?.position).toEqual([...cityData.getCityCamera({ placeId: 'central-park', hotspotId: null }).position]);
    callbacks.onManual.mockClear();
    const intent = { requestId: 2, placeId: 'moran-market' };
    owner.apply(selection, { ...options('idle', 0), storyFocus: intent });
    gpu.renderer.loop?.(100); gpu.renderer.loop?.(200);
    owner.zoom(1.1);
    const stopped = owner.getCameraSnapshot();
    for (let i = 3; i < 30; i++) gpu.renderer.loop?.(i * 100);
    owner.apply(selection, { ...options('idle', 0), storyFocus: intent });
    expect(owner.getCameraSnapshot()).toEqual(stopped);
    expect(callbacks.onManual).toHaveBeenCalledTimes(1);
  });

  it('draws a dashed story order, preserves its resources on repeat and releases replacements', () => {
    const { owner } = setup();
    const stops = [{ placeId: 'pangyo-museum' }, { placeId: 'central-park' }, { placeId: 'moran-market' }];
    owner.apply(selection, { ...options('idle', 0), storyStops: stops, reducedMotion: true }); gpu.renderer.loop?.(100);
    const scene = gpu.renderer.render.mock.calls.at(-1)![0] as THREE.Scene;
    const line = scene.getObjectByName('city-story-order') as THREE.Line;
    expect(line).toBeDefined();
    expect(line.material).toBeInstanceOf(THREE.LineDashedMaterial);
    expect(line.userData.placeIds).toEqual(stops.map(stop => stop.placeId));
    const geometry = vi.spyOn(line.geometry, 'dispose');
    const material = vi.spyOn(line.material as THREE.Material, 'dispose');
    owner.apply(selection, { ...options('idle', 0), storyStops: [...stops], reducedMotion: true });
    expect(scene.getObjectByName('city-story-order')).toBe(line);
    expect(geometry).not.toHaveBeenCalled();
    owner.apply(selection, { ...options('idle', 0), storyStops: stops.toReversed(), reducedMotion: true });
    expect(geometry).toHaveBeenCalledTimes(1); expect(material).toHaveBeenCalledTimes(1);
    const current = scene.getObjectByName('city-story-order') as THREE.Line;
    const release = vi.spyOn(current.geometry, 'dispose');
    owner.dispose(); owner.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('keeps photo metadata on landmark labels and uses type/name fallbacks', () => {
    const { owner } = setup();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, { ...options('idle', 0), reducedMotion: true });
    const layer = host.children[1];
    const museum = layer.children.find(button => button.getAttribute('data-city-place') === 'pangyo-museum')!;
    expect(museum.getAttribute('data-landmark-visual')).toBe('photo');
    const image = museum.children.find(child => child.getAttribute('data-landmark-photo') === 'pangyo-museum')!;
    expect(image.getAttribute('src')).toBe('/places/pangyo-museum.jpg');
    expect(image.getAttribute('data-captured-at')).toBe('2014-11-13');
    expect(layer.children.some(button => button.getAttribute('data-landmark-visual') === 'type')).toBe(true);
  });

  it('pins only sourced food coordinates and sends their food identity on selection', () => {
    const { owner, callbacks } = setup();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, { ...options('idle', 0), reducedMotion: true });
    const buttons = host.children[1].children.filter(button => button.getAttribute('data-city-food'));
    const located = CITY_FOOD_PLACES.filter(place => place.lat !== null && place.lng !== null);
    expect(buttons.map(button => button.getAttribute('data-city-food'))).toEqual(located.map(place => place.id));
    expect(buttons.every(button => button.getAttribute('data-food-category') === 'restaurant')).toBe(true);
    buttons[0].onclick?.();
    expect(callbacks.onFood).toHaveBeenCalledWith(located[0].id);
    expect(gpu.controls.target.toArray()).toEqual([...cityData.projectCityCoordinate(located[0].lng!, located[0].lat!)]);
    owner.dispose(); buttons[0].onclick?.();
    expect(callbacks.onFood).toHaveBeenCalledTimes(1);
  });

  it.each([[960, 600], [390, 560]])('keeps the selected photo visible at street scale at %i×%i', (width, height) => {
    host.width = width; host.height = height;
    const { owner } = setup();
    owner.apply({ placeId: 'pangyo-museum', hotspotId: null }, { ...options('idle', 0), reducedMotion: true });
    gpu.renderer.loop?.(100);
    const label = host.children[1].children.find(button => button.getAttribute('data-city-kind') === 'landmark' && button.getAttribute('data-city-place') === 'pangyo-museum')!;
    expect(label.hidden).toBe(false);
  });

  it('updates story viewing direction while the ordinary tour is paused', () => {
    const { owner } = setup();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    owner.apply(selection, { ...options('paused', 1), storyFocus: { requestId: 1, placeId: 'central-park' } });
    for (let i = 1; i <= 20; i++) gpu.renderer.loop?.(i * 100);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.Camera;
    const direction = camera.getWorldDirection(new THREE.Vector3());
    const expected = gpu.controls.target.clone().sub(camera.position).normalize();
    expect(direction.distanceTo(expected)).toBeLessThan(1e-8);
  });

  it('cancels a story flight when its intent is removed', () => {
    const { owner } = setup();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    owner.apply(selection, { ...options('idle', 0), storyFocus: { requestId: 1, placeId: 'central-park' } });
    gpu.renderer.loop?.(100); gpu.renderer.loop?.(200);
    const stopped = owner.getCameraSnapshot();
    owner.apply(selection, options('idle', 0));
    for (let i = 3; i < 30; i++) gpu.renderer.loop?.(i * 100);
    expect(owner.getCameraSnapshot()).toEqual(stopped);
  });
});

afterEach(() => { owner?.dispose(); owner = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('diorama renderer lifecycle and tour handoff', () => {
  it('reports readiness before starting the tour transition', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('loading', 1));
    await Promise.resolve();
    expect(callbacks.onReady).toHaveBeenCalledWith('pangyo-museum:museum-exterior', 1);
    expect(callbacks.onArrived).not.toHaveBeenCalled();
    owner.apply(selection, { ...options('transition', 1), reducedMotion: true });
    await Promise.resolve();
    expect(callbacks.onArrived).toHaveBeenCalledWith('pangyo-museum:museum-exterior', 1);
  });

  it('stops an in-flight camera move without snapping to its destination', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    await Promise.resolve();
    callbacks.onArrived.mockClear();
    owner.apply(nextSelection, options('transition', 1));
    gpu.renderer.loop?.(100);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.Camera;
    const stoppedPosition = camera.position.clone();
    owner.apply(nextSelection, options('idle', 2));
    for (let index = 1; index <= 20; index++) gpu.renderer.loop?.(100 + index * 100);
    await Promise.resolve();
    expect(camera.position.toArray()).toEqual(stoppedPosition.toArray());
    expect(callbacks.onArrived).not.toHaveBeenCalled();
  });

  it('ignores obsolete arrivals and resumes with the latest request token', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    owner.apply(nextSelection, options('transition', 1));
    owner.apply(nextSelection, options('paused', 2));
    await Promise.resolve();
    expect(callbacks.onArrived).not.toHaveBeenCalled();
    owner.apply(nextSelection, { ...options('transition', 2), reducedMotion: true });
    await Promise.resolve();
    expect(callbacks.onArrived.mock.calls).toEqual([['pangyo-museum:museum-garden', 2]]);
  });

  it('reissues readiness once when resuming a stop chosen while paused', async () => {
    const { owner, callbacks } = setup();
    const eligibleStopIds = ['pangyo-museum:museum-exterior', 'pangyo-museum:museum-garden'];
    const play = { type: 'play', eligibleStopIds } as const;
    let state = reduceTour(createTourState(eligibleStopIds[0]), play);
    callbacks.onReady.mockImplementation((stopId: string, requestId: number) => {
      state = reduceTour(state, { type: 'loaded', stopId, requestId });
    });
    callbacks.onArrived.mockImplementation((stopId: string, requestId: number) => {
      state = reduceTour(state, { type: 'arrived', stopId, requestId });
    });
    const apply = () => owner.apply(selectionFromStop(state.stopId), { ...options(state.status, state.requestId), reducedMotion: true });
    apply(); await Promise.resolve();
    apply(); await Promise.resolve();
    expect(state.status).toBe('dwelling');

    state = reduceTour(state, { type: 'pause' });
    apply(); await Promise.resolve();
    state = reduceTour(state, { type: 'next', eligibleStopIds });
    apply(); await Promise.resolve();
    expect(state).toMatchObject({ status: 'paused', resumePhase: 'loading', stopId: 'pangyo-museum:museum-garden' });
    const pausedToken = state.requestId;
    const readinessCount = callbacks.onReady.mock.calls.length;

    state = reduceTour(state, play);
    expect(state).toMatchObject({ status: 'loading', requestId: pausedToken });
    apply(); apply(); await Promise.resolve();
    expect(state.status).toBe('transition');
    expect(callbacks.onReady.mock.calls).toHaveLength(readinessCount + 1);
    apply(); await Promise.resolve();
    expect(state).toMatchObject({ status: 'dwelling', stopId: 'pangyo-museum:museum-garden', remainingMs: 10000 });
  });

  it('cannot finish a hidden-tab transition until explicit playback resumes', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    await Promise.resolve();
    callbacks.onArrived.mockClear();
    owner.apply(nextSelection, options('transition', 1));
    gpu.renderer.loop?.(100);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.Camera;
    const hiddenPosition = camera.position.clone();
    documentStub.hidden = true;
    documentStub.dispatchEvent(new Event('visibilitychange'));
    expect(gpu.renderer.loop).toBeNull();
    documentStub.hidden = false;
    documentStub.dispatchEvent(new Event('visibilitychange'));
    gpu.renderer.loop?.(1000000);
    await Promise.resolve();
    expect(camera.position.toArray()).toEqual(hiddenPosition.toArray());
    expect(callbacks.onArrived).not.toHaveBeenCalled();
  });

  it('reports frame failures once and releases the canvas, observers and GPU owner', () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    gpu.renderer.render.mockImplementation(() => { throw new Error('GPU render failed'); });
    expect(() => gpu.renderer.loop?.(100)).not.toThrow();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(gpu.renderer.loop).toBeNull();
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.disconnected).toBe(true);
    expect(host.children).toHaveLength(0);
  });

  it('releases partially constructed resources when initial observation fails', () => {
    gpu.observeFailure = true;
    expect(setup).toThrow('observe failed');
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.disconnected).toBe(true);
    expect(host.children).toHaveLength(0);
  });

  it('cleans up a failed initial city build without announcing readiness', async () => {
    const { owner, callbacks } = setup();
    vi.spyOn(models, 'buildCityModel').mockImplementation(() => { throw new Error('model build failed'); });
    expect(() => owner.apply({ placeId: 'seongnam', hotspotId: null }, options('loading', 1))).not.toThrow();
    await Promise.resolve();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });

  it('uses active frame time to finish a transition once', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    owner.apply(nextSelection, options('transition', 1));
    for (let index = 0; index <= 12; index++) gpu.renderer.loop?.(100 + index * 100);
    await Promise.resolve();
    expect(callbacks.onArrived).not.toHaveBeenCalled();
    gpu.renderer.loop?.(1400);
    await Promise.resolve();
    expect(callbacks.onArrived.mock.calls).toEqual([['pangyo-museum:museum-garden', 1]]);
  });

  it('suspends automatic camera rotation immediately before React applies manual state', () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('idle', 0));
    owner.apply(selection, options('dwelling', 1));
    gpu.renderer.loop?.(100);
    expect(gpu.controls.autoRotate).toBe(true);
    owner.zoom(1.2);
    gpu.renderer.loop?.(200);
    expect(callbacks.onManual).toHaveBeenCalledTimes(1);
    expect(gpu.controls.autoRotate).toBe(false);
  });

  it('releases resources on context loss and suppresses already queued callbacks', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('loading', 1));
    gpu.renderer.domElement.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await Promise.resolve();
    expect(callbacks.onError).toHaveBeenCalledTimes(1);
    expect(callbacks.onReady).not.toHaveBeenCalled();
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(host.children).toHaveLength(0);
  });

  it('disposes idempotently and prevents post-disposal updates', async () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, options('loading', 1));
    owner.dispose(); owner.dispose(); owner.apply(nextSelection, options('loading', 2));
    await Promise.resolve();
    expect(gpu.renderer.dispose).toHaveBeenCalledTimes(1);
    expect(gpu.renderer.loop).toBeNull();
    expect(host.children).toHaveLength(0);
    expect(callbacks.onReady).not.toHaveBeenCalled();
  });

  it('builds one continuous city and preserves its canvas and resources across all place selections', async () => {
    const build = vi.spyOn(models, 'buildCityModel');
    const { owner, callbacks } = setup();
    const city: DioramaSelection = { placeId: 'seongnam', hotspotId: null };
    owner.apply(city, { ...options('idle', 0), reducedMotion: true });
    gpu.renderer.loop?.(100);
    const canvas = gpu.renderer.domElement;
    const scene = gpu.renderer.render.mock.calls.at(-1)![0] as THREE.Scene;
    const cityModel = build.mock.results[0].value as ReturnType<typeof models.buildCityModel>;
    const release = vi.spyOn(cityModel, 'dispose');
    const geometryIds: string[] = [];
    cityModel.group.traverse(object => { if (object instanceof THREE.Mesh) geometryIds.push(object.geometry.uuid); });
    for (const [index, landmark] of cityData.CITY_LANDMARKS.entries()) {
      const selected: DioramaSelection = { placeId: landmark.placeId, hotspotId: null };
      owner.apply(selected, { ...options('idle', index + 1), reducedMotion: true });
      gpu.renderer.loop?.(200 + index * 100);
      const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.OrthographicCamera;
      expect(camera.position.toArray()).toEqual([...cityData.getCityCamera(selected).position]);
      expect(gpu.controls.target.toArray()).toEqual([...cityData.getCityCamera(selected).target]);
      expect(scene.children).toContain(cityModel.group);
      expect(gpu.renderer.domElement).toBe(canvas);
    }
    owner.apply(city, { ...options('idle', 20), reducedMotion: true });
    await Promise.resolve();
    expect(callbacks.onReady).toHaveBeenLastCalledWith('seongnam:overview', 20);
    expect(build).toHaveBeenCalledTimes(1);
    expect(release).not.toHaveBeenCalled();
    const retained: string[] = [];
    cityModel.group.traverse(object => { if (object instanceof THREE.Mesh) retained.push(object.geometry.uuid); });
    expect(retained).toEqual(geometryIds);
    owner.dispose(); owner.dispose();
    expect(release).toHaveBeenCalledTimes(1);
  });

  it.each([[960, 600], [390, 560]])('fits every city bounds corner at %i×%i and keeps the fit after resize', (width, height) => {
    host.width = width; host.height = height;
    const build = vi.spyOn(models, 'buildCityModel');
    const { owner } = setup();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, { ...options('idle', 0), reducedMotion: true });
    gpu.renderer.loop?.(100);
    const model = build.mock.results[0].value as ReturnType<typeof models.buildCityModel>;
    const bounds = new THREE.Box3().setFromObject(model.group);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.OrthographicCamera;
    const assertFits = () => {
      camera.updateMatrixWorld(true);
      for (const x of [bounds.min.x, bounds.max.x]) for (const y of [bounds.min.y, bounds.max.y]) for (const z of [bounds.min.z, bounds.max.z]) {
        const point = new THREE.Vector3(x, y, z).project(camera);
        expect(Math.abs(point.x)).toBeLessThan(.99);
        expect(Math.abs(point.y)).toBeLessThan(.99);
        expect(Math.abs(point.z)).toBeLessThan(1);
      }
    };
    expect(camera.far).toBeGreaterThanOrEqual(1500);
    expect(gpu.controls.maxZoom / camera.zoom).toBeGreaterThanOrEqual(24);
    assertFits();
    expect(host.children[1].children.filter(button => !button.hidden && button.getAttribute('data-city-kind') === 'district')).toHaveLength(3);
    const visibleLabels = host.children[1].children.filter(button => !button.hidden).map(button => {
      const [, x, y] = button.style.transform!.match(/translate\(([^p]+)px,([^p]+)px\)/)!;
      return { left: Number(x) - button.width / 2, right: Number(x) + button.width / 2, top: Number(y) - button.height, bottom: Number(y) };
    });
    for (let a = 0; a < visibleLabels.length; a++) for (let b = a + 1; b < visibleLabels.length; b++) {
      const left = visibleLabels[a], right = visibleLabels[b];
      expect(left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top).toBe(false);
    }
    host.width = 430; host.height = 700; gpu.resize?.(); gpu.renderer.loop?.(200);
    assertFits();
  });

  it('keeps stable city label buttons and sends complete place/district selections', () => {
    const { owner, callbacks } = setup();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, { ...options('idle', 0), reducedMotion: true });
    const layer = host.children[1];
    const market = layer.children.find(button => button.getAttribute('aria-label') === '모란민속5일장 모형 선택')!;
    const district = layer.children.find(button => button.getAttribute('aria-label') === '수정구 모형에서 보기')!;
    expect(market).toBeDefined(); expect(district).toBeDefined();
    market.onclick?.(); district.onclick?.();
    expect(callbacks.onSelect.mock.calls).toEqual([[{ placeId: 'moran-market', hotspotId: null }], [{ placeId: 'seongnam', hotspotId: 'sujeong' }]]);
    owner.apply({ placeId: 'seongnam', hotspotId: 'sujeong' }, { ...options('idle', 1), reducedMotion: true });
    expect(layer.children).toContain(market);
    expect(district.getAttribute('aria-pressed')).toBe('true');
    owner.dispose(); market.onclick?.();
    expect(callbacks.onSelect).toHaveBeenCalledTimes(2);
  });

  it('prefers the selected marker, removes portrait label collisions, and hides offscreen points without clamping', () => {
    host.width = 390; host.height = 560;
    const picked: DioramaSelection = { placeId: 'seongnam', hotspotId: 'sujeong' };
    vi.spyOn(cityData, 'getCityMarkers').mockReturnValue([
      { id: 'other', label: '다른 장소', point: [0, 0, 0], selection, kind: 'landmark' },
      { id: 'chosen', label: '수정구', point: [0, 0, 0], selection: picked, kind: 'district' },
      { id: 'outside', label: '화면 밖 장소', point: [10000, 0, 0], selection: nextSelection, kind: 'landmark' },
    ]);
    vi.spyOn(cityData, 'getCityCamera').mockReturnValue(cityData.CITY_OVERVIEW);
    const { owner } = setup();
    owner.apply(picked, { ...options('idle', 0), reducedMotion: true }); gpu.renderer.loop?.(100);
    const layer = host.children[1];
    expect(layer.children.filter(button => !button.hidden)).toHaveLength(1);
    expect(layer.children.find(button => !button.hidden)?.getAttribute('aria-label')).toBe('수정구 모형에서 보기');
    const offscreen = layer.children.find(button => button.getAttribute('aria-label') === '화면 밖 장소 모형 선택')!;
    expect(offscreen.hidden).toBe(true);
    expect(offscreen.style.transform).toBeUndefined();
  });

  it('picks the correct place when a child hotspot inherits its place ID from an ancestor', () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    const place = new THREE.Group(); place.userData.placeId = 'central-park';
    const child = new THREE.Mesh(); child.userData.hotspotId = 'park-lake'; place.add(child);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: child, distance: 1, point: new THREE.Vector3() }]);
    const event = (type: string) => Object.assign(new Event(type), { clientX: 150, clientY: 160, pointerId: 1, button: 0 });
    host.dispatchEvent(event('pointerdown')); documentStub.dispatchEvent(event('pointerup'));
    expect(callbacks.onSelect).toHaveBeenCalledWith({ placeId: 'central-park', hotspotId: 'park-lake' });
    expect(callbacks.onHotspot).not.toHaveBeenCalled();
  });

  it('retains legacy hotspot handling for targets without place metadata', () => {
    const { owner, callbacks } = setup();
    owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    const child = new THREE.Mesh(); child.userData.hotspotId = 'museum-garden';
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: child, distance: 1, point: new THREE.Vector3() }]);
    const event = (type: string) => Object.assign(new Event(type), { clientX: 150, clientY: 160, pointerId: 1, button: 0 });
    host.dispatchEvent(event('pointerdown')); documentStub.dispatchEvent(event('pointerup'));
    expect(callbacks.onHotspot).toHaveBeenCalledWith('museum-garden');
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });
});

describe('living city controls', () => {
  it('focuses recorded coordinates at street scale and rejects invalid coordinates', () => {
    const { owner, callbacks } = setup();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, options('idle', 0));
    gpu.renderer.loop?.(100);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.OrthographicCamera;
    const overviewZoom = camera.zoom;
    owner.focusCoordinate([127.1, 37.4]);
    gpu.renderer.loop?.(200);
    expect(gpu.controls.target.toArray()).toEqual([...cityData.projectCityCoordinate(127.1, 37.4)]);
    expect(camera.zoom / overviewZoom).toBeCloseTo(55);
    expect(callbacks.onManual).toHaveBeenCalledTimes(1);
    owner.apply({ placeId: 'seongnam', hotspotId: null }, options('manual', 1));
    expect(gpu.controls.target.toArray()).toEqual([...cityData.projectCityCoordinate(127.1, 37.4)]);
    owner.focusCoordinate([NaN, 37.4]);
    owner.focusCoordinate([140, 40]);
    expect(gpu.controls.target.toArray()).toEqual([...cityData.projectCityCoordinate(127.1, 37.4)]);
  });
});

describe('direct map navigation', () => {
  function ready() {
    const state = setup();
    state.owner.apply(selection, { ...options('idle', 0), reducedMotion: true });
    gpu.renderer.loop?.(100);
    const camera = gpu.renderer.render.mock.calls.at(-1)![1] as THREE.OrthographicCamera;
    return { ...state, camera };
  }
  function pointerEvent(type: string, x = 540, y = 280, id = 1, extra: Record<string, unknown> = {}) {
    return Object.assign(new Event(type), { clientX: x, clientY: y, pointerId: id, pointerType: 'mouse', button: 0, ...extra });
  }
  function click(x = 540, y = 280) {
    host.dispatchEvent(pointerEvent('pointerdown', x, y));
    documentStub.dispatchEvent(pointerEvent('pointerup', x, y));
  }
  function key(key: string, shiftKey = false) {
    gpu.renderer.domElement.dispatchEvent(Object.assign(new Event('keydown', { cancelable: true }), { key, shiftKey }));
  }

  it('uses ground-anchored map gestures by default and switches modes without rebuilding the city', () => {
    const { owner } = ready();
    expect(gpu.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.PAN);
    expect(gpu.controls.mouseButtons.MIDDLE).toBe(THREE.MOUSE.ROTATE);
    expect(gpu.controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    expect(gpu.controls.touches).toMatchObject({ ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_PAN });
    expect(gpu.controls.screenSpacePanning).toBe(false);
    expect(gpu.controls.zoomToCursor).toBe(true);
    expect(gpu.controls.enableDamping).toBe(false);
    const canvas = gpu.renderer.domElement;
    const city = (gpu.renderer.render.mock.calls.at(-1)![0] as THREE.Scene).children.find(child => child.name === 'seongnam-city-fixture');
    owner.apply(selection, { ...options('manual', 1), navigationMode: 'rotate' });
    gpu.renderer.loop?.(200);
    expect(gpu.controls.mouseButtons.LEFT).toBe(THREE.MOUSE.ROTATE);
    expect(gpu.controls.mouseButtons.MIDDLE).toBe(THREE.MOUSE.ROTATE);
    expect(gpu.controls.mouseButtons.RIGHT).toBe(THREE.MOUSE.ROTATE);
    expect(gpu.controls.touches.ONE).toBe(THREE.TOUCH.ROTATE);
    expect(gpu.renderer.domElement).toBe(canvas);
    expect((gpu.renderer.render.mock.calls.at(-1)![0] as THREE.Scene).children).toContain(city);
  });

  it('centers the clicked ground point while retaining zoom, orientation and selected-place identity', () => {
    const { owner, callbacks, camera } = ready();
    const target = gpu.controls.target.clone(), offset = camera.position.clone().sub(target), zoom = camera.zoom;
    camera.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(540 / host.width * 2 - 1, 1 - 280 / host.height * 2), camera);
    const expected = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -target.y), new THREE.Vector3())!;
    click();
    expect(gpu.controls.target.distanceTo(expected)).toBeLessThan(1e-8);
    expect(gpu.controls.target.distanceTo(target)).toBeGreaterThan(.01);
    expect(camera.position.clone().sub(gpu.controls.target).distanceTo(offset)).toBeLessThan(1e-8);
    expect(camera.zoom).toBe(zoom);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(callbacks.onManual).toHaveBeenCalled();
    owner.apply(selection, { ...options('manual', 1), reducedMotion: true });
    for (let i = 1; i < 20; i++) gpu.renderer.loop?.(100 + i * 100);
    expect(gpu.controls.target.distanceTo(expected)).toBeLessThan(1e-8);
  });

  it('thickens the selected or hovered district outline without treating the land as a place pick', () => {
    const model = models.buildCityModel();
    for (const id of ['sujeong', 'jungwon', 'bundang']) {
      const idle = new THREE.Mesh(); idle.name = `city-district-edge-${id}`; idle.visible = true;
      const active = new THREE.Mesh(); active.name = `city-district-edge-active-${id}`; active.visible = false;
      model.group.add(idle, active);
    }
    vi.spyOn(models, 'buildCityModel').mockReturnValue(model);
    const { owner } = ready();
    owner.apply({ placeId: 'seongnam', hotspotId: null }, options('idle', 1));
    expect(model.group.getObjectByName('city-district-edge-sujeong')!.visible).toBe(true);
    expect(model.group.getObjectByName('city-district-edge-active-sujeong')!.visible).toBe(false);
    owner.apply({ placeId: 'seongnam', hotspotId: 'sujeong' }, options('idle', 2));
    expect(model.group.getObjectByName('city-district-edge-sujeong')!.visible).toBe(false);
    expect(model.group.getObjectByName('city-district-edge-active-sujeong')!.visible).toBe(true);
    owner.apply({ placeId: 'seongnam', hotspotId: null }, { ...options('idle', 3), hoveredDistrictId: 'bundang' });
    expect(model.group.getObjectByName('city-district-edge-active-bundang')!.visible).toBe(true);
    expect(model.group.getObjectByName('city-district-edge-bundang')!.visible).toBe(false);
  });

  it('treats district land as navigation ground instead of a place pick', () => {
    const model = models.buildCityModel();
    const land = new THREE.Mesh();
    land.userData = { districtId: 'bundang', placeId: 'seongnam', hotspotId: 'bundang' };
    model.pickTargets.push(land);
    vi.spyOn(models, 'buildCityModel').mockReturnValue(model);
    vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockImplementation(targets => targets.includes(land) ? [{ object: land, distance: 1, point: new THREE.Vector3() }] : []);
    const { callbacks } = ready();
    const target = gpu.controls.target.clone();
    click();
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(gpu.controls.target.distanceTo(target)).toBeGreaterThan(.01);
  });

  it('pans with arrows, rotates with Shift+arrows, and restores the selected view with Home', () => {
    const { camera, callbacks } = ready();
    const target = gpu.controls.target.clone(), offset = camera.position.clone().sub(target), zoom = camera.zoom;
    key('ArrowRight');
    expect(gpu.controls.target.distanceTo(target)).toBeGreaterThan(.01);
    expect(camera.position.clone().sub(gpu.controls.target).distanceTo(offset)).toBeLessThan(1e-8);
    const movedTarget = gpu.controls.target.clone();
    key('ArrowLeft', true);
    expect(gpu.controls.target.toArray()).toEqual(movedTarget.toArray());
    expect(camera.position.clone().sub(gpu.controls.target).distanceTo(offset)).toBeGreaterThan(.1);
    expect(camera.zoom).toBe(zoom);
    key('Home');
    expect(gpu.controls.target.toArray()).toEqual([...cityData.getCityCamera(selection).target]);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  it('does not turn a drag that returns to its start into a click or a place selection', () => {
    const { callbacks } = ready();
    const target = gpu.controls.target.clone();
    const place = new THREE.Mesh(); place.userData.placeId = 'central-park';
    const picks = vi.spyOn(THREE.Raycaster.prototype, 'intersectObjects').mockReturnValue([{ object: place, distance: 1, point: new THREE.Vector3() }]);
    host.dispatchEvent(pointerEvent('pointerdown'));
    documentStub.dispatchEvent(pointerEvent('pointermove', 610, 340));
    documentStub.dispatchEvent(pointerEvent('pointermove'));
    documentStub.dispatchEvent(pointerEvent('pointerup'));
    expect(gpu.controls.target.toArray()).toEqual(target.toArray());
    expect(callbacks.onSelect).not.toHaveBeenCalled();
    expect(picks).not.toHaveBeenCalled();
  });

  it.each(['pointercancel', 'lostpointercapture'])('drops a %s gesture and accepts the next genuine click', cancelled => {
    const { callbacks } = ready();
    const target = gpu.controls.target.clone();
    host.dispatchEvent(pointerEvent('pointerdown'));
    (cancelled === 'pointercancel' ? documentStub : host).dispatchEvent(pointerEvent(cancelled));
    documentStub.dispatchEvent(pointerEvent('pointerup'));
    expect(gpu.controls.target.toArray()).toEqual(target.toArray());
    click();
    expect(gpu.controls.target.distanceTo(target)).toBeGreaterThan(.01);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });

  it('never treats either end of a two-finger gesture as a ground click', () => {
    ready();
    const target = gpu.controls.target.clone();
    host.dispatchEvent(pointerEvent('pointerdown', 540, 280, 1, { pointerType: 'touch' }));
    host.dispatchEvent(pointerEvent('pointerdown', 600, 280, 2, { pointerType: 'touch' }));
    documentStub.dispatchEvent(pointerEvent('pointerup', 540, 280, 1, { pointerType: 'touch' }));
    documentStub.dispatchEvent(pointerEvent('pointerup', 600, 280, 2, { pointerType: 'touch' }));
    expect(gpu.controls.target.toArray()).toEqual(target.toArray());
    click();
    expect(gpu.controls.target.distanceTo(target)).toBeGreaterThan(.01);
  });

  it('ignores right clicks and releases outside the map', () => {
    ready();
    const target = gpu.controls.target.clone();
    host.dispatchEvent(pointerEvent('pointerdown', 540, 280, 1, { button: 2 }));
    documentStub.dispatchEvent(pointerEvent('pointerup', 540, 280, 1, { button: 2 }));
    host.dispatchEvent(pointerEvent('pointerdown', 959, 280));
    documentStub.dispatchEvent(pointerEvent('pointerup', 962, 280));
    expect(gpu.controls.target.toArray()).toEqual(target.toArray());
  });

  it('provides a north-up top view without changing the current location or zoom', () => {
    const { owner, callbacks, camera } = ready();
    click();
    const target = gpu.controls.target.clone(), distance = camera.position.distanceTo(target), zoom = camera.zoom;
    owner.viewFromAbove();
    const offset = camera.position.clone().sub(target);
    expect(gpu.controls.target.toArray()).toEqual(target.toArray());
    expect(camera.zoom).toBe(zoom);
    expect(camera.position.distanceTo(target)).toBeCloseTo(distance);
    expect(Math.abs(offset.x)).toBeLessThan(1e-8);
    expect(offset.y / offset.length()).toBeGreaterThan(.99);
    expect(callbacks.onSelect).not.toHaveBeenCalled();
  });
});
