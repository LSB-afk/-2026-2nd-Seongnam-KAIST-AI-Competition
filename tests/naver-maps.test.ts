import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { getMapConfig } from "../src/lib/map-config";

describe("public map configuration", () => {
  it("never exposes server secrets and treats missing or malformed IDs as unconfigured", () => {
    expect(getMapConfig({ ANTHROPIC_API_KEY: "secret", NCP_MAPS_CLIENT_SECRET: "secret" })).toEqual({ provider: "naver", configured: false, reason: "missing-client-id" });
    expect(getMapConfig({ NCP_MAPS_CLIENT_ID: " public-key ", NCP_MAPS_CLIENT_SECRET: "secret" })).toEqual({ provider: "naver", configured: true, clientId: "public-key" });
    expect(getMapConfig({ NCP_MAPS_CLIENT_ID: "<script>" }).configured).toBe(false);
  });
});

describe("NAVER SDK boundary (browser mock, not real map validation)", () => {
  let browser: Browser;
  let page: Page;
  let moduleCode: string;
  let mock: string;
  const run = <T = unknown>(source: string) => page.evaluate(source) as Promise<T>;
  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    moduleCode = ts.transpileModule(await readFile("src/lib/naver-maps.ts", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
    mock = await readFile("tests/fixtures/naver-maps-mock.js", "utf8");
  });
  beforeEach(async () => {
    await page?.close();
    page = await browser.newPage();
    await page.route("http://map.test/", route => route.fulfill({ contentType: "text/html", body: '<div id="map" style="width:600px;height:500px"></div>' }));
    await page.goto("http://map.test/");
    await page.addScriptTag({ content: `{ const exports = {}; ${moduleCode}\nwindow.__mapLib = exports; }` });
  });
  afterAll(async () => { await browser?.close(); });
  const ready = async (mode = "normal") => {
    await run(`window.__naverMockMode = ${JSON.stringify(mode)}`);
    await page.route("**/openapi/v3/maps.js*", route => route.fulfill({ contentType: "application/javascript", body: mock }));
    await run('window.__mapLib.loadNaverMaps("public-key")');
  };
  const start = async (extra = "") => {
    await run(`window.states = []; window.views = []; window.selections = []; window.groups = [];
      window.places = [{id:'a', name:'첫 장소',lat:37.415,lng:127.115}, {id:'b',name:'둘째 장소',lat:37.415,lng:127.115}];
      window.session = window.__mapLib.createMapSession({container:document.getElementById('map'),maps:window.naver.maps,places:window.places,selectedId:null,focusId:null,onSelect:p=>selections.push(p.id),onCluster:p=>groups.push(p.map(x=>x.id)),onViewportChange:v=>views.push(v),onState:s=>states.push(s),${extra}});`);
  };
  it("shares one script/promise and uses the current public key parameter", async () => {
    await page.route("**/openapi/v3/maps.js*", route => route.fulfill({ contentType: "application/javascript", body: mock }));
    expect(await run(`(()=>{let a=__mapLib.loadNaverMaps('public-key');let b=__mapLib.loadNaverMaps('public-key');return a===b})()`)).toBe(true);
    await run('__mapLib.loadNaverMaps("public-key")');
    expect(await page.locator("script[src*='openapi/v3/maps.js']").count()).toBe(1);
    expect(await page.locator("script[src*='openapi/v3/maps.js']").getAttribute("src")).toContain("ncpKeyId=public-key");
  });
  it("reports network failure and keeps retries failed until a fresh page", async () => {
    await page.route("**/openapi/v3/maps.js*", route => route.abort());
    expect(await run('__mapLib.loadNaverMaps("public-key").catch(e=>e.code)')).toBe("script-network");
    expect(await run('__mapLib.loadNaverMaps("public-key").catch(e=>e.code)')).toBe("script-network");
    expect(await page.locator("script[src*='openapi/v3/maps.js']").count()).toBe(1);
    await page.reload();
    await page.addScriptTag({ content: `{ const exports = {}; ${moduleCode}\nwindow.__mapLib = exports; }` });
    await page.unroute("**/openapi/v3/maps.js*");
    await ready();
    expect(await run("typeof window.naver.maps.Map")).toBe("function");
  });
  it("ignores a ready callback after timeout instead of reviving a failed SDK", async () => {
    await page.route("**/openapi/v3/maps.js*", route => route.fulfill({ body: "/* no callback */" }));
    expect(await run('__mapLib.loadNaverMaps("public-key",{timeoutMs:20}).catch(e=>e.code)')).toBe("sdk-timeout");
    await page.addScriptTag({ content: mock });
    expect(await run('__mapLib.loadNaverMaps("public-key").catch(e=>e.code)')).toBe("sdk-timeout");
  });
  it("reports authentication before readiness and after the shared promise resolves", async () => {
    await run("window.failures=[];window.unsubscribe=__mapLib.subscribeNaverFailure(e=>failures.push(e.code))");
    await ready();
    await run("navermap_authFailure(); unsubscribe(); navermap_authFailure()");
    expect(await run("failures")).toEqual(["authentication"]);
    expect(await run('__mapLib.loadNaverMaps("public-key").catch(e=>e.code)')).toBe("authentication");
    await page.reload();
    await page.addScriptTag({ content: `{ const exports = {}; ${moduleCode}\nwindow.__mapLib = exports; }` });
    await run("window.__naverMockMode='authentication'");
    expect(await run('__mapLib.loadNaverMaps("public-key").catch(e=>e.code)')).toBe("authentication");
  });
  it("waits for visible positive dimensions, resizes, and cleans up every map resource", async () => {
    await ready();
    await page.locator("#map").evaluate(el => { (el as HTMLElement).style.width = "0px"; });
    await start("visible:false,");
    expect(await run("__naverMock.created")).toBe(0);
    await run("session.update({visible:true})");
    expect(await run("__naverMock.created")).toBe(0);
    await page.locator("#map").evaluate(el => { (el as HTMLElement).style.width = "600px"; });
    await page.waitForFunction("__naverMock.created===1");
    await page.locator("#map").evaluate(el => { (el as HTMLElement).style.width = "700px"; });
    await page.waitForFunction("__naverMock.resized.some(x=>x.width===700)");
    await run("session.destroy();session.destroy();window.before=views.length;__naverMock.emitAll('idle')");
    expect(await run("({destroyed:__naverMock.destroyed,events:__naverMock.activeEvents,markers:document.querySelectorAll('.naver-map-marker').length,late:views.length-before})")).toEqual({ destroyed: 1, events: 0, markers: 0, late: 0 });
  });
  it("keeps co-located places selectable and activates native buttons once by keyboard", async () => {
    await ready(); await start();
    const cluster = page.getByRole("button", { name: "관광지 2곳 목록 열기" });
    await cluster.focus(); await page.keyboard.press("Enter");
    expect(await run("groups")).toEqual([["a", "b"]]);
    await run("session.update({places:[places[0]]})");
    const marker = page.getByRole("button", { name: "첫 장소 상세 열기" });
    await marker.focus(); await page.keyboard.press("Space");
    expect(await run("selections")).toEqual(["a"]);
    await run("session.update({selectedId:'a'})");
    expect(await marker.getAttribute("aria-pressed")).toBe("true");
    expect(await marker.evaluate(el => el === document.activeElement)).toBe(true);
  });
  it("merges overlapping points across cell boundaries, including merged group centers", async () => {
    expect(await run(`__mapLib.clusterProjectedPlaces([{place:{id:'a'},x:59,y:0},{place:{id:'b'},x:61,y:0},{place:{id:'c'},x:200,y:0}]).map(g=>g.places.map(p=>p.id))`)).toEqual([["a", "b"], ["c"]]);
  });
  it("fits changed filter membership, leaves an empty result viewport intact, and honors initial focus", async () => {
    await ready(); await start("focusId:'a',");
    expect(await run("__naverMock.options[0].zoom")).toBe(15);
    await run("session.setView({lat:36.3,lng:127.7,zoom:7});session.update({places:[places[0]]})");
    expect(await run("__naverMock.maps[0].getZoom()")).toBe(15);
    await run("session.update({places:[]})");
    expect(await run("document.querySelectorAll('.naver-map-marker').length")).toBe(0);
    expect(await run("__naverMock.maps[0].getZoom()")).toBe(15);
  });
  it("restores the saved camera instead of fitting when history restores filters and viewport together", async () => {
    await ready(); await start();
    await run("session.update({places:[places[0]],viewport:{lat:36.3,lng:127.7,zoom:7}})");
    expect(await run("__naverMock.maps[0].getZoom()")).toBe(7);
    expect(await run("__naverMock.maps[0].getCenter().lat()")).toBe(36.3);
  });
  it("preserves an explicit restored viewport; selection alone does not pan, focus does", async () => {
    await ready(); await start("viewport:{lat:36.3,lng:127.7,zoom:7},");
    expect(await run("__naverMock.options[0].zoom")).toBe(7);
    expect(await run("__naverMock.options[0].scrollWheel")).toBe(false);
    await run("session.update({selectedId:'a'})");
    expect(await run("__naverMock.maps[0].getZoom()")).toBe(7);
    await run("session.update({focusId:'a'})");
    expect(await run("__naverMock.maps[0].getZoom()")).toBe(15);
    await page.waitForFunction("views.some(v=>v.zoom===15)");
    await run("session.destroy()");
    await start("viewport:{lat:36.3,lng:127.7,zoom:7},");
    expect(await run("__naverMock.created")).toBe(2);
  });
  it("does not call idle a tile success, and cleans up even before deferred creation", async () => {
    await ready("no-tiles"); await start("tileTimeoutMs:20,");
    await page.waitForFunction("states.includes('tiles-delayed')");
    expect(await run("states.includes('ready')")).toBe(false);
    await run("session.destroy()");
    await start("visible:false,");
    await run("session.destroy();session.update({visible:true})");
    expect(await run("__naverMock.created")).toBe(1);
  });
});
