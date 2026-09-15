import { getPlace } from "./places";
import { missingStoryStops } from "./run";
import { randomUUID } from "node:crypto";
import { createFixtureStory } from "./fixture";
import {
  AgentLimitError,
  composeLive,
  decideLive,
  getLiveConfig,
  verifyLive,
} from "./provider";
import { verifyContent } from "./verifier";
import { applyStoryUpdate, mergeSearchResult, recordReview, searchIntent } from "./lifecycle";
import { assertReadingStyleUpdate } from "./reading-style";
import type { Action, AgentDeps, Decision, Run } from "./types";

function packageIsValid(run: Run) {
  return (
    run.artifacts.filter((artifact) => artifact.kind === "png").length === 4 &&
    ["zip", "text", "json"].every((kind) =>
      run.artifacts.some((artifact) => artifact.kind === kind),
    ) &&
    new Set(run.artifacts.map((artifact) => artifact.name)).size ===
      run.artifacts.length &&
    run.artifacts.every(
      (artifact) =>
        artifact.version === run.version &&
        artifact.reviewVersion === run.version &&
        !!artifact.path &&
        !!artifact.sha256,
    )
  );
}
function contentIsVerified(run: Run) {
  return (
    run.cards.length === 4 &&
    run.reviewVersion === run.version &&
    !run.issues.some((issue) => !issue.resolved) &&
    run.claims
      .filter((claim) => claim.kind === "fact")
      .every((claim) => claim.support === "supported") &&
    (run.mode !== "live" || (Boolean(run.assessments?.length) && run.assessments!.every(a => a.verdict === "supported")))
  );
}
function decision(action: Action, reasonSummary: string, run: Run): Decision {
  const issues = run.issues.filter((issue) => !issue.resolved);
  const currentIds = new Set([
    "run",
    ...run.cards.map((card) => card.id),
    ...run.claims.map((claim) => claim.id),
    ...run.evidence.map((evidence) => evidence.id),
  ]);
  return {
    action,
    targetIds: [...new Set(issues.map((issue) => issue.targetId))].filter(
      (id) => currentIds.has(id),
    ),
    evidenceIds: [
      ...new Set(issues.flatMap((issue) => issue.evidenceIds)),
    ].filter((id) => run.evidence.some((evidence) => evidence.id === id)),
    reasonSummary,
    uncertainty: issues.length ? "근거와 수정 결과를 재확인해야 합니다." : "",
    blockedReason: action === "escalate" ? reasonSummary : "",
    expectedVersion: run.version,
  };
}
function chooseFixture(run: Run): Decision {
  const searches = run.events.filter(
    (event) => event.action === "search_sources",
  );
  if (!run.evidence.length)
    return decision(
      searches.length ? "escalate" : "search_sources",
      searches.length
        ? "공식 원문을 확보하지 못해 담당자의 자료 확인이 필요합니다."
        : "공식 자료의 원문과 근거를 확인합니다.",
      run,
    );
  if (!run.cards.length)
    return decision(
      "compose_story",
      "확인한 근거로 청소년용 카드뉴스 초안을 작성합니다.",
      run,
    );
  if (run.reviewVersion !== run.version)
    return decision(
      "verify_content",
      "새 콘텐츠 버전의 사실·연결·상상 표시를 검사합니다.",
      run,
    );
  const pending = run.issues.filter((issue) => !issue.resolved);
  const corrections = run.automaticRevisions ?? Math.max(0, run.revisions.filter(r=>r.origin !== "human" && !r.reason.includes("담당자")).length - 1);
  if (run.strategy === "baseline") {
    if (corrections < 1)
      return decision(
        "compose_story",
        "고정 순서 비교 방식의 정해진 수정 1회를 수행합니다.",
        run,
      );
    if (pending.length)
      return decision(
        "escalate",
        "정해진 수정 1회 후에도 문제가 남아 담당자 검토가 필요합니다.",
        run,
      );
  } else if (pending.length) {
    const needsEvidence = pending.some((issue) =>
      [
        "unsupported_relation",
        "evidence_mismatch",
        "missing_evidence",
        "invalid_evidence",
        "model_unsupported",
      ].includes(issue.type),
    );
    if (
      needsEvidence &&
      !searches.some((event) => event.version === run.version)
    )
      return decision(
        "search_sources",
        "설명과 근거의 연결이 부족해 공식 원문을 추가 확인합니다.",
        run,
      );
    return decision(
      "compose_story",
      "검수에서 지적된 문장이나 상상 표시를 수정합니다.",
      run,
    );
  }
  return decision(
    run.artifacts.length ? "finish" : "render_cards",
    run.artifacts.length
      ? "검수 버전과 출력 파일의 일치를 확인하고 담당자 승인 대기로 전환합니다."
      : "검수를 통과한 버전으로 카드뉴스 파일을 제작합니다.",
    run,
  );
}

export async function runAgent(run: Run, deps: AgentDeps): Promise<Run> {
  const now = deps.now ?? Date.now;
  const attemptStart = now();
  const timer = new AbortController();
  const timeout = setTimeout(
    () => timer.abort(new AgentLimitError("실행 시간 상한에 도달했습니다.")),
    Math.max(1, run.limits.maxDurationMs),
  );
  timeout.unref?.();
  const signal = AbortSignal.any([deps.signal, timer.signal]);
  const stamp = () => new Date(now()).toISOString();
  const persist = () => {
    run.updatedAt = stamp();
    deps.persist(run);
  };
  const log = (
    action: Run["events"][number]["action"],
    message: string,
    chosen?: Decision,
  ) => {
    run.events.push({
      id: randomUUID(),
      at: stamp(),
      action,
      message,
      version: run.version,
      ...(chosen ? { decision: chosen } : {}),
    });
    persist();
  };
  const check = () => {
    signal.throwIfAborted();
    if (now() - attemptStart >= run.limits.maxDurationMs)
      throw new AgentLimitError("실행 시간 상한에 도달했습니다.");
  };
  try {
    check();
    if (run.mode === "live" && !getLiveConfig().configured)
      throw new Error(getLiveConfig().reason);
    run.status = "running";
    run.startedAt ??= stamp();
    run.stopReason = null;
    log(
      "started",
      run.mode === "fixture"
        ? "준비된 응답 모드: 실제 모델 성능을 측정하지 않는 시나리오 실행입니다."
        : "실제 API 모드로 실행합니다.",
    );
    while (run.status === "running") {
      check();
      const styleChange = run.readingStyleChange?.status === "requested" ? run.readingStyleChange : undefined;
      const missingStop = !run.cards.length ? missingStoryStops(run)[0] : undefined;
      const preparation = missingStop ? decision(
        run.searches?.some(search => search.placeId === missingStop.placeId) ? "escalate" : "search_sources",
        `이야기의 ${getPlace(missingStop.placeId)!.name} 공식 근거가 필요합니다.`, run) : undefined;
      if (preparation?.action === "search_sources") preparation.search = { placeId: missingStop!.placeId,
        query: "공식 소개 자료", targetClaimIds: [], missingInformation: [], reason: preparation.reasonSummary };
      const chosen: Decision = preparation ?? (styleChange
        ? {
            action: "compose_story", targetIds: styleChange.targetCardIds, evidenceIds: [],
            expectedVersion: styleChange.expectedVersion,
            reasonSummary: run.mode === "fixture"
              ? "준비된 데모 용어 규칙으로 쉬운 설명을 만듭니다. 자유 입력의 의미를 이해하는 기능은 아니며, 담당자 편집 카드는 보존합니다."
              : "날짜·수치·장소·조건과 근거를 보존해 쉬운 설명으로 바꿉니다. 담당자 편집 카드는 보존합니다.",
            uncertainty: "변경한 문구는 새 버전에서 독립 검수와 담당자 승인이 필요합니다.",
          }
        : run.mode === "live" && run.strategy === "agent"
          ? await decideLive(run, signal, persist)
          : chooseFixture(run));
      check();
      if (chosen.expectedVersion !== undefined && chosen.expectedVersion !== run.version)
        throw new AgentLimitError("판단 대상 버전이 변경되었습니다. 최신 버전으로 다시 검토하세요.");
      if (chosen.action === "search_sources") {
        chosen.search = searchIntent(run, chosen);
        const repeated = (run.searches ?? []).filter(s => s.placeId === chosen.search!.placeId && s.query.trim() === chosen.search!.query.trim() && s.newEvidenceCount === 0);
        if (repeated.length >= 2)
          throw new AgentLimitError("같은 검색에서 새 근거를 확보하지 못했습니다. 다른 자료 또는 담당자 확인이 필요합니다.");
      }
      const knownTargets = new Set([
        "run",
        ...run.cards.map((card) => card.id),
        ...run.claims.map((claim) => claim.id),
        ...run.evidence.map((evidence) => evidence.id),
      ]);
      if (
        chosen.targetIds.some((id) => !knownTargets.has(id)) ||
        chosen.evidenceIds.some(
          (id) => !run.evidence.some((evidence) => evidence.id === id),
        )
      )
        throw new Error(
          "다음 행동에 존재하지 않는 대상 또는 근거 ID가 포함되었습니다.",
        );
      if (chosen.action === "escalate") {
        run.status = "needs_review";
        run.stopReason = chosen.blockedReason || chosen.reasonSummary;
        log("escalate", run.stopReason, chosen);
        break;
      }
      if (chosen.action === "finish") {
        if (!contentIsVerified(run) || !packageIsValid(run))
          throw new AgentLimitError(
            "검수 또는 출력 버전 조건을 충족하지 않아 완료할 수 없습니다.",
          );
        run.status = "ready_for_approval";
        run.stopReason = null;
        log("finish", chosen.reasonSummary, chosen);
        break;
      }
      if (run.usage.toolCalls >= run.limits.maxToolCalls)
        throw new AgentLimitError("도구 호출 상한에 도달했습니다.");
      if (
        chosen.action === "compose_story" &&
        run.cards.length &&
        (run.automaticRevisions ?? Math.max(0, run.revisions.filter(r=>r.origin !== "human" && !r.reason.includes("담당자")).length - 1)) >= run.limits.maxRevisions
      )
        throw new AgentLimitError("콘텐츠 수정 횟수 상한에 도달했습니다.");
      if (chosen.action === "compose_story" && (!run.evidence.length || missingStoryStops(run).length))
        throw new AgentLimitError(
          "확인한 원문 근거가 없어 콘텐츠를 작성할 수 없습니다.",
        );
      if (chosen.action === "verify_content" && !run.cards.length)
        throw new Error("검사할 콘텐츠가 없습니다.");
      if (chosen.action === "render_cards" && !contentIsVerified(run))
        throw new AgentLimitError(
          "검수에 통과한 현재 버전만 출력할 수 있습니다.",
        );
      run.usage.toolCalls += 1;
      log(chosen.action, chosen.reasonSummary, chosen);
      if (chosen.action === "search_sources") {
        const result = await deps.search(run, chosen, signal);
        check();
        const report = mergeSearchResult(run, result, chosen, stamp());
        run.events[run.events.length - 1].message = `${chosen.reasonSummary} 방문 ${report.visitedPages}페이지 · 새 근거 ${report.newEvidenceCount}개`;
        // New evidence cannot retain an old review verdict, even if the wording is unchanged.
        if (run.cards.length && !run.issues.some((issue) => !issue.resolved))
          run.reviewVersion = null;
        if (!run.evidence.length) {
          run.status = "needs_review";
          run.stopReason =
            "공식 자료를 확보하지 못했습니다. 근거 없음은 거짓 판정이 아니며 담당자 확인이 필요합니다.";
        }
      } else if (chosen.action === "compose_story") {
        const story =
          run.mode === "live"
            ? await composeLive(run, signal, persist)
            : createFixtureStory(run);
        check();
        assertReadingStyleUpdate(run, story);
        const applied = applyStoryUpdate(run, story, chosen, stamp());
        if (applied && styleChange) {
          run.brief.readingStyle = "easy";
          styleChange.status = "applied";
          styleChange.appliedVersion = run.version;
        }
      } else if (chosen.action === "verify_content") {
        const rules = verifyContent(run);
        const modelIssues =
          run.mode === "live" ? await verifyLive(run, signal, persist) : [];
        check();
        const current = [...rules, ...modelIssues];
        for (const claim of run.claims)
          if (
            current.some(
              (issue) =>
                issue.targetId === claim.id || issue.targetId === claim.cardId,
            )
          )
            if (claim.support !== "contradicted")
            claim.support = "insufficient";
        run.issues = [
          ...run.issues.map((issue) => ({ ...issue, resolved: true })),
          ...current,
        ];
        run.reviewVersion = run.version;
        recordReview(run, stamp());
        // Replace the action's message rather than adding a second tool event.
        run.events[run.events.length - 1].message = current.length
          ? `문제 ${current.length}건 발견: ${current.map((issue) => issue.message).join(" ")}`
          : "사실·근거·상상 표시 검수를 통과했습니다.";
      } else if (chosen.action === "render_cards") {
        try {
          run.artifacts = await deps.render(run, signal);
          check();
        } catch (error) {
          check();
          const message = error instanceof Error ? error.message : "";
          if (!/overflow|텍스트 잘림/i.test(message)) throw error;
          const cardNumber = message.match(/(\d+)장/);
          const targetId = cardNumber
            ? (run.cards[Number(cardNumber[1]) - 1]?.id ?? "run")
            : "run";
          run.artifacts = [];
          run.approval = null;
          run.issues.push({
            id: `${run.version}:${targetId}:layout_overflow`,
            targetId,
            type: "layout_overflow",
            severity: "error",
            message,
            evidenceIds: [],
            recommendation:
              "해당 카드의 문구와 제목을 더 짧게 수정하고 재검수 후 다시 출력하세요.",
            resolved: false,
          });
          run.events[run.events.length - 1].message =
            `출력 검사 문제: ${message}. 문구를 수정하고 다시 출력합니다.`;
          persist();
          continue;
        }
        if (!packageIsValid(run))
          throw new AgentLimitError(
            "출력 파일 구성 또는 콘텐츠·검수 버전이 올바르지 않습니다.",
          );
      }
      persist();
    }
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.message
        : "실행 중 알 수 없는 문제가 발생했습니다.";
    const durationExceeded =
      timer.signal.aborted ||
      error instanceof AgentLimitError ||
      (signal.aborted &&
        (signal.reason?.name === "TimeoutError" ||
          signal.reason instanceof AgentLimitError));
    run.status =
      signal.aborted && !durationExceeded
        ? "cancelled"
        : durationExceeded || run.cards.length > 0
          ? "needs_review"
          : "failed";
    run.stopReason = reason;
    run.approval = null;
    log(run.status === "cancelled" ? "cancelled" : "error", reason);
  } finally {
    clearTimeout(timeout);
    persist();
  }
  return run;
}
