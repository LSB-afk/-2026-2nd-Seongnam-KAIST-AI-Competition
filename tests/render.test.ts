import { randomUUID, createHash } from "node:crypto";
import { readFile, rm, access } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import type { Run } from "../src/lib/types";
import { cardHtml, renderCards } from "../src/lib/render";

const paths: string[] = [];
function runFixture(): Run {
  const id = `render-test-${randomUUID()}`;
  paths.push(resolve("outputs", id));
  return {
    id,
    brief: {
      place: "판교박물관",
      audience: "청소년",
      goal: "문화 소개",
      cardCount: 4,
      includeFuture: true,
    },
    mode: "fixture",
    strategy: "agent",
    scenario: "normal",
    status: "running",
    createdAt: "2026-09-10T00:00:00Z",
    updatedAt: "2026-09-10T00:00:00Z",
    version: 2,
    reviewVersion: 2,
    sources: [
      {
        id: "s1",
        url: "https://example.org/museum",
        title: "박물관 소개",
        publisher: "성남시",
        retrievedAt: "2026-09-10T00:00:00Z",
        status: "ok",
        snapshot: "판교박물관 소개 자료",
        hash: "source-hash",
        license: "미확인",
      },
    ],
    evidence: [
      {
        id: "e1",
        sourceId: "s1",
        quote: "판교박물관 소개 자료",
        locator: "본문",
      },
    ],
    cards: Array.from({ length: 4 }, (_, index) => ({
      id: `c${index + 1}`,
      title: [
        "도시 아래, 시간을 만나다",
        "돌에 남겨진 이야기",
        "과거를 읽는 새로운 시선",
        "우리가 상상하는 문화공간",
      ][index],
      body: "판교박물관에서 우리 도시의 이야기를 만나 보세요. 오래된 공간을 살펴보며 오늘의 질문을 던져 봅니다.",
      script: "함께 박물관의 이야기를 알아볼까요?",
      claimIds: [],
      imagination: index === 3,
    })),
    claims: [],
    issues: [],
    revisions: [],
    events: [],
    artifacts: [],
    usage: {
      toolCalls: 4,
      modelCalls: 0,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      costKind: "fixture",
    },
    limits: {
      maxToolCalls: 12,
      maxRevisions: 3,
      maxDurationMs: 180000,
      maxModelCalls: 12,
      maxCostUsd: 1,
    },
    approval: null,
    stopReason: null,
  };
}
afterEach(async () => {
  await Promise.all(
    paths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe("card export boundary", () => {
  it("escapes untrusted text and does not turn source URLs into executable markup", () => {
    const run = runFixture();
    run.cards[0].title = '<script>alert("x")</script>';
    run.cards[0].body = '<img src=x onerror=alert(1)> & "quoted"';
    run.sources[0].publisher = "<svg onload=alert(2)>";
    run.sources[0].url = 'javascript:alert("x")';
    const html = cardHtml(run, run.cards[0], 0);
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;svg onload=alert(2)&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain('href="javascript:');
  });

  it("rejects a stale review and unresolved review issues before exporting", async () => {
    const run = runFixture();
    run.reviewVersion = 1;
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/검수|review/i);
    run.reviewVersion = 2;
    run.issues = [
      {
        id: "i1",
        targetId: "c1",
        type: "source",
        severity: "warning",
        message: "근거 부족",
        evidenceIds: [],
        recommendation: "확인",
        resolved: false,
      },
    ];
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/미해결|unresolved/i);
  });

  it("exports four full-sized PNGs and a ZIP with matching review versions and mode", async () => {
    const run = runFixture();
    const artifacts = await renderCards(run, new AbortController().signal);
    const pngs = artifacts.filter((file) => file.kind === "png");
    expect(pngs).toHaveLength(4);
    for (const artifact of artifacts) {
      const bytes = await readFile(artifact.path);
      expect(artifact.sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(artifact.version).toBe(2);
      expect(artifact.reviewVersion).toBe(2);
      if (artifact.kind === "png") {
        expect(bytes.subarray(1, 4).toString()).toBe("PNG");
        expect(bytes.readUInt32BE(16)).toBe(1080);
        expect(bytes.readUInt32BE(20)).toBe(1080);
      }
    }
    const zip = unzipSync(
      await readFile(artifacts.find((file) => file.kind === "zip")!.path),
    );
    expect(
      Object.keys(zip).filter((name) => name.endsWith(".png")),
    ).toHaveLength(4);
    expect(strFromU8(zip["script.md"])).toContain("fixture");
    expect(JSON.parse(strFromU8(zip["review.json"]))).toMatchObject({
      version: 2,
      reviewVersion: 2,
      mode: "fixture",
      issues: [],
      auditStage: "render_snapshot",
      assessments: [],
      reviews: [],
      modelCallLog: [],
    });
    expect(JSON.parse(strFromU8(zip["sources.json"]))).toMatchObject({
      mode: "fixture",
      evidence: [
        {
          id: "e1",
          sourceId: "s1",
          quote: "판교박물관 소개 자료",
          locator: "본문",
        },
      ],
    });
  }, 60000);

  it("rejects text overflow and removes incomplete output files", async () => {
    const run = runFixture();
    run.cards[0].body = "한글 문장이 카드 밖으로 넘칩니다. ".repeat(500);
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/잘림|overflow/i);
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  }, 60000);

  it("does not create files for a cancelled run", async () => {
    const run = runFixture();
    const controller = new AbortController();
    controller.abort();
    await expect(renderCards(run, controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  });

  it("rejects missing cards and missing final imagination marker", async () => {
    const run = runFixture();
    run.cards[3].imagination = false;
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/상상/);
    run.cards.pop();
    await expect(
      renderCards(run, new AbortController().signal),
    ).rejects.toThrow(/4장/);
  });

  it("cleans up a render interrupted during browser startup", async () => {
    const run = runFixture();
    const controller = new AbortController();
    const task = renderCards(run, controller.signal);
    const timer = setTimeout(() => controller.abort(), 30);
    try {
      await expect(task).rejects.toMatchObject({ name: "AbortError" });
    } finally {
      clearTimeout(timer);
    }
    await expect(access(resolve("outputs", run.id, "v2"))).rejects.toThrow();
  }, 60000);
});
