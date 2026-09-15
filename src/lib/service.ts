import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Run, AgentDeps, Card, CardImage, ImageAsset, ImagePrompt } from "./types";
import type { RunStore } from "./store";
import { DEFAULT_BRIEF, newRun } from "./run";
import { getPlace } from "./places";

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
    place: z.string().trim().min(1).max(100),
    placeId: z.string().max(100).optional(),
    purpose: z.enum(["place_intro", "visit_guide", "youth_story"]).optional(),
    readingStyle: z.enum(["standard", "easy"]).default("standard"),
    audience: z.string().trim().min(1).max(40),
    goal: z.string().trim().min(5).max(1000),
    cardCount: z.literal(4),
    includeFuture: z.literal(true),
  })
  .strict()
  .refine(value => {
    const place = getPlace(value.placeId ?? value.place);
    return !!place && place.name === value.place;
  }, "등록된 관광지의 이름과 식별자가 일치해야 합니다.")
  .transform(value => ({...value,placeId:getPlace(value.placeId ?? value.place)!.id}));
const createSchema = z
  .object({
    brief: briefSchema.prefault({ ...DEFAULT_BRIEF }),
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
const imageSchema = z.object({
  version: z.number().int().nonnegative(),
  cardId: z.string().min(1).max(100),
  operation: z.enum(["crop", "replace", "generate"]),
  crop: z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1), zoom: z.number().min(1).max(3) }).strict().optional(),
  assetId: z.string().regex(/^[a-zA-Z0-9_-]+$/).max(100).optional(),
  usePlacePhoto: z.boolean().optional(),
  subject: z.string().trim().min(1).max(500).optional(),
}).strict();
interface Dependencies {
  runner: (run: Run, deps: AgentDeps) => Promise<Run>;
  search: AgentDeps["search"];
  render: AgentDeps["render"];
  checkArtifacts: (run: Run) => Promise<boolean>;
  liveAvailable?: () => boolean;
  image?: {
    configured: () => boolean;
    defaultImage: (place: string) => Promise<CardImage | undefined>;
    getAsset: (id: string) => Promise<ImageAsset>;
    buildPrompt: (run: Run, card: Card, subject?: string) => ImagePrompt;
    generate: (run: Run, prompt: ImagePrompt, reference: ImageAsset | undefined, signal: AbortSignal, persist: (run: Run) => void) => Promise<ImageAsset>;
  };
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
      run.status === "queued" || run.imageJob?.status === "running"
    )
      throw new AppError("실행이 끝난 뒤 다시 시도하세요.", 409);
  }
  private applyImage(run: Run, cardId: string, image: CardImage, reason: string): Run {
    const card = run.cards.find(item => item.id === cardId);
    if (!card) throw new AppError("이미지를 수정할 카드를 찾을 수 없습니다.", 404);
    if (!run.revisions.some(item => item.version === run.version))
      run.revisions.push({version:run.version,createdAt:run.updatedAt,cards:structuredClone(run.cards),claims:structuredClone(run.claims),reason:"이미지 변경 전 저장"});
    card.image = structuredClone(image);
    if (run.readingStyleChange?.status === "requested") delete run.readingStyleChange;
    run.version += 1;
    run.reviewVersion = null;
    run.approval = null;
    run.artifacts = [];
    run.assessments = [];
    run.proposedChanges = [];
    run.status = "needs_review";
    run.stopReason = "이미지가 변경되었습니다. 사진과 문구를 확인하고 다시 검수하세요.";
    run.updatedAt = new Date().toISOString();
    run.revisions.push({version:run.version,createdAt:run.updatedAt,cards:structuredClone(run.cards),claims:structuredClone(run.claims),reason,origin:"human"});
    run.events.push({id:randomUUID(),at:run.updatedAt,action:"edited",message:reason,version:run.version});
    this.store.save(run);
    return run;
  }
  async image(id: string, input: unknown): Promise<Run> {
    const parsed = imageSchema.parse(input);
    const run = this.require(id);
    this.idleOnly(run);
    this.version(run, parsed.version);
    const card = run.cards.find(item => item.id === parsed.cardId);
    if (!card) throw new AppError("이미지를 수정할 카드를 찾을 수 없습니다.", 404);
    if (parsed.operation === "crop") {
      if (!card.image || !parsed.crop) throw new AppError("편집할 사진과 크롭 값이 필요합니다.");
      return this.applyImage(run, card.id, {...card.image,crop:parsed.crop}, "담당자 사진 크롭·초점 수정");
    }
    const image = this.deps.image;
    if (!image) throw new AppError("이미지 서비스를 사용할 수 없습니다.", 503);
    if (parsed.operation === "replace") {
      if (!!parsed.assetId === !!parsed.usePlacePhoto) throw new AppError("교체할 사진 하나를 선택하세요.");
      const asset = parsed.usePlacePhoto
        ? await image.defaultImage(run.brief.placeId ?? run.brief.place)
        : await image.getAsset(parsed.assetId!);
      if (!asset) throw new AppError("이 장소의 사진을 찾을 수 없습니다.", 404);
      const expected = getPlace(run.brief.placeId ?? run.brief.place)?.id;
      if (expected && asset.placeId !== expected) throw new AppError("선택한 장소와 사진의 장소가 다릅니다.");
      const latest = this.require(id);
      this.idleOnly(latest);
      this.version(latest, parsed.version);
      return this.applyImage(latest, card.id, {...asset,crop:parsed.crop ?? {x:.5,y:.5,zoom:1}}, "담당자 사진 교체");
    }
    if (!image.configured()) throw new AppError("AI 이미지 연결 설정이 필요합니다. API 키·이미지 모델·호출 비용 상한을 설정하세요.", 503);
    if (this.jobs.size >= 2) throw new AppError("동시에 두 개까지 제작할 수 있습니다.", 429);
    const remaining = run.limits.maxDurationMs - (run.usage.elapsedMs ?? 0);
    if (remaining <= 0) throw new AppError("누적 실행 시간 상한에 도달했습니다.", 409);
    const prompt = image.buildPrompt(run, card, parsed.subject);
    const jobId = randomUUID();
    run.imageJob = {id:jobId,cardId:card.id,expectedVersion:run.version,status:"running",prompt,startedAt:new Date().toISOString(),baseElapsedMs:run.usage.elapsedMs ?? 0};
    run.updatedAt = run.imageJob.startedAt;
    this.store.save(run);
    const controller = new AbortController();
    const timeout = AbortSignal.timeout(Math.max(1,Math.ceil(remaining)));
    const signal = AbortSignal.any([controller.signal,timeout]);
    const started = Date.now();
    const priorElapsed = run.usage.elapsedMs ?? 0;
    const persistUsage = (next: Run) => {
      const latest = this.require(id);
      latest.usage = {...next.usage,elapsedMs:Math.min(run.limits.maxDurationMs,priorElapsed+Date.now()-started)};
      latest.modelCallLog = structuredClone(next.modelCallLog);
      latest.execution = structuredClone(next.execution);
      latest.updatedAt = new Date().toISOString();
      this.store.save(latest);
    };
    const promise = Promise.resolve().then(async () => {
      try {
        const asset = await image.generate(run,prompt,card.image,signal,persistUsage);
        signal.throwIfAborted();
        const latest = this.require(id);
        if (latest.imageJob?.id !== jobId || latest.imageJob.status !== "running") return;
        this.version(latest,parsed.version);
        if (run.brief.placeId && asset.placeId !== run.brief.placeId) throw new AppError("생성 이미지의 장소가 일치하지 않습니다.");
        latest.imageJob.status = "succeeded";
        this.applyImage(latest,card.id,{...asset,crop:{x:.5,y:.5,zoom:1}},"요청한 카드의 AI 이미지 생성");
      } catch {
        const latest = this.require(id);
        if (latest.imageJob?.id === jobId && latest.imageJob.status === "running") {
          latest.imageJob.status = controller.signal.aborted ? "cancelled" : "failed";
          latest.imageJob.error = timeout.aborted ? "이미지 생성 시간이 초과되었습니다. 기존 사진은 유지됩니다." : controller.signal.aborted ? "이미지 생성을 취소했습니다." : "이미지 생성에 실패했습니다. 연결 설정과 남은 예산을 확인한 뒤 다시 시도하세요.";
          latest.updatedAt = new Date().toISOString();
          this.store.save(latest);
        }
      } finally {
        persistUsage(run);
        this.jobs.delete(id);
      }
    });
    this.jobs.set(id,{controller,promise});
    return this.require(id);
  }
  cancelImage(id: string, input: unknown): Run {
    const {version} = versionSchema.parse(input);
    const run = this.require(id);
    this.version(run,version);
    if (run.imageJob?.status !== "running") throw new AppError("생성 중인 이미지만 취소할 수 있습니다.",409);
    run.imageJob.status = "cancelled";
    run.imageJob.error = "이미지 생성을 취소했습니다. 기존 사진을 유지합니다.";
    run.updatedAt = new Date().toISOString();
    this.store.save(run);
    this.jobs.get(id)?.controller.abort();
    return run;
  }
  create(input: unknown): Run {
    const parsed = createSchema.parse(input);
    const existing = this.store.findRequest(parsed.requestId);
    if (existing) {
      if (
        existing.brief.place !== parsed.brief.place ||
        (existing.brief.placeId ?? getPlace(existing.brief.place)?.id) !== parsed.brief.placeId ||
        existing.brief.purpose !== parsed.brief.purpose ||
        (existing.submittedReadingStyle ?? existing.brief.readingStyle ?? "standard") !== parsed.brief.readingStyle ||
        existing.brief.audience !== parsed.brief.audience ||
        existing.brief.goal !== parsed.brief.goal ||
        existing.brief.cardCount !== parsed.brief.cardCount ||
        existing.brief.includeFuture !== parsed.brief.includeFuture ||
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
          current.modelCallLog = structuredClone(next.modelCallLog);
          current.execution = structuredClone(next.execution);
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
    delete run.readingStyleChange;
    card.body = parsed.body;
    card.script = parsed.body;
    const oldClaims = run.claims.filter((c) => c.cardId === card.id);
    const idClaim = oldClaims[0]?.id ?? `${card.id}-manual`;
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
    run.assessments = [];
    run.proposedChanges = [];
    run.protectedCardIds = [...new Set([...(run.protectedCardIds ?? []), card.id])];
    run.status = "needs_review";
    run.stopReason = "문구가 수정되었습니다. 새 버전을 다시 검수하세요.";
    run.updatedAt = new Date().toISOString();
    run.revisions.push({
      version: run.version,
      createdAt: run.updatedAt,
      cards: structuredClone(run.cards),
      claims: structuredClone(run.claims),
      reason: "담당자 문구 수정",
      origin: "human",
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
    this.idleOnly(latest);
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
  simplify(id: string, input: unknown): Run {
    const { version } = versionSchema.parse(input);
    const run = this.require(id);
    this.idleOnly(run);
    this.version(run, version);
    if (run.status === "cancelled" || run.cards.length !== 4)
      throw new AppError("완성된 카드가 있는 작업에서 쉬운 설명을 만들 수 있습니다.", 409);
    if (run.brief.readingStyle === "easy")
      throw new AppError("이미 쉬운 설명으로 제작한 버전입니다.", 409);
    const targetCardIds = run.cards.filter(card => !run.protectedCardIds?.includes(card.id)).map(card => card.id);
    if (!targetCardIds.length)
      throw new AppError("모든 카드가 담당자 편집으로 보호되어 있습니다. 문구를 직접 수정해 주세요.", 409);
    if (!run.evidence.length)
      throw new AppError("기존 문장의 공식 근거를 먼저 확인해 주세요.", 409);
    if (run.usage.toolCalls >= run.limits.maxToolCalls || run.usage.modelCalls >= run.limits.maxModelCalls ||
        run.usage.costUsd >= run.limits.maxCostUsd || (run.automaticRevisions ?? 0) >= run.limits.maxRevisions ||
        (run.usage.elapsedMs ?? 0) >= run.limits.maxDurationMs)
      throw new AppError("누적 실행 상한에 도달했습니다. 새 제작을 시작하세요.", 409);
    if (run.mode === "live" && !this.deps.liveAvailable?.())
      throw new AppError("실제 API 연결과 비용 상한 설정을 확인해 주세요.", 503);
    if (this.jobs.size >= 2) throw new AppError("동시 제작 상한에 도달했습니다.", 429);
    if (!run.revisions.some(revision => revision.version === version))
      run.revisions.push({ version, createdAt: run.updatedAt, cards: structuredClone(run.cards), claims: structuredClone(run.claims), reason: "쉬운 설명 변경 전 저장" });
    run.submittedReadingStyle ??= run.brief.readingStyle ?? "standard";
    run.readingStyleChange = { expectedVersion: version, targetCardIds, status: "requested" };
    run.reviewVersion = null;
    run.approval = null;
    run.artifacts = [];
    run.assessments = [];
    run.proposedChanges = [];
    this.start(run);
    return this.require(id);
  }
}
