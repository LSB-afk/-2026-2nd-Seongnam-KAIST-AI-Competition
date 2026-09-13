import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildImagePrompt, generateImage, getImageConfig } from "../src/lib/image-provider";
import { readImage, storeImage } from "../src/lib/images";
import { newRun } from "../src/lib/run";
import type { Card, ImageAsset, Run } from "../src/lib/types";

vi.mock("../src/lib/images", () => ({ readImage: vi.fn(), storeImage: vi.fn() }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==", "base64");
const card: Card = { id: "card-1", title: "Museum", body: "A quiet cultural visit", script: "", claimIds: [], imagination: false };
const asset: ImageAsset = { id: "generated-image", placeId: "pangyo-museum", kind: "ai", src: "/api/images/generated-image", sha256: "hash", width: 1024, height: 1024, mime: "image/png", sourceUrl: "", author: "OpenAI", license: "AI 생성", licenseUrl: "", createdAt: "2026-09-13T00:00:00Z" };

function state(): Run {
  const run = newRun({ mode: "fixture" });
  run.brief.placeId = "pangyo-museum";
  run.execution!.model = "text-model";
  return run;
}
function invoke(run = state(), signal = new AbortController().signal, reference?: ImageAsset, persist: (run: Run) => void = () => {}) {
  return generateImage(run, buildImagePrompt(run, card), reference, signal, persist);
}
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", "image-test-secret");
  vi.stubEnv("OPENAI_IMAGE_MODEL", "image-test-model");
  vi.stubEnv("IMAGE_MAX_COST_USD_PER_CALL", "0.2");
  vi.stubEnv("MAX_COST_USD", "1");
  vi.mocked(readImage).mockResolvedValue(png);
  vi.mocked(storeImage).mockResolvedValue(asset);
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ data: [{ b64_json: png.toString("base64") }] })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetAllMocks(); });

describe("image API boundary", () => {
  it.each(["OPENAI_API_KEY", "OPENAI_IMAGE_MODEL", "IMAGE_MAX_COST_USD_PER_CALL", "MAX_COST_USD"])("requires explicit %s without any fallback price or model", async (name) => {
    vi.stubEnv(name, "");
    expect(getImageConfig().configured).toBe(false);
    expect(getImageConfig().reason).toContain(name);
    await expect(invoke()).rejects.toThrow("설정");
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["0", "-1", "NaN", "Infinity", "2"])("rejects invalid or excessive reservation %s", (value) => {
    vi.stubEnv("IMAGE_MAX_COST_USD_PER_CALL", value);
    expect(getImageConfig().configured).toBe(false);
  });
  it("persists shared budget and image-specific log before generation; preserves text model identity", async () => {
    const run = state();
    run.usage.costUsd = 0.1;
    const snapshots: Run[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/images/generations");
      expect(snapshots.at(-1)?.execution?.apiCalls).toBe(1);
      expect(snapshots.at(-1)?.usage).toMatchObject({ modelCalls: 1, costUsd: expect.closeTo(0.3), costKind: "estimated" });
      expect(snapshots.at(-1)?.modelCallLog?.[0]).toMatchObject({ status: "reserved", model: "image-test-model", reservedCostUsd: 0.2, promptVersion: "tourism-image-v1" });
      expect(JSON.parse(init!.body as string)).toMatchObject({ model: "image-test-model", size: "1024x1024", quality: "high", n: 1, output_format: "png" });
      expect(JSON.parse(init!.body as string)).not.toHaveProperty("images");
      expect(init?.headers).toMatchObject({ authorization: "Bearer image-test-secret" });
      expect(init?.redirect).toBe("error");
      return Response.json({ data: [{ b64_json: png.toString("base64") }] });
    }));
    await expect(invoke(run, undefined, undefined, (value) => snapshots.push(structuredClone(value)))).resolves.toEqual(asset);
    expect(storeImage).toHaveBeenCalledWith(png, expect.objectContaining({ placeId: "pangyo-museum", kind: "ai", license: expect.stringContaining("AI 생성"), prompt: expect.objectContaining({ referenceImage: null }) }), expect.any(AbortSignal));
    expect(run.execution!.model).toBe("text-model");
    expect(run.usage.costUsd).toBeCloseTo(0.3);
    expect(run.modelCallLog?.[0]).toMatchObject({ status: "succeeded", costUsd: 0.2 });
    expect(JSON.stringify(snapshots)).not.toContain("image-test-secret");
  });
  it("edits using only verified local reference bytes and records reference identity", async () => {
    const reference = { ...asset, id: "reference-image", kind: "photo" as const, src: "https://untrusted.example/image.png" };
    await invoke(state(), undefined, reference);
    expect(readImage).toHaveBeenCalledWith(reference);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/images/edits");
    const body = JSON.parse(init!.body as string);
    expect(body.images).toEqual([{ image_url: `data:image/png;base64,${png.toString("base64")}` }]);
    expect(body.prompt).toContain("reference-image");
    expect(body.prompt).not.toContain("untrusted.example");
  });
  it("preserves reference attribution and ShareAlike conditions in the generated asset", async () => {
    const reference: ImageAsset = {
      ...asset, id: "licensed-photo", kind: "photo", sha256: "a".repeat(64),
      sourceUrl: "https://commons.wikimedia.org/wiki/File:Travel.jpg",
      author: "Original Photographer",
      license: "CC BY-SA 4.0 · 저작자 표시 · 동일조건변경허락",
      licenseUrl: "https://creativecommons.org/licenses/by-sa/4.0/",
    };
    vi.mocked(storeImage).mockImplementation(async (_bytes, metadata) => ({ ...asset, ...metadata }));
    const generated = await invoke(state(), undefined, reference);
    expect(generated).toMatchObject({
      kind: "ai",
      sourceUrl: reference.sourceUrl,
      author: `OpenAI; 참조 사진: ${reference.author}`,
      license: `AI 생성 이미지 · 실제 모습과 다를 수 있습니다; 참조 사진 조건: ${reference.license}`,
      licenseUrl: reference.licenseUrl,
      reference: {
        id: reference.id, placeId: reference.placeId, sha256: reference.sha256,
        sourceUrl: reference.sourceUrl, author: reference.author,
        license: reference.license, licenseUrl: reference.licenseUrl,
      },
    });
    expect(storeImage).toHaveBeenCalledWith(png, expect.objectContaining({ reference: generated.reference }), expect.any(AbortSignal));
  });
  it("rejects attribution exceeding storage limits before reserving a call", async () => {
    const run = state();
    await expect(invoke(run, undefined, { ...asset, author: "x".repeat(500) })).rejects.toThrow("저작자");
    expect(fetch).not.toHaveBeenCalled();
    expect(run.usage.costUsd).toBe(0);
  });
  it("resolves a legacy name-only run to the registered place", async () => {
    const run = state(); delete run.brief.placeId;
    await invoke(run);
    expect(storeImage).toHaveBeenCalledWith(png, expect.objectContaining({ placeId: "pangyo-museum" }), expect.any(AbortSignal));
  });
  it("rejects oversized prompt metadata before reserving a billed call", async () => {
    const run = state();
    const prompt = buildImagePrompt(run, card, "x".repeat(12_001));
    await expect(generateImage(run, prompt, undefined, new AbortController().signal, () => {})).rejects.toThrow("프롬프트");
    expect(fetch).not.toHaveBeenCalled();
    expect(run.usage.costUsd).toBe(0);
  });
  it("rejects unreadable and wrong-place references before reserving or calling", async () => {
    const run = state();
    await expect(invoke(run, undefined, { ...asset, placeId: "another-place" })).rejects.toThrow("장소");
    vi.mocked(readImage).mockRejectedValue(new Error("private path and image-test-secret"));
    await expect(invoke(run, undefined, asset)).rejects.toThrow("안전하게");
    expect(run.usage.costUsd).toBe(0);
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(["budget", "global budget", "call count"])("stops before reservation or API when %s is exhausted", async (limit) => {
    const run = state();
    if (limit === "budget") run.limits.maxCostUsd = 0.1;
    if (limit === "global budget") { run.limits.maxCostUsd = 10; run.usage.costUsd = 0.9; }
    if (limit === "call count") run.usage.modelCalls = run.limits.maxModelCalls;
    await expect(invoke(run)).rejects.toThrow("상한");
    expect(fetch).not.toHaveBeenCalled();
    expect(run.modelCallLog).toEqual([]);
    expect(run.execution!.apiCalls).toBe(0);
  });
  it("retains failed reservation and redacts provider bodies and thrown secrets", async () => {
    const run = state();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider body image-test-secret", { status: 503 })));
    await expect(invoke(run)).rejects.toThrow("503");
    expect(run.modelCallLog?.[0]).toMatchObject({ status: "failed", costUsd: 0.2 });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("image-test-secret private network detail"); }));
    await expect(invoke(run)).rejects.toThrow("통신");
    expect(run.usage.costUsd).toBeCloseTo(0.4);
    expect(run.execution!.apiCalls).toBe(2);
    expect(JSON.stringify(run)).not.toMatch(/image-test-secret|private provider|private network/);
  });
  it("does not reserve pre-cancelled calls", async () => {
    const controller = new AbortController(); controller.abort(new Error("image-test-secret"));
    const run = state();
    await expect(invoke(run, controller.signal)).rejects.toThrow("취소");
    expect(fetch).not.toHaveBeenCalled();
    expect(run.usage.costUsd).toBe(0);
  });
  it("cancels a pending request and retains the unknown-cost reservation", async () => {
    const controller = new AbortController();
    const run = state();
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("image-test-secret")), { once: true });
    })));
    const result = invoke(run, controller.signal);
    controller.abort(new Error("image-test-secret"));
    await expect(result).rejects.toThrow("취소");
    expect(storeImage).not.toHaveBeenCalled();
    expect(run.usage.costUsd).toBe(0.2);
    expect(run.modelCallLog?.[0].error).not.toContain("image-test-secret");
  });
  it("bounds request time using the run duration cap", async () => {
    const run = state(); run.limits.maxDurationMs = 10;
    vi.stubGlobal("fetch", vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new Error("timeout")), { once: true });
    })));
    await expect(invoke(run)).rejects.toThrow("시간 상한");
    expect(run.modelCallLog?.[0].status).toBe("failed");
  });
  it.each([
    { data: [{ url: "http://169.254.169.254/private" }] },
    { data: [{ b64_json: "not base64!!" }] },
    { data: [] },
    null,
  ])("rejects invalid payloads and never follows returned URLs", async (payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    await expect(invoke()).rejects.toThrow("형식");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(storeImage).not.toHaveBeenCalled();
  });
  it("requires raster validation even when the base64 encoding is valid", async () => {
    vi.mocked(storeImage).mockRejectedValue(new Error("private decoder detail image-test-secret"));
    await expect(invoke()).rejects.toThrow("파일 검증");
  });
  it.each([true, false])("bounds image response bytes with or without Content-Length (%s)", async (declared) => {
    const oversized = 30 * 1024 * 1024 + 1;
    vi.stubGlobal("fetch", vi.fn(async () => declared
      ? new Response("{}", { headers: { "content-length": String(oversized) } })
      : new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(oversized)); controller.close(); } }))));
    await expect(invoke()).rejects.toThrow("크기");
    expect(storeImage).not.toHaveBeenCalled();
  });
  it("does not store a late API response after cancellation", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", vi.fn(async () => { controller.abort(); return Response.json({ data: [{ b64_json: png.toString("base64") }] }); }));
    await expect(invoke(state(), controller.signal)).rejects.toThrow("취소");
    expect(storeImage).not.toHaveBeenCalled();
  });
});

describe("structured image brief", () => {
  it("shares the four-card palette, reserves caption space and explicitly distinguishes imagination", () => {
    const run = state();
    const real = buildImagePrompt(run, card, "  museum courtyard  ");
    const future = buildImagePrompt(run, { ...card, imagination: true });
    expect(real.subject).toBe("museum courtyard");
    expect(real.place).toBe(run.brief.place);
    expect(real.palette).toBe(future.palette);
    expect(real.textSpace).toContain("No text, Korean");
    expect(real.imagination).toBe(false);
    expect(future.imagination).toBe(true);
    expect(Object.keys(real)).toHaveLength(9);
  });
});
