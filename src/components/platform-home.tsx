"use client";

import { useState } from "react";
import Image from "next/image";
import type { Run } from "@/lib/types";
import { PLACES, getPlace, type Place } from "@/lib/places";
import { PURPOSES, type CreationPurpose } from "@/lib/purposes";
import { DEMO_EXAMPLE } from "@/lib/demo-example";
import { PlacePhoto } from "./place-explorer";

type ExploreFilters = {
  query?: string;
  district?: string;
  category?: string;
  theme?: "history" | "nature" | "art" | "market" | "all";
};

const labels: Record<Run["status"], string> = {
  queued: "제작 대기",
  running: "제작 중",
  needs_review: "검토 필요",
  ready_for_approval: "승인 대기",
  approved: "승인 완료",
  failed: "제작 실패",
  cancelled: "취소됨",
};

const themes = [
  { id: "history", title: "시간이 머무는 곳", label: "역사와 문화유산", description: "도시의 오래된 이야기를 찾아요.", placeId: "pangyo-museum" },
  { id: "nature", title: "잠시, 초록 속으로", label: "자연과 산책", description: "가까운 풍경에서 쉬어 가요.", placeId: "yuldong-park" },
  { id: "art", title: "일상이 예술이 되는 순간", label: "예술과 공연", description: "새로운 감각을 만나는 공간이에요.", placeId: "seongnam-arts-center" },
  { id: "market", title: "사람과 이야기가 모이는 곳", label: "시장과 일상", description: "도시의 활기를 발견해요.", placeId: "moran-market" },
] as const;

const districts = [
  { name: "수정구", placeId: "bongguksa", description: "산자락에서 오래된 문화를 만나다" },
  { name: "중원구", placeId: "moran-market", description: "시장과 시민의 일상을 들여다보다" },
  { name: "분당구", placeId: "central-park", description: "공원과 문화공간을 따라 걷다" },
] as const;

function recentRuns(runs: Run[]) {
  return [...runs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
}

export function RunHistory({
  runs, loaded, busy, onOpen, full = false, failed = false,
  query: controlledQuery, statusFilter, onFiltersChange,
}: {
  runs: Run[];
  loaded: boolean;
  busy: boolean;
  onOpen: (id: string) => void;
  full?: boolean;
  failed?: boolean;
  query?: string;
  statusFilter?: string;
  onFiltersChange?: (filters: { query: string; status: string }) => void;
}) {
  const [localQuery, setLocalQuery] = useState("");
  const [localStatus, setLocalStatus] = useState("all");
  const query = controlledQuery ?? localQuery;
  const requestedStatus = statusFilter ?? localStatus;
  const status = Object.hasOwn(labels, requestedStatus) ? requestedStatus : "all";
  function setFilters(nextQuery: string, nextStatus: string) {
    setLocalQuery(nextQuery);
    setLocalStatus(nextStatus);
    onFiltersChange?.({ query: nextQuery, status: nextStatus });
  }
  const recent = recentRuns(runs);
  const filtered = recent.filter((run) => {
    const content = [run.brief.place, ...run.cards.map((card) => card.title)].join(" ").toLocaleLowerCase();
    return (status === "all" || run.status === status) && content.includes(query.trim().toLocaleLowerCase());
  });
  const displayed = full ? filtered : recent.slice(0, 4);

  return (
    <section className="history-panel" aria-label={full ? "제작 기록" : "최근 제작 기록"}>
      <div className="section-heading">
        <div>
          <h2>{full ? "제작 기록" : "최근 만든 이야기"}</h2>
          <p>{full ? "최근 수정한 최대 50개 작업에서 편집과 검토를 이어가세요." : "최근 수정한 작업부터 보여 드립니다. 멈춘 곳에서 다시 시작해요."}</p>
        </div>
        <span>{loaded ? `${recent.length}개 작업` : failed ? "조회 실패" : "불러오는 중"}</span>
      </div>
      {full && (
        <div className="history-filters">
          <label>
            <span className="sr-only">제작 기록 검색</span>
            <input type="search" placeholder="장소 또는 카드 제목 검색" value={query} onChange={(event) => setFilters(event.target.value, status)} />
          </label>
          <label>
            <span className="sr-only">제작 상태 필터</span>
            <select value={status} onChange={(event) => setFilters(query, event.target.value)}>
              <option value="all">모든 상태</option>
              {Object.entries(labels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          {loaded && <p aria-live="polite">{filtered.length}개 결과</p>}
        </div>
      )}
      {!loaded ? (
        <p className="history-empty" role="status">{failed ? "저장된 기록을 확인하지 못했습니다. 위의 다시 불러오기 버튼으로 재시도해 주세요." : "저장된 제작 기록을 불러오고 있습니다."}</p>
      ) : !recent.length ? (
        <div className="history-empty"><h3>첫 번째 이야기를 기다리고 있어요.</h3><p>성남 둘러보기에서 마음에 드는 장소를 선택해 주세요.</p></div>
      ) : !displayed.length ? (
        <div className="history-empty" role="status"><h3>조건에 맞는 제작 기록이 없어요.</h3><p>검색어나 제작 상태를 바꿔서 찾아보세요.</p><button className="secondary-button" type="button" onClick={() => setFilters("", "all")}>기록 검색 조건 초기화</button></div>
      ) : (
        <div className="history-rows">
          {displayed.map((run) => {
            const place = getPlace(run.brief.placeId || run.brief.place);
            return (
              <button key={run.id} type="button" className="history-row" disabled={busy} onClick={() => onOpen(run.id)}>
                {place && <PlacePhoto place={place} />}
                <div><h3>{run.brief.place} 이야기</h3><p>{run.brief.audience} · 카드뉴스 4장 · {run.mode === "fixture" ? "데모" : "실제 AI"}</p><small>{new Date(run.updatedAt).toLocaleString("ko-KR")}</small></div>
                <span className={`status-chip ${run.status}`}>{labels[run.status]}</span><span aria-hidden="true">›</span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default function PlatformHome({
  runs, loaded, busy, onExplore, onCreate, onOpen, failed = false,
  savedIds = [], onSaved, onHelp,
}: {
  runs: Run[];
  loaded: boolean;
  busy: boolean;
  onExplore: (filters?: ExploreFilters) => void;
  onCreate: (place: Place, purpose?: CreationPurpose) => void;
  onOpen: (id: string) => void;
  failed?: boolean;
  savedIds?: string[];
  onSaved?: () => void;
  onHelp?: () => void;
}) {
  const hero = getPlace("central-park") || PLACES[0];
  const examplePlace = getPlace(DEMO_EXAMPLE.placeId) || PLACES[0];
  const recent = recentRuns(runs);
  const saved = [...new Set(savedIds)].map((id) => getPlace(id)).filter((place): place is Place => !!place);
  const needsReview = recent.filter((run) => run.status === "needs_review" || run.status === "ready_for_approval");

  return (
    <section className="dashboard-page guided-home" aria-label="홈·대시보드">
      <section className="guided-home-hero" aria-label="성남 타임스토리 소개">
        <div className="guided-hero-copy">
          <p className="home-introduction">우리 도시를 발견하는 새로운 방법</p>
          <h1>성남을 만나고,<br />나만의 이야기로.</h1>
          <p>가까운 장소의 매력을 발견하고,<br className="home-desktop-break" /> 사실과 상상을 구분한 카드뉴스로 만들어 보세요.</p>
          <div className="home-actions">
            <button className="primary-button" type="button" onClick={() => onExplore()}>성남 둘러보기</button>
            <button className="secondary-button" type="button" disabled={busy} onClick={() => onCreate(hero, "place_intro")}>카드뉴스 만들기</button>
            {onHelp && <button className="home-text-action" type="button" onClick={onHelp}>처음이라면 타미와 함께 <span aria-hidden="true">＋</span></button>}
          </div>
        </div>
        <div className="guided-hero-photo"><PlacePhoto place={hero} priority sizes="(max-width:600px) 100vw, (max-width:1100px) calc(100vw - 64px), calc(100vw - 304px)" /></div>
        <div className="home-photo-caption"><span>{hero.name} · 실제 장소 사진</span><a href={hero.photo?.sourceUrl || hero.sourceUrl} target="_blank" rel="noreferrer">사진과 출처 확인 ↗</a></div>
        <p className="home-selection-note">대표 사진은 성남의 자연과 도시가 함께 보이는 중앙공원 전경을 선택했습니다. 인기순 추천이 아닙니다.</p>
      </section>

      <section className="home-section" aria-labelledby="home-themes-title">
        <div className="home-section-heading"><h2 id="home-themes-title">어떤 이야기에 마음이 가나요?</h2><p>역사, 자연, 예술, 일상. 관심 있는 주제로 시작해요.</p></div>
        <div className="home-theme-grid">
          {themes.map((theme) => {
            const place = getPlace(theme.placeId)!;
            return <button key={theme.id} type="button" className="home-theme-card" onClick={() => onExplore({ theme: theme.id })}><PlacePhoto place={place} /><div><span>{theme.label}</span><h3>{theme.title}</h3><p>{theme.description}</p><small>{place.name} 사진</small></div><span className="home-card-arrow" aria-hidden="true">↗</span></button>;
          })}
        </div>
      </section>

      <section className="home-section home-district-section" aria-labelledby="home-districts-title">
        <div className="home-section-heading"><h2 id="home-districts-title">세 개의 지역, 다채로운 성남.</h2><p>가고 싶은 지역에서 다음 장소를 찾아보세요.</p></div>
        <div className="home-district-grid">
          {districts.map((district) => {
            const place = getPlace(district.placeId)!;
            const count = PLACES.filter((item) => item.district === district.name).length;
            return <button key={district.name} type="button" className="home-district-card" onClick={() => onExplore({ district: district.name, theme: "all" })}><PlacePhoto place={place} /><div><h3>{district.name}</h3><p>{district.description}</p><span>등록된 장소 {count}곳</span></div></button>;
          })}
        </div>
        <p className="home-selection-note">현재 공식 자료를 확인한 등록 장소 {PLACES.length}곳을 안내합니다. 지역별 모든 관광지를 포함하지는 않습니다.</p>
      </section>

      <section className="home-section home-example-section" aria-labelledby="home-example-title">
        <div className="home-section-heading"><span className="home-demo-label">실제 제작·검수 예시</span><h2 id="home-example-title">한 장소가 네 장의 이야기가 되기까지.</h2><p>{DEMO_EXAMPLE.title}</p></div>
        <div className="home-example-grid">
          {DEMO_EXAMPLE.images.map((src, index) => <a key={src} className="home-example-card" href={src} target="_blank" rel="noreferrer" aria-label={`검수된 예시 카드뉴스 ${index + 1}장 원본 보기`}><Image src={src} alt={`${examplePlace.name} 검수 예시 카드뉴스 ${index + 1}장`} width={1080} height={1080} sizes="(max-width:600px) 80vw, (max-width:1100px) 40vw, 25vw" /><span>{index + 1}장 <span>원본 보기 ↗</span></span></a>)}
        </div>
        <div className="home-example-footer"><p>저장된 응답으로 제작한 데모입니다. 실제 AI 판단 성능을 의미하지 않습니다.<br />검수 확인 {new Date(DEMO_EXAMPLE.reviewedAt).toLocaleDateString("ko-KR")}</p><button className="secondary-button" type="button" disabled={busy} onClick={() => onCreate(examplePlace, "youth_story")}>이 장소로 직접 만들어 보기</button></div>
      </section>

      <section className="home-section" aria-labelledby="home-purposes-title">
        <div className="home-section-heading"><h2 id="home-purposes-title">전하고 싶은 이야기에 맞게.</h2><p>목적을 선택하면 대상과 제작 요청이 함께 준비됩니다.</p></div>
        <div className="home-purpose-grid">
          {PURPOSES.map((purpose) => <article className={`home-purpose-card purpose-${purpose.id}`} key={purpose.id}><span className="home-purpose-audience">{purpose.audience}에게</span><h3>{purpose.label}</h3><p>{purpose.description}</p><button type="button" className="home-text-action" disabled={busy} onClick={() => onCreate(examplePlace, purpose.id)}>{purpose.label}로 시작하기 <span aria-hidden="true">＋</span></button></article>)}
        </div>
        <p className="home-selection-note">{examplePlace.name} 예시로 시작합니다. 다음 화면에서 장소와 대상, 문구를 바꿀 수 있어요.</p>
      </section>

      <section className="home-section home-resume-section" aria-labelledby="home-resume-title">
        <div className="home-section-heading"><h2 id="home-resume-title">다음 이야기도, 이어서.</h2><p>저장한 장소와 최근 작업을 이곳에서 다시 만나요.</p></div>
        <div className="home-resume-grid">
          <article className="home-resume-card"><span>저장한 장소</span><h3>{saved.length}<small>곳</small></h3>{saved.length ? <><div className="saved-place-thumbnails">{saved.slice(0, 3).map((place) => <PlacePhoto key={place.id} place={place} />)}</div><p>{saved.slice(0, 2).map((place) => place.name).join(", ")}{saved.length > 2 ? ` 외 ${saved.length - 2}곳` : ""}</p></> : <p>마음에 드는 장소를 저장해 두세요.<br />다음에 쉽게 다시 찾을 수 있어요.</p>}<button type="button" className="home-text-action" onClick={() => onSaved ? onSaved() : onExplore() }>{onSaved ? "저장한 장소 보기" : "장소 둘러보기"} <span aria-hidden="true">↗</span></button></article>
          <article className="home-resume-card"><span>최근 제작 기록</span><h3>{loaded ? recent.length : "—"}<small>개</small></h3><p>{loaded ? "최근 수정한 최대 50개 작업을 기준으로 표시합니다." : failed ? "기록을 불러오지 못했습니다. 위에서 다시 불러와 주세요." : "저장한 작업을 확인하고 있습니다."}</p>{recent[0] && <button type="button" className="home-text-action" disabled={busy} onClick={() => onOpen(recent[0].id)}>최근 작업 이어가기 <span aria-hidden="true">↗</span></button>}</article>
          <article className="home-resume-card"><span>검토·승인 대기</span><h3>{loaded ? needsReview.length : "—"}<small>개</small></h3><p>{loaded ? needsReview.length ? `${needsReview[0].brief.place} 이야기가 확인을 기다리고 있어요.` : "최근 50개 작업에 확인을 기다리는 이야기가 없습니다." : failed ? "기록 조회 후 확인할 수 있습니다." : "검토 상태를 확인하고 있습니다."}</p>{needsReview[0] && <button type="button" className="home-text-action" disabled={busy} onClick={() => onOpen(needsReview[0].id)}>검토 이어가기 <span aria-hidden="true">↗</span></button>}</article>
        </div>
        <RunHistory runs={recent} loaded={loaded} failed={failed} busy={busy} onOpen={onOpen} />
      </section>
    </section>
  );
}
