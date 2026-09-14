"use client";

import { useEffect, useState } from "react";
import type { Place } from "../lib/places";
import { CITY_VIEW, WORLD_VIEW, type MapViewport } from "../lib/naver-maps";
import { getOsmEmbed } from "../lib/osm-embed";

function EmbeddedMap({ src }: { src: string }) {
  const [documentLoaded, setDocumentLoaded] = useState(false);
  const [delayed, setDelayed] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDelayed(true), 12_000);
    return () => clearTimeout(timer);
  }, []);
  return <div className="osm-map-viewport">
    <iframe src={src} title="성남 관광지 기본 지도 — OpenStreetMap" onLoad={() => setDocumentLoaded(true)} />
    {!documentLoaded && <p className="osm-map-loading" role="status">{delayed ? "지도 응답이 늦어지고 있어요. 아래에서 다시 불러오거나 큰 지도를 열어 주세요." : "기본 지도를 불러오고 있어요."}</p>}
  </div>;
}

export default function OsmTourismMap({ places, selectedId, viewport, onViewportChange, onSelect, visible = true, reason, onRetryPrimary }: {
  places: Place[]; selectedId: string | null; viewport?: MapViewport; visible?: boolean;
  onViewportChange?: (view: MapViewport) => void; onSelect: (place: Place) => void; reason: string; onRetryPrimary?: () => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [localView, setLocalView] = useState<MapViewport>();
  const selected = places.find(place => place.id === selectedId);
  const view = onViewportChange ? viewport : localView;
  const { src, fullUrl } = getOsmEmbed(places, selectedId, view);
  const setView = (next: MapViewport) => { setLocalView(next); onViewportChange?.(next); };
  return <div className="tourism-map osm-tourism-map" hidden={!visible} role="region" aria-label="성남 관광지 지도" data-map-provider="openstreetmap" data-map-fallback-reason={reason}>
    <div className="osm-map-toolbar">
      <div className="osm-map-location"><button type="button" onClick={() => setView(WORLD_VIEW)}>전국 보기</button><button type="button" onClick={() => setView(CITY_VIEW)}>성남 둘러보기</button></div>
      <label><span className="sr-only">지도에 표시할 장소</span><select aria-label="지도에 표시할 장소" value={selected?.id ?? ""} onChange={event => { const place = places.find(item => item.id === event.target.value); if (place) onSelect(place); }}>
        <option value="" disabled>{places.length ? "장소를 선택해 위치 보기" : "검색 결과가 없어요"}</option>
        {places.map(place => <option key={place.id} value={place.id}>{place.name}</option>)}
      </select></label>
    </div>
    <EmbeddedMap key={`${src}:${attempt}`} src={src} />
    <div className="osm-map-footer">
      <p><strong>OpenStreetMap · 기본 지도</strong><span>{selected ? `${selected.name} 위치에 핀을 표시해요.` : "목록이나 위 선택란에서 장소를 고르면 위치에 핀을 표시해요."}</span></p>
      <div>{onRetryPrimary && <button type="button" onClick={onRetryPrimary}>NAVER 지도 재연결</button>}<button type="button" onClick={() => setAttempt(value => value + 1)}>지도 다시 불러오기</button><a href={fullUrl} target="_blank" rel="noreferrer">큰 지도 열기 ↗</a></div>
    </div>
  </div>;
}
