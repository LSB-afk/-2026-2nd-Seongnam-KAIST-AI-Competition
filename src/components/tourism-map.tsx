"use client";

import { useEffect, useRef, useState } from "react";
import type { Place } from "@/lib/places";
import type { MapConfig } from "@/lib/map-config";
import { CITY_VIEW, WORLD_VIEW, createMapSession, loadNaverMaps, MapSdkError, subscribeNaverFailure, type MapDisplayState, type MapSession, type MapViewport } from "@/lib/naver-maps";
import "./tourism-map.css";

type Props = { places: Place[]; selectedId: string | null; focusId: string | null; onSelect: (place: Place) => void; viewport?: MapViewport; onViewportChange?: (view: MapViewport) => void; visible?: boolean };
type Status = MapDisplayState | "config-missing" | "config-network" | MapSdkError["code"];
const STATUS_TEXT: Record<Status, string> = {
  loading: "지도를 불러오고 있어요.",
  ready: "지도가 준비됐어요.",
  "tiles-delayed": "지도 표시 확인이 지연되고 있어요. 장소 목록은 계속 이용할 수 있어요.",
  "config-missing": "지도를 사용하려면 지도 연결 설정이 필요해요. 장소 목록에서 관광지를 둘러볼 수 있어요.",
  "config-network": "지도 연결 정보를 가져오지 못했어요. 잠시 후 다시 시도해 주세요.",
  authentication: "지도 서비스에서 연결을 승인하지 않았어요. 연결 키와 허용 도메인 설정을 확인해 주세요.",
  "script-network": "지도 서비스를 불러오지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.",
  "sdk-timeout": "지도 서비스 응답이 늦어지고 있어요. 다시 불러오거나 장소 목록을 이용해 주세요.",
  "sdk-invalid": "지도 서비스를 준비하지 못했어요. 다시 불러오거나 장소 목록을 이용해 주세요.",
  "key-conflict": "지도 연결 설정이 변경됐어요. 페이지를 다시 불러와 주세요.",
  "map-error": "지도를 표시하지 못했어요. 장소 목록에서 관광지를 선택할 수 있어요.",
};

export default function TourismMap(props: Props) {
  const { places, selectedId, focusId, viewport, visible = true } = props;
  const stage = useRef<HTMLDivElement>(null);
  const session = useRef<MapSession | null>(null);
  const latest = useRef(props);
  const groupPanel = useRef<HTMLDivElement>(null);
  const groupTrigger = useRef<HTMLElement | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [attempt, setAttempt] = useState(0);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [zoom, setZoom] = useState(viewport?.zoom ?? CITY_VIEW.zoom);
  const group = groupIds.flatMap(id => { const place = places.find(p => p.id === id); return place ? [place] : []; });

  useEffect(() => { latest.current = props; });
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const fail = (error: MapSdkError) => {
      if (cancelled) return;
      session.current?.destroy(); session.current = null;
      setGroupIds([]); setStatus(error.code);
    };
    const unsubscribe = subscribeNaverFailure(fail);
    async function initialize() {
      setStatus("loading");
      try {
        const response = await fetch("/api/map-config", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("config-network");
        const config = await response.json() as MapConfig;
        if (cancelled) return;
        if (config.provider !== "naver" || !config.configured || !config.clientId) { setStatus("config-missing"); return; }
        const maps = await loadNaverMaps(config.clientId);
        if (cancelled || !stage.current) return;
        if (window.__timestoryNaver?.error) { fail(window.__timestoryNaver.error); return; }
        session.current = createMapSession({
          container: stage.current, maps, ...latest.current,
          onSelect: place => latest.current.onSelect(place),
          onViewportChange: view => { if (cancelled) return; setZoom(view.zoom); latest.current.onViewportChange?.(view); },
          onState: state => { if (!cancelled) setStatus(state); },
          onCluster: members => {
            if (cancelled) return;
            groupTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            setGroupIds(members.map(place => place.id));
          },
        });
      } catch (error) {
        if (cancelled) return;
        if (error instanceof MapSdkError) fail(error);
        else setStatus("config-network");
      }
    }
    void initialize();
    return () => { cancelled = true; controller.abort(); unsubscribe(); session.current?.destroy(); session.current = null; };
  }, [attempt]);

  useEffect(() => { session.current?.update({ places, selectedId, focusId, viewport, visible }); }, [places, selectedId, focusId, viewport, visible]);
  useEffect(() => { if (groupIds.length) groupPanel.current?.querySelector<HTMLButtonElement>("button[data-place]")?.focus(); }, [groupIds]);
  function closeGroup() { setGroupIds([]); if (groupTrigger.current?.isConnected) groupTrigger.current.focus(); }
  const usable = status === "ready" || status === "tiles-delayed" || status === "loading";
  return <div className="tourism-map naver-tourism-map" hidden={!visible} role="region" aria-label="성남 관광지 지도">
    <div className="naver-map-stage" ref={stage} tabIndex={0} aria-label="지도. 화살표로 이동하고 확대 축소 버튼을 사용할 수 있어요." />
    {usable && <>
      <div className="naver-map-location-controls"><button type="button" onClick={() => session.current?.setView(WORLD_VIEW)}>전국 보기</button><button type="button" onClick={() => session.current?.setView(CITY_VIEW)}>성남 둘러보기</button></div>
      <div className="naver-map-zoom-controls"><button type="button" aria-label="지도 확대" disabled={zoom >= 18} onClick={() => session.current?.zoomBy(1)}>＋</button><button type="button" aria-label="지도 축소" disabled={zoom <= 5} onClick={() => session.current?.zoomBy(-1)}>−</button></div>
    </>}
    <div className={status === "ready" ? "naver-map-sr-status" : `naver-map-notice${usable ? "" : " is-fallback"}`} role="status" aria-live="polite" data-map-state={status}>
      <span>{STATUS_TEXT[status]}</span>
      {!usable && <button type="button" onClick={() => { if (status === "config-missing" || status === "config-network") setAttempt(value => value + 1); else window.location.reload(); }}>지도 다시 불러오기</button>}
      {status === "tiles-delayed" && <button type="button" onClick={() => window.location.reload()}>지도 다시 불러오기</button>}
    </div>
    {!!group.length && <div className="naver-map-group" ref={groupPanel} role="region" aria-label={`관광지 ${group.length}곳 선택`} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); closeGroup(); } }}>
      <div className="naver-map-group-heading"><strong>가까운 관광지 {group.length}곳</strong><button type="button" aria-label="관광지 묶음 닫기" onClick={closeGroup}>×</button></div>
      <p>둘러볼 장소를 선택해 주세요.</p>
      {group.map(place => <button data-place key={place.id} type="button" className="naver-map-group-place" aria-pressed={place.id === selectedId} onClick={() => { latest.current.onSelect(place); closeGroup(); }}>{place.name}<span>{place.district}</span></button>)}
    </div>}
  </div>;
}
