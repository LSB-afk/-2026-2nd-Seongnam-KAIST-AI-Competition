import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Run, AgentDeps } from "./types";
import type { RunStore } from "./store";
import { DEFAULT_BRIEF, newRun } from "./run";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
const briefSchema = z
  .object({
    place: z.literal("판교박물관"),
    audience: z.string().trim().min(1).max(40),
    goal: z.string().trim().min(5).max(1000),
    cardCount: z.literal(4),
    includeFuture: z.literal(true),
  })
  .strict();
const createSchema = z
  .object({
    brief: briefSchema.default({ ...DEFAULT_BRIEF, place: "판교박물관" }),
    mode: z.enum(["fixture", "live"]),
    strategy: z.enum(["agent", "baseline"]).default("agent"),
    scenario: z
      .enum([
        "normal",
        "causal",
        "future",
        "mismatch",
        "unavailable",
        "persistent",
      ])
      .default("normal"),
    requestId: z.string().min(8).max(100),
  })
  .strict();
const versionSchema = z
  .object({ version: z.number().int().nonnegative() })
  .strict();
const editSchema = z
  .object({
    version: z.number().int().nonnegative(),
    cardId: z.string().min(1).max(100),
    title: z.string().trim().min(1).max(80),
    body: z.string().trim().min(1).max(500),
  })
  .strict();
const approveSchema = z
  .object({
    version: z.number().int().nonnegative(),
    reviewer: z.string().trim().min(1).max(60),
  })
  .strict();
interface Dependencies {
  runner: (run: Run, deps: AgentDeps) => Promise<Run>;
  search: AgentDeps["search"];
  render: AgentDeps["render"];
  checkArtifacts: (run: Run) => Promise<boolean>;
  liveAvailable?: () => boolean;
}
interface Job {
  controller: AbortController;
  promise: Promise<void>;
}
export class RunService {
  private jobs = new Map<string, Job>();
  constructor(
    public store: RunStore,
    private deps: Dependencies,
  ) {}
  private require(id: string): Run {
    const run = this.store.get(id);
    if (!run) throw new AppError("제작 기록을 찾을 수 없습니다.", 404);
    return run;
  }
  private version(run: Run, version: number): void {
    if (run.version !== version)
      throw new AppError(
        "다른 버전이 저장되었습니다. 최신 결과를 다시 확인하세요.",
        409,
      );
  }
  private idleOnly(run: Run): void {
    if (
      this.jobs.has(run.id) ||
      run.status === "running" ||
      run.status === "queued"
    )
      throw new AppError("실행이 끝난 뒤 다시 시도하세요.", 409);
  }
  create(input: unknown): Run {
    const parsed = createSchema.parse(input);
    const existing = this.store.findRequest(parsed.requestId);
    if (existing) {
      if (
        JSON.stringify(existing.brief) !== JSON.stringify(parsed.brief) ||
        existing.mode !== parsed.mode ||
        existing.strategy !== parsed.strategy ||
        existing.scenario !== parsed.scenario
      )
        throw new AppError(
          "같은 요청 ID에 다른 제작 조건을 사용할 수 없습니다.",
          409,
        );
      return existing;
    }
    if (parsed.mode === "live" && !this.deps.liveAvailable?.())
      throw new AppError(
        "실제 API 실행에는 모델·API 키·가격·비용 상한 설정이 필요합니다.",
        503,
      );
    if (this.jobs.size >= 2)
      throw new AppError(
        "동시에 두 개까지 제작할 수 있습니다. 진행 중인 작업을 기다려 주세요.",
        429,
      );
    const run = newRun(parsed);
    this.store.insert(run, parsed.requestId);
    this.start(run);
    return this.require(run.id);
  }
  private start(run: Run): void {
    const remaining = run.limits.maxDurationMs - (run.usage.elapsedMs ?? 0);
    if (remaining <= 0)
      throw new AppError(
        "누적 실행 시간 상한에 도달했습니다. 새 제작을 시작하세요.",
        409,
      );
    run.status = "queued";
    run.stopReason = null;
    run.startedAt = new Date().toISOString();
    run.attemptBaseElapsedMs = run.usage.elapsedMs ?? 0;
    run.updatedAt = run.startedAt;
    this.store.save(run);
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(Math.max(1, Math.ceil(remaining)));
    const signal = AbortSignal.any([controller.signal, timeout]);
    const started = Date.now();
    const priorElapsed = run.usage.elapsedMs ?? 0;
    const promise = Promise.resolve().then(async () => {
      const persist = (next: Run) => {
        const current = this.store.get(run.id);
        next.usage.elapsedMs = Math.min(
          run.limits.maxDurationMs,
          priorElapsed + Date.now() - started,
        );
        next.updatedAt = new Date().toISOString();
        if (current?.status === "cancelled") {
          current.usage = { ...next.usage };
          current.updatedAt = next.updatedAt;
          this.store.save(current);
          return;
        }
        this.store.save(next);
      };
      try {
        const result = await this.deps.runner(run, {
          search: this.deps.search,
          render: this.deps.render,
          persist,
          signal,
        });
        if (timeout.aborted && !controller.signal.aborted) {
          result.status = "needs_review";
          result.stopReason = "누적 실행 시간 상한에 도달했습니다.";
        }
        persist(result);
      } catch (error) {
        run.status = controller.signal.aborted
          ? "cancelled"
          : timeout.aborted
            ? "needs_review"
            : "failed";
        run.stopReason = timeout.aborted
          ? "누적 실행 시간 상한에 도달했습니다."
          : error instanceof Error
            ? error.message
            : "실행 중 오류가 발생했습니다.";
        run.events.push({
          id: randomUUID(),
          at: new Date().toISOString(),
          action: "error",
          message: run.stopReason,
          version: run.version,
        });
        persist(run);
      } finally {
        const current = this.store.get(run.id);
        if (current) {
          current.usage.elapsedMs = Math.min(
            run.limits.maxDurationMs,
            priorElapsed + Date.now() - started,
          );
          current.updatedAt = new Date().toISOString();
          this.store.save(current);
        }
        this.jobs.delete(run.id);
      }
    });
    this.jobs.set(run.id, { controller, promise });
  }
  async idle(id: string): Promise<void> {
    await this.jobs.get(id)?.promise;
  }
  cancel(id: string): Run {
    const run = this.require(id);
    if (run.status !== "queued" && run.status !== "running")
      throw new AppError("진행 중인 작업만 취소할 수 있습니다.", 409);
    run.status = "cancelled";
    run.stopReason = "담당자가 제작을 취소했습니다.";
    run.updatedAt = new Date().toISOString();
    run.events.push({
      id: randomUUID(),
      at: run.updatedAt,
      action: "cancelled",
      message: run.stopReason,
      version: run.version,
    });
    this.store.save(run);
    this.jobs.get(id)?.controller.abort();
    return run;
  }
  edit(id: string, input: unknown): Run {
    const parsed = editSchema.parse(input);
    const run = this.require(id);
    this.idleOnly(run);
    this.version(run, parsed.version);
    const card = run.cards.find((c) => c.id === parsed.cardId);
    if (!card) throw new AppError("수정할 카드를 찾을 수 없습니다.", 404);
    if (!run.revisions.some((r) => r.version === run.version))
      run.revisions.push({
        version: run.version,
        createdAt: run.updatedAt,
        cards: structuredClone(run.cards),
        claims: structuredClone(run.claims),
        reason: "수정 전 저장",
      });
    run.version += 1;
    card.title = parsed.title;
    card.body = parsed.body;
    card.script = parsed.body;
    const oldClaims = run.claims.filter((c) => c.cardId === card.id);
    const idClaim = `${card.id}-manual-v${run.version}`;
    run.claims = run.claims.filter((c) => c.cardId !== card.id);
    run.claims.push({
      id: idClaim,
      cardId: card.id,
      text: parsed.body,
      kind: oldClaims.length === 1 ? oldClaims[0].kind : "fact",
      evidenceIds: [...new Set(oldClaims.flatMap((c) => c.evidenceIds))],
      support: "insufficient",
    });
    card.claimIds = [idClaim];
    run.reviewVersion = null;
    run.approval = null;
    run.artifacts = [];
    run.status = "needs_review";
    run.stopReason = "문구가 수정되었습니다. 새 버전을 다시 검수하세요.";
    run.updatedAt = new Date().toISOString();
    run.revisions.push({
      version: run.version,
      createdAt: run.updatedAt,
      cards: structuredClone(run.cards),
      claims: structuredClone(run.claims),
      reason: "담당자 문구 수정",
    });
    run.events.push({
      id: randomUUID(),
      at: run.updatedAt,
      action: "edited",
      message: "담당자 수정으로 이전 검수와 승인을 무효화했습니다.",
      version: run.version,
    });
    this.store.save(run);
    return run;
  }
  async approve(id: string, input: unknown): Promise<Run> {
    const parsed = approveSchema.parse(input);
    const run = this.require(id);
    this.idleOnly(run);
    this.version(run, parsed.version);
    if (
      run.status !== "ready_for_approval" ||
      run.reviewVersion !== run.version ||
      run.issues.some((i) => !i.resolved)
    )
      throw new AppError(
        "현재 버전의 검수가 완료되어야 승인할 수 있습니다.",
        409,
      );
    if (!(await this.deps.checkArtifacts(run)))
      throw new AppError(
        "출력 파일 또는 검수 버전이 일치하지 않습니다. 다시 검수하세요.",
        409,
      );
    // Filesystem verification yields; another request may have edited/cancelled the run.
    const latest = this.require(id);
    this.version(latest, parsed.version);
    if (latest.status !== "ready_for_approval")
      throw new AppError(
        "제작 상태가 변경되었습니다. 최신 결과를 확인하세요.",
        409,
      );
    latest.status = "approved";
    latest.updatedAt = new Date().toISOString();
    latest.approval = {
      version: latest.version,
      at: latest.updatedAt,
      reviewer: parsed.reviewer,
    };
    latest.events.push({
      id: randomUUID(),
      at: latest.updatedAt,
      action: "approved",
      message: `${parsed.reviewer} 담당자가 버전 ${latest.version}을 승인했습니다.`,
      version: latest.version,
    });
    this.store.save(latest);
    return latest;
  }
  retry(id: string, input: unknown): Run {
    const { version } = versionSchema.parse(input);
    const run = this.require(id);
    this.idleOnly(run);
    this.version(run, version);
    if (run.status !== "needs_review" && run.status !== "failed")
      throw new AppError(
        "검토가 필요하거나 실패한 작업만 다시 검수할 수 있습니다.",
        409,
      );
    if (
      run.usage.toolCalls >= run.limits.maxToolCalls ||
      run.usage.modelCalls >= run.limits.maxModelCalls
    )
      throw new AppError(
        "누적 호출 상한에 도달했습니다. 새 제작을 시작하세요.",
        409,
      );
    if (this.jobs.size >= 2)
      throw new AppError("동시 제작 상한에 도달했습니다.", 429);
    run.reviewVersion = null;
    run.approval = null;
    run.artifacts = [];
    this.start(run);
    return this.require(id);
  }
}
