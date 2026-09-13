import type { Run } from "@/lib/types";
import { PLACES, getPlace, type Place } from "@/lib/places";
import { PlacePhoto } from "./place-explorer";

const labels: Record<Run['status'],string> = { queued:"제작 대기",running:"제작 중",needs_review:"검토 필요",ready_for_approval:"승인 대기",approved:"승인 완료",failed:"제작 실패",cancelled:"취소됨" };
export function RunHistory({ runs, loaded, busy, onOpen, full = false, failed = false }: { runs:Run[];loaded:boolean;busy:boolean;onOpen:(id:string)=>void;full?:boolean;failed?:boolean }) {
  return <section className="history-panel" aria-label={full ? "제작 기록" : "최근 제작 기록"}><div className="section-heading"><div><h2>{full ? "제작 기록" : "최근 만든 이야기"}</h2><p>{full ? "최근 수정한 최대 50개 작업입니다. 다시 열어 편집과 검토를 이어가세요." : "작업 중인 이야기와 승인 상태를 한눈에 확인하세요."}</p></div><span>{loaded ? `${runs.length}개 작업` : failed ? "조회 실패" : "불러오는 중"}</span></div>
    {!loaded ? <p className="history-empty" role="status">{failed ? "저장된 기록을 확인하지 못했습니다. 위의 다시 불러오기 버튼으로 재시도해 주세요." : "저장된 제작 기록을 불러오고 있습니다."}</p> : !runs.length ? <div className="history-empty"><h3>첫 번째 이야기를 기다리고 있어요.</h3><p>관광지 탐색에서 마음에 드는 장소를 선택해 주세요.</p></div> : <div className="history-rows">{(full ? runs : runs.slice(0,4)).map((run) => { const place = getPlace(run.brief.placeId || run.brief.place); return <button key={run.id} type="button" className="history-row" disabled={busy} onClick={() => onOpen(run.id)}>{place && <PlacePhoto place={place} />}<div><h3>{run.brief.place} 이야기</h3><p>{run.brief.audience} · 카드뉴스 4장 · {run.mode === "fixture" ? "데모" : "실제 AI"}</p><small>{new Date(run.updatedAt).toLocaleString("ko-KR")}</small></div><span className={`status-chip ${run.status}`}>{labels[run.status]}</span><span aria-hidden="true">›</span></button>; })}</div>}
  </section>;
}

export default function PlatformHome({ runs, loaded, busy, onExplore, onCreate, onOpen, failed = false }: { runs:Run[];loaded:boolean;busy:boolean;onExplore:()=>void;onCreate:(place:Place)=>void;onOpen:(id:string)=>void;failed?:boolean }) {
  const hero = PLACES.find((place) => place.id === "central-park") || PLACES[0];
  const counts = [{ label:"최근 이야기 · 최대 50개",value:runs.length }, { label:"제작 중",value:runs.filter((run)=>run.status==='running'||run.status==='queued'||run.imageJob?.status==='running').length }, { label:"검토·승인 대기",value:runs.filter((run)=>run.status==='needs_review'||run.status==='ready_for_approval').length }, { label:"승인 완료",value:runs.filter((run)=>run.status==='approved').length }];
  return <section className="dashboard-page" aria-label="대시보드"><div className="dashboard-hero"><div className="hero-copy"><span className="region-tag">성남의 어제, 오늘 그리고 내일</span><h1>가까운 곳에,<br />아직 만나지 못한<br />이야기가 있어요.</h1><p>우리 도시를 발견하고, 사실과 상상을 구분한<br />문화 콘텐츠를 함께 만들어 보세요.</p><button type="button" className="primary-button" onClick={onExplore}>성남의 장소 탐색하기 <span aria-hidden="true">↗</span></button></div><div className="hero-photo"><PlacePhoto place={hero} priority /><div><span>{hero.district}</span><strong>{hero.name}</strong><small>실제 장소 사진</small></div></div></div>
    <div className="dashboard-stats">{counts.map((item)=><div key={item.label}><span>{item.label}</span><strong>{loaded?item.value:"—"}<small>개</small></strong></div>)}</div>
    <div className="section-heading"><div><h2>성남, 이런 곳부터 시작해요</h2><p>도시의 역사부터 일상 속 쉼표까지.</p></div><button type="button" className="text-button" onClick={onExplore}>전체 장소 보기</button></div><div className="featured-places">{PLACES.slice(0,3).map((place)=><button key={place.id} type="button" className="featured-place" disabled={busy} onClick={()=>onCreate(place)}><PlacePhoto place={place}/><span>{place.district} · {place.type}</span><h3>{place.name}</h3><p>{place.description}</p><small>이 장소로 이야기 만들기</small></button>)}</div>
    <RunHistory runs={runs} loaded={loaded} failed={failed} busy={busy} onOpen={onOpen}/>
  </section>;
}
