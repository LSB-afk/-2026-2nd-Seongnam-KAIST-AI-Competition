import { describe, it, expect } from "vitest";
import { body } from "../src/lib/http";
describe("browser mutation origin boundary", () => {
  it("allows bounded image JSON without increasing the normal action limit", async()=>{
    const request=()=>new Request("http://localhost:3000/api/images",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({data:"a".repeat(18000)})});
    await expect(body(request())).rejects.toThrow(/너무 큽니다/);
    await expect(body(request(),20000)).resolves.toHaveProperty("data");
    await expect(body(request(),10000)).rejects.toThrow(/너무 큽니다/);
  });
  it("rejects a body that is not UTF-8 instead of saving replacement characters", async () => {
    const request = (data: BodyInit) => new Request("http://localhost:3000/api/runs", { method: "POST", headers: { "content-type": "application/json" }, body: data });
    const cp949 = Uint8Array.from([...new TextEncoder().encode('{"title":"'), 0xc7, 0xd1, 0xb1, 0xdb, ...new TextEncoder().encode('"}')]);
    await expect(body(request(cp949))).rejects.toMatchObject({ status: 400, message: "UTF-8로 인코딩된 JSON 요청이 필요합니다." });
    await expect(body(request('{"title":"한글"}'))).resolves.toEqual({ title: "한글" });
  });
  it("accepts same-origin browser request when Next normalizes internal URL to localhost", async () => {
    const req = new Request("http://localhost:3000/api/runs", {
      method: "POST",
      headers: {
        host: "127.0.0.1:3000",
        origin: "http://127.0.0.1:3000",
        "content-type": "application/json",
      },
      body: '{"mode":"fixture"}',
    });
    await expect(body(req)).resolves.toEqual({ mode: "fixture" });
  });
  it.each(["https://untrusted.example", "http://localhost:9999", "null"])(
    "blocks foreign origin %s",
    async (origin) => {
      const req = new Request("http://localhost:3000/api/runs", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          origin,
          "content-type": "application/json",
        },
        body: "{}",
      });
      await expect(body(req)).rejects.toThrow(/다른 사이트/);
    },
  );
  it("does not trust a matching malicious host and origin", async () => {
    const req = new Request("http://localhost:3000/api/runs", {
      method: "POST",
      headers: {
        host: "untrusted.example",
        origin: "http://untrusted.example",
        "content-type": "application/json",
      },
      body: "{}",
    });
    await expect(body(req)).rejects.toThrow();
  });
});
