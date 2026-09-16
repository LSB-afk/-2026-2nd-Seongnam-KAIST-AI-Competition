import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, proxy } from "../src/proxy";

const call = (path: string) => proxy(new NextRequest(`http://127.0.0.1:3000${path}`));

describe("malformed percent-encoded paths", () => {
  it.each(["/api/runs/%C3%28", "/api/runs/%", "/api/stories/%E0%A4%A"])("answers %s with a JSON 400", async (path) => {
    const response = call(path)!;
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/^application\/json/);
    expect(await response.json()).toEqual({ error: "주소 형식이 올바르지 않습니다." });
  });

  it("answers a malformed story page with short Korean text", async () => {
    const response = call("/stories/%C3%28")!;
    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
    expect(await response.text()).toBe("주소 형식이 올바르지 않습니다.");
  });

  it("lets decodable paths continue to the app", () => {
    for (const path of ["/api/runs/abc", "/api/runs/a%20b", "/stories/%ED%8C%90%EA%B5%90"]) expect(call(path)).toBeUndefined();
  });

  it("runs only for percent-encoded API and story paths", () => {
    for (const url of ["/api/runs/%C3%28", "/api/runs/%", "/stories/%C3%28", "/stories/%ED%8C%90%EA%B5%90"]) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(true);
    // Uploads must skip the proxy: Next caps proxied request bodies at 10MB.
    for (const url of ["/api/images", "/api/runs/abc/approve", "/stories/abc", "/", "/%C3%28", "/icon.svg"]) expect(unstable_doesMiddlewareMatch({ config, url })).toBe(false);
  });
});
