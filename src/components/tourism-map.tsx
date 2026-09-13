"use client";
/* eslint-disable @next/next/no-img-element -- OSM visible tiles must load directly with native browser caching, without image optimization or proxying. */

import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/places";

type View = { lat: number; lng: number; zoom: number };
const TILE = 256;
const WORLD = { lat: 36.3, lng: 127.7, zoom: 7 };
const CITY = { lat: 37.415, lng: 127.115, zoom: 12 };
function project(lat: number, lng: number, zoom: number) {
  const scale = TILE * 2 ** zoom;
  const sine = Math.sin(Math.max(-85, Math.min(85, lat)) * Math.PI / 180);
  return { x: (lng + 180) / 360 * scale, y: (0.5 - Math.log((1 + sine) / (1 - sine)) / (4 * Math.PI)) * scale };
}
function unproject(x: number, y: number, zoom: number): View {
  const scale = TILE * 2 ** zoom;
  return { lng: ((x / scale * 360) % 360 + 360) % 360 - 180, lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * y / scale))) * 180 / Math.PI, zoom };
}
function zoomView(view: View, change: number): View { return { ...view, zoom: Math.min(18, Math.max(5, view.zoom + change)) }; }

export default function TourismMap({ places, selectedId, focusId, onSelect }: { places: Place[]; selectedId: string | null; focusId: string | null; onSelect: (place: Place) => void }) {
  const element = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>(WORLD);
  const [size, setSize] = useState({ width: 600, height: 640 });
  const [failed, setFailed] = useState(false);
  const [retry, setRetry] = useState(0);
  const drag = useRef<{ x: number; y: number; center: { x: number; y: number }; moved: boolean } | null>(null);
  const focusPlace = places.find((place) => place.id === focusId);
  useEffect(() => {
    if (!focusPlace) return;
    const frame = requestAnimationFrame(() => setView({ lat: focusPlace.lat, lng: focusPlace.lng, zoom: 15 }));
    return () => cancelAnimationFrame(frame);
  }, [focusPlace]);
  useEffect(() => {
    if (!element.current) return;
    const node = element.current;
    const observer = new ResizeObserver(([entry]) => { if (entry.contentRect.width) setSize({ width: entry.contentRect.width, height: entry.contentRect.height }); });
    observer.observe(node);
    const wheel = (event: WheelEvent) => { event.preventDefault(); setView((current) => zoomView(current, event.deltaY < 0 ? 1 : -1)); };
    node.addEventListener("wheel", wheel, { passive: false });
    return () => { observer.disconnect(); node.removeEventListener("wheel", wheel); };
  }, []);
  const center = project(view.lat, view.lng, view.zoom);
  const left = center.x - size.width / 2;
  const top = center.y - size.height / 2;
  const tiles: { x: number; y: number; src: string }[] = [];
  for (let y = Math.floor(top / TILE); y <= Math.floor((top + size.height) / TILE); y++) {
    for (let x = Math.floor(left / TILE); x <= Math.floor((left + size.width) / TILE); x++) {
      if (y < 0 || y >= 2 ** view.zoom) continue;
      const wrapped = ((x % 2 ** view.zoom) + 2 ** view.zoom) % 2 ** view.zoom;
      tiles.push({ x, y, src: `https://tile.openstreetmap.org/${view.zoom}/${wrapped}/${y}.png` });
    }
  }
  const groups = new Map<string, { places: Place[]; x: number; y: number }>();
  places.forEach((place) => {
    const position = project(place.lat, place.lng, view.zoom);
    const x = position.x - left, y = position.y - top;
    if (x < -40 || y < -40 || x > size.width + 40 || y > size.height + 40) return;
    const key = `${Math.floor(x / 60)}:${Math.floor(y / 60)}`;
    const previous = groups.get(key);
    if (previous) { const count = previous.places.length; previous.x = (previous.x * count + x) / (count + 1); previous.y = (previous.y * count + y) / (count + 1); previous.places.push(place); }
    else groups.set(key, { places: [place], x, y });
  });
  return <div className="tourism-map" ref={element} tabIndex={0} role="region" aria-label="성남 관광지 지도. 화살표로 이동, 더하기와 빼기로 확대 축소"
    onKeyDown={(event) => { if (event.target !== event.currentTarget) return; const offsets: Record<string, [number, number]> = { ArrowLeft: [-100, 0], ArrowRight: [100, 0], ArrowUp: [0, -100], ArrowDown: [0, 100] }; if (offsets[event.key]) { event.preventDefault(); const [x,y] = offsets[event.key]; setView(unproject(center.x + x, center.y + y, view.zoom)); } else if (["+", "=", "-"].includes(event.key)) { event.preventDefault(); setView(zoomView(view, event.key === "-" ? -1 : 1)); } }}
    onPointerDown={(event) => { if ((event.target as HTMLElement).closest("button,a")) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { x: event.clientX, y: event.clientY, center, moved: false }; }}
    onPointerMove={(event) => { if (!drag.current) return; const dx = event.clientX - drag.current.x, dy = event.clientY - drag.current.y; if (Math.abs(dx) + Math.abs(dy) > 3) drag.current.moved = true; setView(unproject(drag.current.center.x - dx, drag.current.center.y - dy, view.zoom)); }}
    onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
    <div className="map-tiles" aria-hidden="true">{tiles.map((tile) => <img key={`${tile.src}-${retry}`} src={tile.src} width={256} height={256} alt="" draggable={false} style={{ left: tile.x * TILE - left, top: tile.y * TILE - top }} onError={() => setFailed(true)} />)}</div>
    <div className="map-location-controls"><button type="button" onClick={() => setView(WORLD)}>전국 보기</button><button type="button" onClick={() => setView(CITY)}>성남 둘러보기</button></div>
    <div className="map-zoom-controls"><button type="button" aria-label="지도 확대" disabled={view.zoom >= 18} onClick={() => setView(zoomView(view, 1))}>＋</button><button type="button" aria-label="지도 축소" disabled={view.zoom <= 5} onClick={() => setView(zoomView(view, -1))}>−</button></div>
    {[...groups.entries()].map(([key, group]) => <button key={key} type="button" className={`map-marker ${group.places.length > 1 ? "cluster" : ""} ${group.places.some((place) => place.id === selectedId) ? "selected" : ""}`} style={{ left: group.x, top: group.y }} aria-label={group.places.length > 1 ? `성남시 관광지 ${group.places.length}곳 모아 보기` : `${group.places[0].name} 지도에서 선택`} onClick={() => { if (group.places.length > 1) setView({ ...unproject(group.x + left, group.y + top, view.zoom), zoom: Math.min(18, view.zoom + 2) }); else onSelect(group.places[0]); }}><span>{group.places.length > 1 ? group.places.length : "●"}</span>{group.places.length > 1 && view.zoom <= 9 && <small className="city-cluster-label">성남시</small>}{group.places.length === 1 && <small>{group.places[0].name}</small>}</button>)}
    {failed && <div className="map-error" role="status">지도 일부를 불러오지 못했습니다.<button type="button" onClick={() => { setFailed(false); setRetry((value) => value + 1); }}>지도 다시 불러오기</button></div>}
    <div className="map-attribution"><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a></div>
  </div>;
}
