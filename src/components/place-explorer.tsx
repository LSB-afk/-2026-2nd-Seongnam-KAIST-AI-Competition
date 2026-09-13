"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PLACES, type Place } from "@/lib/places";
import TourismMap from "./tourism-map";

export function PlacePhoto({ place, className = "", priority = false }: { place: Place; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  // Wide panoramas need more source pixels when cover crops them into a tall frame.
  const sizes = place.photo && place.photo.width / place.photo.height > 3
    ? "(max-width:600px) 1200px, 1600px"
    : "(max-width:600px) 100vw, 750px";
  return <div className={`place-photo ${className}`}>
    {place.photo && !failed ? <Image src={place.photo.src} alt={`${place.name} 실제 사진`} fill sizes={sizes} priority={priority} onError={() => setFailed(true)} /> : <div className="photo-unavailable"><span>사진 준비 중</span><small>{place.name}</small></div>}
  </div>;
}

export default function PlaceExplorer({ visible, onCreate }: { visible: boolean; onCreate: (place: Place) => void }) {
  const [query, setQuery] = useState("");
  const [district, setDistrict] = useState("전체 지역");
  const [category, setCategory] = useState("전체 유형");
  const [selected, setSelected] = useState<Place | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "map">("list");
  const [compact, setCompact] = useState(false);
  const [screenMode, setScreenMode] = useState<"pending" | "desktop" | "mobile">("pending");
  const panel = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const filtered = PLACES.filter((place) => (district === "전체 지역" || place.district === district) && (category === "전체 유형" || place.type === category) && `${place.name} ${place.description} ${place.address}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1250px)");
    const mobile = window.matchMedia("(max-width: 600px)");
    const update = () => { setCompact(media.matches); setScreenMode(mobile.matches ? "mobile" : "desktop"); };
    const frame = requestAnimationFrame(update);
    media.addEventListener("change", update); mobile.addEventListener("change", update);
    return () => { cancelAnimationFrame(frame); media.removeEventListener("change", update); mobile.removeEventListener("change", update); };
  }, []);
  function choose(place: Place, fly = false) {
    returnFocus.current = document.activeElement as HTMLElement;
    setSelected(place);
    if (fly) setFocusId(place.id);
    if (compact) requestAnimationFrame(() => closeButton.current?.focus());
  }
  function close() { setSelected(null); requestAnimationFrame(() => returnFocus.current?.focus()); }
  return <section className="explorer-page" hidden={!visible} aria-label="관광지 탐색">
    <div className="page-heading"><div><h1>어디의 이야기를<br className="mobile-break" /> 만들어 볼까요?</h1><p>지도를 따라 성남의 장소를 발견하고, 나만의 카드뉴스로 이어가세요.</p></div><span className="region-tag">경기도 성남시</span></div>
    <div className="explorer-filters"><label className="search-field"><span className="sr-only">관광지 검색</span><span aria-hidden="true">⌕</span><input placeholder="장소 이름이나 관심 있는 이야기를 검색하세요" value={query} onChange={(event) => { const value = event.target.value; setQuery(value); if (selected && !`${selected.name} ${selected.description} ${selected.address}`.toLocaleLowerCase().includes(value.trim().toLocaleLowerCase())) { setSelected(null); setFocusId(null); } }} /></label><label><span className="sr-only">지역 필터</span><select value={district} onChange={(event) => { setDistrict(event.target.value); setSelected(null); setFocusId(null); }}><option>전체 지역</option><option>수정구</option><option>중원구</option><option>분당구</option></select></label><label><span className="sr-only">유형 필터</span><select value={category} onChange={(event) => { setCategory(event.target.value); setSelected(null); setFocusId(null); }}><option>전체 유형</option>{[...new Set(PLACES.map((place) => place.type))].map((type) => <option key={type}>{type}</option>)}</select></label></div>
    <div className="explorer-toolbar"><p>공식 자료로 확인한 장소 <strong>{filtered.length}</strong>곳</p><div className="mobile-map-toggle"><button type="button" aria-pressed={mobileView === "list"} onClick={() => setMobileView("list")}>목록</button><button type="button" aria-pressed={mobileView === "map"} onClick={() => setMobileView("map")}>지도</button></div><small>운영정보는 방문 전 공식 안내를 확인해 주세요.</small></div>
    <div className={`explorer-layout ${selected ? "has-detail" : ""} mobile-${mobileView}`}>
      <div className="place-results" aria-label="관광지 검색 결과">
        {filtered.length ? filtered.map((place) => <button type="button" key={place.id} className={`place-result ${selected?.id === place.id ? "selected" : ""}`} aria-pressed={selected?.id === place.id} onClick={() => choose(place, true)}><PlacePhoto place={place} /><div><span className="place-category">{place.district} · {place.type}</span><h2>{place.name}</h2><p>{place.description}</p><span className="place-address">{place.address}</span></div></button>) : <div className="explorer-empty"><h2>조건에 맞는 장소가 없어요.</h2><p>다른 검색어나 지역으로 찾아보세요.</p><button className="secondary-button" type="button" onClick={() => { setQuery(""); setDistrict("전체 지역"); setCategory("전체 유형"); }}>검색 조건 초기화</button></div>}
      </div>
      <div className="map-frame">{visible && (screenMode === "desktop" || (screenMode === "mobile" && mobileView === "map")) && <TourismMap places={filtered} selectedId={selected?.id || null} focusId={focusId} onSelect={(place) => choose(place)} />}<div className="map-instruction">드래그로 이동 · 휠로 확대 · 키보드 방향키 지원</div></div>
      {selected && <>
        {compact && <button type="button" className="detail-backdrop" aria-label="장소 상세 닫기" tabIndex={-1} onClick={close} />}
        <aside ref={panel} className="place-detail" role={compact ? "dialog" : "region"} aria-modal={compact || undefined} aria-label={`${selected.name} 상세 정보`} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); close(); } if (compact && event.key === "Tab") { const nodes = panel.current?.querySelectorAll<HTMLElement>('button:not([disabled]),a[href],input,select,[tabindex="0"]'); if (!nodes?.length) return; const first = nodes[0], last = nodes[nodes.length - 1]; if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } } }}>
          <button ref={closeButton} type="button" className="detail-close" aria-label="장소 상세 닫기" onClick={close}>×</button><PlacePhoto place={selected} key={selected.id} /><div className="detail-content"><span className="place-category">{selected.district} · {selected.type}</span><h2>{selected.name}</h2><p className="detail-description">{selected.description}</p><dl><dt>주소</dt><dd>{selected.address}</dd><dt>운영시간</dt><dd>{selected.operatingHours || "공식 안내 확인 필요"}</dd><dt>휴무</dt><dd>{selected.closedDays || "공식 안내 확인 필요"}</dd><dt>입장료</dt><dd>{selected.admission || "공식 안내 확인 필요"}</dd></dl>{selected.verificationNote && <p className="field-note">{selected.verificationNote}</p>}<a className="official-link" href={selected.sourceUrl} target="_blank" rel="noreferrer">공식 장소 안내 ↗</a><a className="directions-link" href={`https://www.openstreetmap.org/directions?to=${selected.lat}%2C${selected.lng}`} target="_blank" rel="noreferrer">길찾기 · 외부 지도에서 열기 ↗</a><small className="verified-at">자료 확인 {selected.verifiedAt}</small><details className="photo-credit"><summary>사진 출처와 이용 조건</summary>{selected.photo ? <p>{selected.photo.author} · <a href={selected.photo.licenseUrl} target="_blank" rel="noreferrer">{selected.photo.license}</a><br /><a href={selected.photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문 보기</a></p> : <p>현재 제공되는 사진이 없습니다.</p>}</details><button className="primary-button" type="button" onClick={() => { onCreate(selected); close(); }}>이 장소로 카드뉴스 만들기 <span aria-hidden="true">＋</span></button></div>
        </aside>
      </>}
    </div>
  </section>;
}
