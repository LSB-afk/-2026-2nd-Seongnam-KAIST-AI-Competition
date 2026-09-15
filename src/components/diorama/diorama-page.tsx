'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DIORAMA_STOPS, getDiorama, selectionFromStop, selectionStopId, type DioramaSelection } from '@/lib/diorama/data';
import { CITY_DISTRICTS, CITY_LANDMARKS, projectCityCoordinate } from '@/lib/diorama/city-data';
import { createTourState, decodeTourSettings, reduceTour, type TourEvent, type TourSettings } from '@/lib/diorama/tour';
import type { RenderCallbacks, RenderOptions } from '@/lib/diorama/renderer';
import { getPlace, type Place } from '@/lib/places';
import { getOsmEmbed } from '@/lib/osm-embed';
import { PlacePhoto } from '@/components/place-explorer';
import DioramaCanvas, { type DioramaCanvasHandle } from './diorama-canvas';
import urbanIndexData from '@/lib/diorama/seongnam-urban-index.json';
import { createUrbanDirectory, matchesDirectoryQuery, searchUrbanDirectory, type UrbanDirectoryEntry, type UrbanIndex } from '@/lib/diorama/urban-directory';
import './diorama.css';

const URBAN_INDEX = urbanIndexData as unknown as UrbanIndex;
const URBAN_ENTRIES = createUrbanDirectory(URBAN_INDEX);
const LANDMARK_PAGE_SIZE = 8;
const SETTINGS_KEY = 'timestory:diorama-settings:v1';
type Props = {
  selection: DioramaSelection;
  onSelectionChange: (selection: DioramaSelection, push?: boolean) => void;
  savedIds: string[];
  onToggleSaved: (id: string) => void;
  onCreate: (place: Place) => void;
  busy: boolean;
};

export default function DioramaPage(props: Props) {
  const [tour, setTour] = useState(() => createTourState(selectionStopId(props.selection)));
  const currentTour = useRef(tour);
  const actions = useRef(props);
  const canvas = useRef<DioramaCanvasHandle>(null);
  const panelToggle = useRef<HTMLButtonElement>(null);
  const panelBody = useRef<HTMLDivElement>(null);
  const settingsToggle = useRef<HTMLButtonElement>(null);
  const settingsPanel = useRef<HTMLDivElement>(null);
  const catalogueToggle = useRef<HTMLButtonElement>(null);
  const [compact, setCompact] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renderStatus, setRenderStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [retry, setRetry] = useState(0);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [settingsReady, setSettingsReady] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const [savedOnly, setSavedOnly] = useState(false);
  const [directoryMode, setDirectoryMode] = useState<'landmarks' | 'urban'>('landmarks');
  const [landmarkQuery, setLandmarkQuery] = useState('');
  const [landmarkPage, setLandmarkPage] = useState(0);
  const [catalogueOpen, setCatalogueOpen] = useState(true);
  const [urbanQuery, setUrbanQuery] = useState('');
  const [selectedUrban, setSelectedUrban] = useState<UrbanDirectoryEntry | null>(null);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 700px)');
    const update = () => {
      if (media.matches && (panelBody.current?.contains(document.activeElement) || panelToggle.current === document.activeElement)) {
        const target = settingsPanel.current && !settingsPanel.current.hidden ? settingsToggle : panelToggle;
        target.current?.focus({ preventScroll: true });
      }
      setPanelOpen(!media.matches);
      setCompact(media.matches);
    };
    let alive = true;
    queueMicrotask(() => { if (alive) update(); });
    media.addEventListener('change', update);
    return () => { alive = false; media.removeEventListener('change', update); };
  }, []);
  const selection = useMemo(() => selectionFromStop(tour.stopId), [tour.stopId]);
  const scene = getDiorama(selection.placeId);
  const place = getPlace(scene.placeId);
  const district = CITY_DISTRICTS.find(item => selection.placeId === 'seongnam' ? item.id === selection.hotspotId : item.name === place?.district);
  const filteredLandmarks = useMemo(() => CITY_LANDMARKS.filter(item => matchesDirectoryQuery([item.name, item.district, getPlace(item.placeId)?.type ?? ''], landmarkQuery)), [landmarkQuery]);
  const pageCount = Math.max(1, Math.ceil(filteredLandmarks.length / LANDMARK_PAGE_SIZE));
  const currentPage = Math.min(landmarkPage, pageCount - 1);
  const visibleLandmarks = filteredLandmarks.slice(currentPage * LANDMARK_PAGE_SIZE, (currentPage + 1) * LANDMARK_PAGE_SIZE);
  const nearby = useMemo(() => {
    const selected = selectionFromStop(tour.stopId);
    const selectedPlace = getPlace(selected.placeId);
    const selectedDistrict = CITY_DISTRICTS.find(item => item.id === selected.hotspotId);
    return searchUrbanDirectory(URBAN_ENTRIES, urbanQuery, selectedPlace ? projectCityCoordinate(selectedPlace.lng, selectedPlace.lat) : selectedDistrict?.center ?? [0, 0, 0]);
  }, [urbanQuery, tour.stopId]);
  const hotspot = scene.hotspots.find(spot => spot.id === selection.hotspotId);
  const eligibleStops = useMemo(() => DIORAMA_STOPS.filter(id => !savedOnly || props.savedIds.includes(selectionFromStop(id).placeId)), [savedOnly, props.savedIds]);
  const eligible = useRef(eligibleStops);
  const running = tour.status === 'loading' || tour.status === 'transition' || tour.status === 'dwelling';
  const map = place ? getOsmEmbed([place], place.id) : null;
  useEffect(() => { actions.current = props; eligible.current = eligibleStops; });
  const send = useCallback((event: TourEvent, push = false, syncSelection = true) => {
    const previous = currentTour.current;
    const next = reduceTour(previous, event);
    if (next === previous) return;
    currentTour.current = next;
    setTour(next);
    if (syncSelection && next.stopId && next.stopId !== previous.stopId) actions.current.onSelectionChange(selectionFromStop(next.stopId), push);
  }, []);
  useEffect(() => {
    const stopId = selectionStopId(props.selection);
    if (currentTour.current.stopId !== stopId) {
      queueMicrotask(() => {
        setSelectedUrban(null);
        setDirectoryMode('landmarks');
        if (props.selection.placeId === 'seongnam' || !props.selection.hotspotId) send({ type: 'stop' }, false, false);
        send({ type: 'select', stopId }, false, false);
      });
    }
  }, [props.selection, send]);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches);
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      update();
      try { send({ type: 'settings', settings: decodeTourSettings(localStorage.getItem(SETTINGS_KEY)) }); }
      catch { setStorageError(true); }
      setSettingsReady(true);
    });
    media.addEventListener('change', update);
    const hidden = () => { if (document.hidden) send({ type: 'hidden' }); };
    document.addEventListener('visibilitychange', hidden);
    return () => { alive = false; media.removeEventListener('change', update); document.removeEventListener('visibilitychange', hidden); };
  }, [send]);
  useEffect(() => {
    if (!settingsReady) return;
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(tour.settings)); }
    catch { queueMicrotask(() => setStorageError(true)); }
  }, [settingsReady, tour.settings]);
  const eligibleKey = eligibleStops.join('|');
  useEffect(() => {
    // A changed filter stops the tour. Keep the selected place available for reading.
    queueMicrotask(() => send({ type: 'stop' }));
  }, [eligibleKey, send]);
  useEffect(() => {
    if (tour.status !== 'dwelling') return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now(), elapsedMs = now - last;
      last = now;
      if (document.hidden) { send({ type: 'hidden' }); return; }
      send({ type: 'tick', elapsedMs, eligibleStopIds: eligible.current, requestId: tour.requestId });
    }, 250);
    return () => clearInterval(timer);
  }, [tour.status, tour.requestId, send]);
  const showUrban = useCallback((entry: UrbanDirectoryEntry) => {
    send({ type: 'stop' });
    setSelectedUrban(entry);
    setDirectoryMode('urban');
    setPanelOpen(true);
    panelBody.current?.scrollTo({ top: 0 });
    if (window.matchMedia('(max-width: 700px)').matches) setSettingsOpen(false);
  }, [send]);
  const select = useCallback((next: DioramaSelection) => {
    if (document.getElementById('diorama-landmark-results')?.contains(document.activeElement)) catalogueToggle.current?.focus({ preventScroll: true });
    setSelectedUrban(null);
    setDirectoryMode('landmarks');
    setCatalogueOpen(next.placeId === 'seongnam');
    panelBody.current?.scrollTo({ top: 0 });
    if (next.placeId === 'seongnam' || !next.hotspotId) send({ type: 'stop' });
    send({ type: 'select', stopId: selectionStopId(next) }, true);
  }, [send]);
  const callbacks = useMemo<RenderCallbacks>(() => ({
    onReady: (stopId, requestId) => { setRenderStatus('ready'); send({ type: 'loaded', stopId, requestId }); },
    onArrived: (stopId, requestId) => send({ type: 'arrived', stopId, requestId }),
    onManual: () => send({ type: 'manual' }),
    onHidden: () => send({ type: 'hidden' }),
    onHotspot: hotspotId => select({ ...selectionFromStop(currentTour.current.stopId), hotspotId }),
    onSelect: select,
    onUrbanSelect: id => {
      const entry = URBAN_ENTRIES.find(item => item.id === id && item.kind === 'poi');
      if (entry) showUrban(entry);
    },
    onError: () => {
      setRenderStatus('error');
      const state = currentTour.current;
      if (state.stopId) send({ type: 'error', stopId: state.stopId, requestId: state.requestId });
    },
  }), [select, send, showUrban]);
  const options = useMemo<RenderOptions>(() => ({ ...tour.settings, requestId: tour.requestId, phase: tour.status, reducedMotion: reducedMotion || !settingsReady }), [tour.settings, tour.requestId, tour.status, reducedMotion, settingsReady]);
  function seedOverview() {
    const current = selectionFromStop(currentTour.current.stopId);
    if (current.placeId !== 'seongnam' && current.hotspotId) return false;
    const first = eligibleStops.find(id => selectionFromStop(id).placeId === current.placeId) ?? eligibleStops[0];
    if (!first) return false;
    send({ type: 'select', stopId: first });
    return true;
  }
  function playOrPause() {
    if (running) { send({ type: 'pause' }); return; }
    setSelectedUrban(null);
    setDirectoryMode('landmarks');
    setCatalogueOpen(false);
    seedOverview();
    send({ type: 'play', eligibleStopIds: eligibleStops });
  }
  function nextStop() {
    setSelectedUrban(null);
    setDirectoryMode('landmarks');
    setCatalogueOpen(false);
    if (!seedOverview()) send({ type: 'next', eligibleStopIds: eligibleStops });
  }
  function setting(patch: Partial<TourSettings>) { send({ type: 'settings', settings: patch }); }
  function closePanel() {
    setPanelOpen(false);
    panelToggle.current?.focus({ preventScroll: true });
  }
  function closeSettings() {
    setSettingsOpen(false);
    settingsToggle.current?.focus({ preventScroll: true });
  }
  function togglePanel() {
    if (panelOpen) { closePanel(); return; }
    if (window.matchMedia('(max-width: 700px)').matches) setSettingsOpen(false);
    setPanelOpen(true);
  }
  function toggleSettings() {
    if (settingsOpen) { closeSettings(); return; }
    if (window.matchMedia('(max-width: 700px)').matches) setPanelOpen(false);
    setSettingsOpen(true);
  }
  const statusText = tour.status === 'paused' ? '감상을 잠시 멈췄어요' : tour.status === 'manual' ? '직접 둘러보는 중' : tour.status === 'dwelling' ? `다음 풍경까지 ${Math.ceil(tour.remainingMs / 1000)}초` : running ? '다음 풍경으로 이동 중' : '원하는 곳부터 둘러보세요';
  return <section className="diorama-page" aria-labelledby="diorama-title" data-panel-open={panelOpen} data-settings-open={settingsOpen} onKeyDown={event => {
    if (event.key !== 'Escape') return;
    const target = event.target as Node;
    if (settingsOpen && !panelBody.current?.contains(target)) closeSettings();
    else if (panelOpen) closePanel();
    else return;
    event.preventDefault();
    event.stopPropagation();
  }}>
    <header className="diorama-heading" data-tami-avoid=""><span className="diorama-eyebrow">SEONGNAM · CITY EXPLORER</span><h1 id="diorama-title">성남 3D 여행<span aria-hidden="true">.</span></h1><span className="diorama-heading-note">하나로 이어진 도시, {CITY_LANDMARKS.length}개의 여행 명소</span></header>
    <div className="diorama-districts" aria-label="지역 둘러보기" data-tami-avoid="">
      <button type="button" aria-label="성남 전체 보기" aria-pressed={selection.placeId === 'seongnam' && !selection.hotspotId} onClick={() => select({ placeId: 'seongnam', hotspotId: null })}><span aria-hidden="true">◎</span> 성남 전체</button>
      {CITY_DISTRICTS.map(item => <button type="button" key={item.id} aria-label={`${item.name} 지역 보기`} aria-pressed={selection.placeId === 'seongnam' && selection.hotspotId === item.id} onClick={() => select({ placeId: 'seongnam', hotspotId: item.id })}><span className="diorama-district-dot" style={{ background: item.color }} aria-hidden="true" />{item.name}</button>)}
    </div>
    <div className="diorama-experience">
      <div className="diorama-scene-column">
        <div className="diorama-stage-wrap">
          <DioramaCanvas key={retry} ref={canvas} selection={selection} options={options} callbacks={callbacks} retry={retry} />
          <div className="diorama-camera-controls" data-tami-avoid="" aria-label="카메라 조작"><button type="button" aria-label="확대" disabled={renderStatus !== 'ready'} onClick={() => canvas.current?.zoom(1.2)}>+</button><button type="button" aria-label="축소" disabled={renderStatus !== 'ready'} onClick={() => canvas.current?.zoom(1 / 1.2)}>−</button><button type="button" aria-label="시점 초기화" disabled={renderStatus !== 'ready'} onClick={() => canvas.current?.reset()}>↺</button></div>
          <div className="diorama-stage-footer"><span>드래그로 회전 · 스크롤로 확대</span><span>공개 지도 기반 · 높이 일부 추정</span><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" data-tami-avoid="">© OpenStreetMap</a></div>
        </div>
        <div className="diorama-player" data-tami-avoid="" aria-label="자동 감상 제어">
          <button type="button" className="diorama-play" disabled={renderStatus !== 'ready' || !eligibleStops.length} onClick={playOrPause} aria-label={running ? '감상 일시정지' : tour.status === 'paused' ? '자동 감상 계속' : '자동 감상 시작'}><span aria-hidden="true">{running ? 'Ⅱ' : '▶'}</span>{running ? '일시정지' : tour.status === 'paused' ? '이어서 감상' : '자동 감상'}</button>
          <div className="diorama-play-status"><strong>{statusText}</strong><span>{eligibleStops.length ? `${eligibleStops.length}개의 관찰 지점 · 설명당 ${tour.settings.dwellSeconds}초` : '저장한 3D 장소가 아직 없어요.'}</span></div>
          <button type="button" className="diorama-small-control" aria-label="다음 관찰 지점" disabled={renderStatus !== 'ready' || !eligibleStops.length} onClick={nextStop}>다음 →</button>
          {(running || tour.status === 'paused') && <button type="button" className="diorama-small-control diorama-stop" onClick={() => send({ type: 'stop' })}>감상 종료</button>}
          <button type="button" className="diorama-settings-toggle" ref={settingsToggle} aria-label="감상 설정" aria-expanded={settingsOpen} aria-controls="diorama-settings" onClick={toggleSettings}><span aria-hidden="true">⚙</span><span>설정</span></button>
        </div>
        <div className="diorama-settings-panel" id="diorama-settings" ref={settingsPanel} hidden={!settingsOpen} data-tami-avoid="" role="region" aria-label="감상 설정">
          <div className="diorama-settings-heading"><h2>감상 설정</h2><button type="button" aria-label="감상 설정 닫기" onClick={closeSettings}>×</button></div>
          <div className="diorama-options">
          <label>이동 속도<select aria-label="이동 속도" value={tour.settings.speed} onChange={event => setting({ speed: Number(event.target.value) })}>{[.5, 1, 1.5, 2].map(value => <option key={value} value={value}>{value}×</option>)}</select></label>
          <label>설명 감상<select aria-label="설명 감상 시간" value={tour.settings.dwellSeconds} onChange={event => setting({ dwellSeconds: Number(event.target.value) })}>{[6, 10, 15, 20, 30].map(value => <option key={value} value={value}>{value}초</option>)}</select></label>
          <label><input type="checkbox" checked={tour.settings.labels} onChange={event => setting({ labels: event.target.checked })} />이름표</label>
          <label><input type="checkbox" checked={tour.settings.tourists} onChange={event => setting({ tourists: event.target.checked })} />사람들</label>
          <label><input type="checkbox" checked={tour.settings.traffic} onChange={event => setting({ traffic: event.target.checked })} />자동차</label>
          <label>도시 활기<select aria-label="도시 활기" value={tour.settings.density} onChange={event => setting({ density: Number(event.target.value) })}><option value={.5}>여유롭게</option><option value={1}>활기차게</option><option value={2}>북적북적</option></select></label>
          <label>사람 크기<select aria-label="사람 크기" value={tour.settings.peopleScale} onChange={event => setting({ peopleScale: Number(event.target.value) })}><option value={1}>기본</option><option value={1.7}>잘 보이게</option><option value={2.5}>더 크게</option></select></label>
          <label><input type="checkbox" checked={tour.settings.motion} onChange={event => setting({ motion: event.target.checked })} />움직임 사용</label>
          <label><input type="checkbox" checked={tour.settings.repeat} onChange={event => setting({ repeat: event.target.checked })} />반복 감상</label>
          <label><input type="checkbox" checked={savedOnly} onChange={event => setSavedOnly(event.target.checked)} />저장한 장소만 감상</label>
        </div>
        {reducedMotion && <p className="diorama-preference-note">기기의 모션 줄이기 설정을 적용했어요.</p>}
        {storageError && <p className="diorama-preference-note" role="status">설정을 저장하지 못했어요. 현재 화면에서는 계속 사용할 수 있어요.</p>}
          <p className="diorama-preference-note">사람과 자동차는 도시 분위기를 위한 연출이에요.</p>
          <p className="diorama-keyboard-help">3D 화면에 초점을 맞춘 뒤 방향키로 회전, + / −로 확대·축소, Home으로 시점을 되돌려요.</p>
        </div>
        {renderStatus === 'error' && <button className="diorama-retry" type="button" data-tami-avoid="" onClick={() => { send({ type: 'stop' }); setRenderStatus('loading'); setRetry(value => value + 1); }}>3D 화면 다시 불러오기</button>}
      </div>
      <aside className="diorama-detail" aria-label="선택한 장소 정보" hidden={compact && settingsOpen} data-tami-avoid="">
        <button type="button" className="diorama-panel-toggle" ref={panelToggle} aria-label={panelOpen ? '명소 패널 접기' : '명소 패널 열기'} aria-expanded={panelOpen} aria-controls="diorama-place-panel" onClick={togglePanel}>
          <span><small>{directoryMode === 'urban' ? '공개 지도에서 찾은 장소' : place ? '지금 둘러보는 명소' : '성남의 이야기를 찾아요'}</small><strong>{directoryMode === 'urban' && selectedUrban ? selectedUrban.name : place?.name ?? district?.name ?? `성남 전체 · ${CITY_LANDMARKS.length}개 명소`}</strong></span><span className="diorama-panel-chevron" aria-hidden="true">{panelOpen ? '−' : '+'}</span>
        </button>
        <div className="diorama-detail-body" id="diorama-place-panel" ref={panelBody} hidden={!panelOpen}>
        {directoryMode === 'landmarks' && !place && <div className="diorama-city-overview">
          <span className="diorama-detail-kicker">{district ? '지역 둘러보기' : '도시를 한눈에'}</span>
          <h2>{district?.name ?? '성남 전체'}</h2>
          <p className="diorama-place-intro">{district?.description ?? '수정구와 중원구의 동네에서 분당구의 공원까지. 하나로 이어진 성남을 둘러보고, 마음에 드는 명소를 눌러 보세요.'}</p>
          <div className="diorama-city-counts"><div><strong>{CITY_DISTRICTS.length}</strong><span>함께 보는 구</span></div><div><strong>{CITY_LANDMARKS.length}</strong><span>이야기가 있는 명소</span></div></div>
          <p className="diorama-city-tip">명소를 선택하면 실제 사진과 위치를 살펴보고, 그 장소의 카드뉴스도 만들 수 있어요.</p>
        </div>}
        <div className="diorama-directory-modes" role="group" aria-label="장소 종류">
          <button type="button" aria-pressed={directoryMode === 'landmarks'} onClick={() => setDirectoryMode('landmarks')}>명소 <span>{CITY_LANDMARKS.length}</span></button>
          <button type="button" aria-pressed={directoryMode === 'urban'} onClick={() => setDirectoryMode('urban')}>가게·도로</button>
        </div>
        {directoryMode === 'landmarks' && <nav className="diorama-landmarks" aria-label="성남 명소 가까이 보기" data-tami-avoid="">
          <div className="diorama-directory-search"><input type="search" aria-label="명소 검색" placeholder="명소 이름·종류·지역 검색" value={landmarkQuery} onChange={event => { setLandmarkQuery(event.target.value); setLandmarkPage(0); setCatalogueOpen(true); }} />{landmarkQuery && <button type="button" aria-label="명소 검색 지우기" onClick={() => { setLandmarkQuery(''); setLandmarkPage(0); }}>×</button>}</div>
          <div className="diorama-landmarks-heading"><h3>명소 가까이 보기</h3><button type="button" ref={catalogueToggle} aria-expanded={catalogueOpen} aria-controls="diorama-landmark-results" onClick={() => setCatalogueOpen(value => !value)}>{catalogueOpen ? '명소 목록 접기' : '명소 목록 펼치기'}</button></div>
          <div id="diorama-landmark-results" hidden={!catalogueOpen}>
            {!filteredLandmarks.length && <p className="diorama-directory-note" role="status">일치하는 명소가 없어요. 다른 이름이나 지역을 입력해 보세요.</p>}
            {CITY_DISTRICTS.map(item => {
              const landmarks = visibleLandmarks.filter(landmark => landmark.district === item.name);
              return landmarks.length ? <div className="diorama-landmark-group" key={item.id} data-selected={district?.id === item.id || undefined}>
                <h4><span className="diorama-district-dot" style={{ background: item.color }} aria-hidden="true" />{item.name}</h4>
                <div>{landmarks.map(landmark => <button type="button" key={landmark.placeId} aria-label={`${landmark.name} 장면 보기`} aria-pressed={selection.placeId === landmark.placeId} onClick={() => select({ placeId: landmark.placeId, hotspotId: null })}><span>{landmark.name}</span><span aria-hidden="true">↗</span></button>)}</div>
              </div> : null;
            })}
            <div className="diorama-directory-pagination"><button type="button" aria-label="이전 명소 목록" disabled={currentPage === 0} onClick={() => setLandmarkPage(currentPage - 1)}>←</button><span aria-live="polite">{filteredLandmarks.length}개 · {currentPage + 1} / {pageCount}</span><button type="button" aria-label="다음 명소 목록" disabled={currentPage + 1 >= pageCount} onClick={() => setLandmarkPage(currentPage + 1)}>→</button></div>
          </div>
        </nav>}
        {directoryMode === 'urban' && <div className="diorama-urban-directory">
          <div className="diorama-directory-search"><input type="search" aria-label="가게·도로 검색" placeholder="가게·도로 이름이나 주소 검색" value={urbanQuery} onChange={event => setUrbanQuery(event.target.value)} />{urbanQuery && <button type="button" aria-label="가게·도로 검색 지우기" onClick={() => setUrbanQuery('')}>×</button>}</div>
          {selectedUrban && <section className="diorama-urban-selection" aria-label="공개 지도 장소 정보">
            <span className="diorama-detail-kicker">{selectedUrban.category}</span><h2>{selectedUrban.name}</h2>
            <p className="diorama-address">{selectedUrban.address ?? '등록된 주소 없음'}</p>
            <button type="button" className="diorama-urban-focus" disabled={renderStatus !== 'ready'} onClick={() => { send({ type: 'stop' }); canvas.current?.focusCoordinate(selectedUrban.coordinates); }}>지도에서 가까이 보기 <span aria-hidden="true">↗</span></button>
            <a href={selectedUrban.sourceUrl} target="_blank" rel="noreferrer">OpenStreetMap 원본 정보 ↗</a>
          </section>}
          <p className="diorama-directory-note">{place?.name ?? district?.name ?? '성남 중심'} 가까운 순 · 최대 20개</p>
          <p className="diorama-directory-result-count" role="status">검색 결과 {nearby.total.toLocaleString('ko-KR')}개 중 {nearby.entries.length}개</p>
          <div className="diorama-urban-results">{nearby.entries.map(entry => <button type="button" key={entry.key} aria-label={`${entry.name} 정보 보기`} aria-pressed={selectedUrban?.key === entry.key} onClick={() => { showUrban(entry); if (renderStatus === 'ready') canvas.current?.focusCoordinate(entry.coordinates); }}><span><strong>{entry.name}</strong><small>{entry.category}</small></span><span aria-hidden="true">↗</span></button>)}</div>
          {!nearby.total && <p className="diorama-directory-note">공개 지도에 등록된 이름을 찾지 못했어요. 다른 이름이나 도로명을 입력해 보세요.</p>}
          <p className="diorama-map-note">공개 지도에 등록된 위치 · 미등록 가게와 높이는 차이가 있어요.<br />수집된 이름 있는 장소 {URBAN_INDEX.metadata.counts.pois.toLocaleString('ko-KR')}곳 · 도로명 {URBAN_INDEX.roads.length.toLocaleString('ko-KR')}개<br />지도 데이터 기준 {URBAN_INDEX.metadata.inputs.pois.osmBaseTimestamp.slice(0, 10)}</p>
        </div>}
        {directoryMode === 'landmarks' && place && map && <>
        <div className="diorama-detail-heading"><span>{place.type} · {place.district}</span><button type="button" aria-label={`${place.name} ${props.savedIds.includes(place.id) ? '저장 해제' : '저장'}`} aria-pressed={props.savedIds.includes(place.id)} onClick={() => props.onToggleSaved(place.id)}>{props.savedIds.includes(place.id) ? '♥ 저장됨' : '♡ 저장'}</button></div>
        <h2>{place.name}</h2><p className="diorama-place-intro">{place.description}</p>
        <div className="diorama-observe"><span>조금 더 가까이</span><div>{scene.hotspots.map(spot => <button key={spot.id} type="button" aria-label={`${spot.label} 관찰`} aria-pressed={hotspot?.id === spot.id} onClick={() => select({ placeId: scene.placeId, hotspotId: spot.id })}>{spot.label}<span aria-hidden="true">↗</span></button>)}</div></div>
        <div className="diorama-spot-story" aria-live="polite"><strong>{hotspot?.label ?? '풍경 속 이야기를 찾아요'}</strong><p>{hotspot?.description ?? '모형 위 이름표나 관찰 지점을 누르면 관련 이야기가 열려요.'}</p></div>
        <button type="button" className="diorama-create" data-tami-avoid="" disabled={props.busy} onClick={() => { send({ type: 'stop' }); props.onCreate(place); }}>이 장소로 카드뉴스 만들기 <span aria-hidden="true">↗</span></button>
        {props.busy && <p className="diorama-preference-note">진행 중인 제작이 끝나면 새로 만들 수 있어요.</p>}
        <details className="diorama-real-info" open><summary onClick={event => { if (!event.currentTarget.parentElement?.hasAttribute('open') && window.matchMedia('(max-width: 700px)').matches) send({ type: 'pause' }); }}>실제 모습과 위치</summary><PlacePhoto key={`photo:${place.id}`} place={place} retryable sizes="(max-width: 700px) 100vw, 340px" />{place.photo && <p className="diorama-photo-caption">실제 사진 · 3D 모형과 비교해 보세요.</p>}<p className="diorama-address">{place.address}</p><iframe key={`map:${place.id}`} src={map.src} title={`${place.name} 실제 위치 지도`} loading="lazy" referrerPolicy="no-referrer-when-downgrade" /><div className="diorama-source-links"><a href={map.fullUrl} target="_blank" rel="noreferrer">큰 지도 ↗</a><a href={place.sourceUrl} data-tour="official-source" target="_blank" rel="noreferrer">공식 장소 안내 ↗</a></div><p className="diorama-map-note">지도는 실제 위치를 표시해요. 자동 감상 순서는 이동 경로를 뜻하지 않아요.</p></details>
        <details className="diorama-credits"><summary>모형과 사진 안내</summary><p>{scene.modelNote}</p>{place.photo && <p>사진: {place.photo.author} · <a href={place.photo.licenseUrl} target="_blank" rel="noreferrer">{place.photo.license}</a><br /><a href={place.photo.sourceUrl} target="_blank" rel="noreferrer">사진 원문 ↗</a></p>}{place.verificationNote && <p>{place.verificationNote}</p>}<p>방문 전 운영 정보는 공식 안내에서 확인해 주세요.</p></details>
        </>}
        <details className="diorama-credits"><summary>반영된 지도 데이터</summary><p>도로 {urbanIndexData.metadata.counts.roads.toLocaleString('ko-KR')}구간 · 건물 {urbanIndexData.metadata.counts.buildings.toLocaleString('ko-KR')}건 · 이름 있는 장소 {urbanIndexData.metadata.counts.pois.toLocaleString('ko-KR')}곳</p><p>상점 {urbanIndexData.metadata.counts.namedShops.toLocaleString('ko-KR')}곳과 음식점·카페 등 {urbanIndexData.metadata.counts.namedFoodVenues.toLocaleString('ko-KR')}곳을 포함한 공개 지도 기록이에요. 성남 전체 업소의 수를 뜻하지 않아요.</p><p>지도 기준 {URBAN_INDEX.metadata.inputs.pois.osmBaseTimestamp.slice(0, 10)} · 높이 없는 건물은 층수 또는 9m로 표현하고, 등록되지 않은 도로 폭·교량 높이는 추정해요. 사람과 차량은 실제 통행량과 관계없는 모형이에요.</p></details>
        <p className="diorama-city-attribution">경계·도로·건물·장소 · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a> · ODbL<br />공개 지도에 등록된 위치를 바탕으로 했어요. 미등록 가게와 건물 높이는 차이가 있어요.</p>
        </div>
      </aside>
    </div>

  </section>;
}
