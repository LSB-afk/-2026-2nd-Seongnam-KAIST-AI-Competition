import type { Place } from "./places";

export type MapViewport = { lat: number; lng: number; zoom: number };
export const CITY_VIEW: MapViewport = { lat: 37.415, lng: 127.115, zoom: 12 };
export const WORLD_VIEW: MapViewport = { lat: 36.3, lng: 127.7, zoom: 7 };
type Coordinate = { lat(): number; lng(): number };
type Point = { x: number; y: number };
type Size = { width: number; height: number };
type MapInstance = {
  getCenter(): Coordinate; getZoom(): number;
  setCenter(center: Coordinate): void; panTo(center: Coordinate): void;
  setZoom(zoom: number): void; setSize(size: Size): void;
  fitBounds(bounds: Bounds): void; destroy(): void;
  getProjection(): { fromCoordToOffset(coord: Coordinate): Point; fromOffsetToCoord(point: Point): Coordinate };
};
type Bounds = { extend(coord: Coordinate): void };
type Marker = { setMap(map: MapInstance | null): void; setPosition(position: Coordinate): void };
export type NaverMaps = {
  Map: new (container: HTMLElement, options: { center: Coordinate; zoom: number; draggable: boolean; pinchZoom: boolean; keyboardShortcuts: boolean; scrollWheel: boolean; minZoom: number; maxZoom: number }) => MapInstance;
  Marker: new (options: { map: MapInstance; position: Coordinate; icon: { content: HTMLElement; size: Size; anchor: Point } }) => Marker;
  LatLng: new (lat: number, lng: number) => Coordinate;
  Point: new (x: number, y: number) => Point;
  Size: new (width: number, height: number) => Size;
  LatLngBounds: new () => Bounds;
  Event: { addListener(target: MapInstance, event: string, listener: () => void): object; removeListener(handle: object): void };
};

export class MapSdkError extends Error {
  constructor(public readonly code: "authentication" | "script-network" | "sdk-timeout" | "sdk-invalid" | "key-conflict") { super(code); this.name = "MapSdkError"; }
}
type Registry = { key?: string; promise?: Promise<NaverMaps>; status: "idle" | "loading" | "ready" | "failed"; error?: MapSdkError; subscribers: Set<(error: MapSdkError) => void> };
declare global {
  interface Window {
    naver?: { maps: NaverMaps };
    __timestoryNaver?: Registry;
    __timestoryNaverReady?: () => void;
    navermap_authFailure?: () => void;
  }
}
function registry() { return window.__timestoryNaver ??= { status: "idle", subscribers: new Set() }; }

export function subscribeNaverFailure(listener: (error: MapSdkError) => void): () => void {
  const state = registry();
  state.subscribers.add(listener);
  if (state.error) listener(state.error);
  return () => { state.subscribers.delete(listener); };
}

/** One load per document. Failure recovery reloads the document to exclude late old callbacks. */
export function loadNaverMaps(clientId: string, { timeoutMs = 15_000 }: { timeoutMs?: number } = {}): Promise<NaverMaps> {
  const state = registry();
  if (state.key && state.key !== clientId) return Promise.reject(new MapSdkError("key-conflict"));
  if (state.status === "failed") return Promise.reject(state.error);
  if (state.promise) return state.promise;
  state.key = clientId;
  state.status = "loading";
  state.promise = new Promise<NaverMaps>((resolve, reject) => {
    const fail = (code: MapSdkError["code"]) => {
      if (state.status === "failed") return;
      clearTimeout(timer);
      state.status = "failed";
      state.error = new MapSdkError(code);
      reject(state.error);
      state.subscribers.forEach(listener => listener(state.error!));
    };
    window.__timestoryNaverReady = () => {
      if (state.status !== "loading") return;
      const maps = window.naver?.maps;
      if (!maps?.Map || !maps.Marker || !maps.Event) { fail("sdk-invalid"); return; }
      clearTimeout(timer);
      state.status = "ready";
      resolve(maps);
    };
    window.navermap_authFailure = () => fail("authentication");
    const script = document.createElement("script");
    script.id = "timestory-naver-sdk";
    script.async = true;
    const url = new URL("https://oapi.map.naver.com/openapi/v3/maps.js");
    url.searchParams.set("ncpKeyId", clientId);
    url.searchParams.set("callback", "__timestoryNaverReady");
    script.src = url.href;
    script.onerror = () => fail("script-network");
    const timer = setTimeout(() => fail("sdk-timeout"), timeoutMs);
    document.head.appendChild(script);
  });
  return state.promise;
}

type ProjectedPlace = { place: Place; x: number; y: number };
type Group = { places: Place[]; x: number; y: number };
/** All points are compared, so markers on either side of a grid boundary still merge. */
export function clusterProjectedPlaces(points: ProjectedPlace[], distance = 60): Group[] {
  const groups = points.map(point => ({ members: [point], x: point.x, y: point.y }));
  for (let changed = true; changed;) {
    changed = false;
    outer: for (let a = 0; a < groups.length; a++) {
      for (let b = a + 1; b < groups.length; b++) {
        const left = groups[a], right = groups[b];
        const touches = Math.hypot(left.x - right.x, left.y - right.y) < distance || left.members.some(p => right.members.some(q => Math.hypot(p.x - q.x, p.y - q.y) < distance));
        if (!touches) continue;
        left.members.push(...right.members);
        left.x = left.members.reduce((sum, p) => sum + p.x, 0) / left.members.length;
        left.y = left.members.reduce((sum, p) => sum + p.y, 0) / left.members.length;
        groups.splice(b, 1); changed = true; break outer;
      }
    }
  }
  return groups.map(group => ({ x: group.x, y: group.y, places: group.members.map(p => p.place).sort((a, b) => a.id.localeCompare(b.id)) }));
}

export type MapDisplayState = "loading" | "ready" | "tiles-delayed" | "map-error";
type SessionInput = { places: Place[]; selectedId: string | null; focusId: string | null; viewport?: MapViewport; visible?: boolean };
type SessionOptions = SessionInput & {
  container: HTMLElement; maps: NaverMaps;
  onSelect(place: Place): void; onCluster(places: Place[]): void;
  onViewportChange?(viewport: MapViewport): void; onState(state: MapDisplayState): void;
  tileTimeoutMs?: number;
};
function safeView(view: MapViewport): MapViewport {
  if (![view.lat, view.lng, view.zoom].every(Number.isFinite)) return CITY_VIEW;
  return { lat: Math.max(-85, Math.min(85, view.lat)), lng: Math.max(-180, Math.min(180, view.lng)), zoom: Math.max(5, Math.min(18, view.zoom)) };
}
function sameView(a: MapViewport, b: MapViewport) { return Math.abs(a.lat - b.lat) < 0.0000001 && Math.abs(a.lng - b.lng) < 0.0000001 && a.zoom === b.zoom; }

export function createMapSession(options: SessionOptions) {
  const { maps, container } = options;
  let input: SessionInput = { ...options };
  const initialFocus = options.places.find(place => place.id === options.focusId);
  let view = safeView(options.viewport ?? (initialFocus ? { lat: initialFocus.lat, lng: initialFocus.lng, zoom: 15 } : CITY_VIEW));
  let map: MapInstance | undefined;
  let disposed = false, frame = 0;
  let tileTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners: object[] = [];
  const markers = new Map<string, { marker: Marker; button: HTMLButtonElement; group: Group; activate: (event: Event) => void }>();
  function renderGroups() {
    if (disposed || !map || input.visible === false) return;
    const projection = map.getProjection();
    const points = input.places.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lng)).map(place => ({ place, ...projection.fromCoordToOffset(new maps.LatLng(place.lat, place.lng)) }));
    const groups = clusterProjectedPlaces(points);
    const keys = new Set<string>();
    groups.forEach(group => {
      if (group.x < -30 || group.y < -30 || group.x > container.clientWidth + 30 || group.y > container.clientHeight + 30) return;
      const key = group.places.map(p => p.id).join("|"); keys.add(key);
      const position = projection.fromOffsetToCoord(new maps.Point(group.x, group.y));
      let item = markers.get(key);
      if (!item) {
        const button = document.createElement("button"); button.type = "button";
        const activate = (event: Event) => {
          event.stopPropagation();
          if (disposed) return;
          const current = markers.get(key)?.group;
          if (!current) return;
          if (current.places.length > 1) options.onCluster(current.places);
          else options.onSelect(current.places[0]);
        };
        button.addEventListener("click", activate);
        const marker = new maps.Marker({ map: map!, position, icon: { content: button, size: new maps.Size(44, 44), anchor: new maps.Point(22, 22) } });
        item = { marker, button, group, activate }; markers.set(key, item);
      } else { item.group = group; item.marker.setPosition(position); }
      const selected = group.places.some(p => p.id === input.selectedId);
      item.button.className = `naver-map-marker${group.places.length > 1 ? " naver-map-cluster" : ""}${selected ? " is-selected" : ""}`;
      item.button.textContent = group.places.length > 1 ? String(group.places.length) : "●";
      item.button.setAttribute("aria-label", group.places.length > 1 ? `관광지 ${group.places.length}곳 목록 열기` : `${group.places[0].name} 상세 열기`);
      item.button.setAttribute("aria-pressed", String(selected));
      item.button.title = group.places.map(p => p.name).join(" · ");
    });
    markers.forEach((item, key) => { if (!keys.has(key)) { item.button.removeEventListener("click", item.activate); item.marker.setMap(null); markers.delete(key); } });
  }
  function currentView(): MapViewport {
    if (!map) return view;
    const center = map.getCenter(); return { lat: center.lat(), lng: center.lng(), zoom: map.getZoom() };
  }
  function setView(next: MapViewport) {
    if (disposed) return;
    view = safeView(next);
    if (map) { map.setCenter(new maps.LatLng(view.lat, view.lng)); map.setZoom(view.zoom); renderGroups(); }
  }
  function fitPlaces(places = input.places) {
    if (disposed || !map || !places.length) return;
    if (places.length === 1) { setView({ ...places[0], zoom: 15 }); return; }
    const bounds = new maps.LatLngBounds();
    places.forEach(p => bounds.extend(new maps.LatLng(p.lat, p.lng)));
    map.fitBounds(bounds);
  }
  function measure() {
    if (disposed || input.visible === false || !container.isConnected || !container.clientWidth || !container.clientHeight) return;
    try {
      if (!map) {
        options.onState("loading");
        map = new maps.Map(container, { center: new maps.LatLng(view.lat, view.lng), zoom: view.zoom, draggable: true, pinchZoom: true, keyboardShortcuts: true, scrollWheel: false, minZoom: 5, maxZoom: 18 });
        listeners.push(maps.Event.addListener(map, "idle", () => { if (disposed) return; view = currentView(); options.onViewportChange?.(view); renderGroups(); }));
        listeners.push(maps.Event.addListener(map, "tilesloaded", () => { if (disposed) return; clearTimeout(tileTimer); options.onState("ready"); }));
        tileTimer = setTimeout(() => { if (!disposed) options.onState("tiles-delayed"); }, options.tileTimeoutMs ?? 15_000);
      }
      const center = map.getCenter();
      map.setSize(new maps.Size(container.clientWidth, container.clientHeight));
      map.setCenter(center);
      renderGroups();
    } catch { if (!disposed) options.onState("map-error"); }
  }
  function scheduleMeasure() { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); }
  const observer = new ResizeObserver(scheduleMeasure);
  observer.observe(container);
  measure();
  return {
    update(next: Partial<SessionInput>) {
      if (disposed) return;
      const previous = input;
      input = { ...input, ...next };
      const restoringView = next.viewport !== undefined && !sameView(safeView(next.viewport), currentView());
      if (restoringView) setView(next.viewport!);
      if (next.visible !== undefined && next.visible !== previous.visible) measure();
      const membershipChanged = input.places.map(p => p.id).sort().join("|") !== previous.places.map(p => p.id).sort().join("|");
      if (membershipChanged && !restoringView) fitPlaces();
      if (!restoringView && input.focusId && input.focusId !== previous.focusId) {
        const place = input.places.find(p => p.id === input.focusId);
        if (place) { view = { lat: place.lat, lng: place.lng, zoom: 15 }; if (map) { map.panTo(new maps.LatLng(place.lat, place.lng)); map.setZoom(15); } }
      }
      renderGroups();
    },
    setView,
    zoomBy(change: number) { setView({ ...currentView(), zoom: currentView().zoom + change }); },
    fitPlaces,
    destroy() {
      if (disposed) return;
      disposed = true; observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(tileTimer);
      listeners.forEach(handle => maps.Event.removeListener(handle));
      markers.forEach(item => { item.button.removeEventListener("click", item.activate); item.marker.setMap(null); }); markers.clear();
      map?.destroy(); map = undefined;
    },
  };
}

export type MapSession = ReturnType<typeof createMapSession>;
