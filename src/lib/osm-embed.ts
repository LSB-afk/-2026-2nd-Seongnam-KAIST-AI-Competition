import type { Place } from "./places";
import { CITY_VIEW, type MapViewport } from "./naver-maps";

type Point = Pick<Place, "id" | "lat" | "lng">;
const valid = (point: { lat: number; lng: number }) => Number.isFinite(point.lat) && Math.abs(point.lat) <= 85 && Number.isFinite(point.lng) && Math.abs(point.lng) <= 180;

/** Official embed accepts one marker (lat,lng) and a bbox (west,south,east,north). */
export function getOsmEmbed(places: Point[], selectedId: string | null, viewport?: MapViewport) {
  const points = places.filter(valid);
  const selected = points.find(place => place.id === selectedId);
  const explicit = viewport && valid(viewport) && Number.isFinite(viewport.zoom) ? { ...viewport, zoom: Math.max(5, Math.min(18, Math.round(viewport.zoom))) } : undefined;
  let view = explicit ?? (selected ? { lat: selected.lat, lng: selected.lng, zoom: 15 } : CITY_VIEW);
  let bounds: number[];
  if (!explicit && !selected && points.length) {
    const west = Math.min(...points.map(p => p.lng)), east = Math.max(...points.map(p => p.lng));
    const south = Math.min(...points.map(p => p.lat)), north = Math.max(...points.map(p => p.lat));
    const padLng = Math.max(.025, (east - west) * .25), padLat = Math.max(.02, (north - south) * .25);
    bounds = [west - padLng, south - padLat, east + padLng, north + padLat];
    view = { lat: (north + south) / 2, lng: (east + west) / 2, zoom: 12 };
  } else {
    const span = 1080 / 2 ** view.zoom;
    bounds = [view.lng - span / 2, view.lat - span * .4, view.lng + span / 2, view.lat + span * .4];
  }
  bounds = bounds.map((value, index) => Number(Math.max(index % 2 ? -85 : -180, Math.min(index % 2 ? 85 : 180, value)).toFixed(7)));
  const src = new URL("https://www.openstreetmap.org/export/embed.html");
  src.searchParams.set("bbox", bounds.join(","));
  src.searchParams.set("layer", "mapnik");
  const full = new URL("https://www.openstreetmap.org/");
  if (selected) {
    src.searchParams.set("marker", `${selected.lat},${selected.lng}`);
    full.searchParams.set("mlat", String(selected.lat)); full.searchParams.set("mlon", String(selected.lng));
  }
  full.hash = `map=${view.zoom}/${view.lat}/${view.lng}`;
  return { src: src.href, fullUrl: full.href };
}
