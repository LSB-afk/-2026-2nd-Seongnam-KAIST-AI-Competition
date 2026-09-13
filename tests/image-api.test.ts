import { afterEach, expect, it, vi } from "vitest";
import { POST } from "../src/app/api/images/route";
import { GET } from "../src/app/api/images/[id]/route";
import { getStoredImage, readImage, storeImage } from "../src/lib/images";
vi.mock("../src/lib/images",()=>({storeImage:vi.fn(),getStoredImage:vi.fn(),readImage:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
const request=(input:unknown,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/images",{method:"POST",headers:{"content-type":"application/json",origin},body:JSON.stringify(input)});
const input={data:"AAAA",mime:"image/png",placeId:"pangyo-museum",author:"담당자",license:"사용자가 이용 권한을 확인한 사진"};
it("requires explicit photo rights and canonical place before decoding",async()=>{
  expect((await POST(request({...input,license:""}))).status).toBe(400);
  expect((await POST(request({...input,placeId:"unknown"}))).status).toBe(400);
  expect((await POST(request(input,"https://foreign.example"))).status).toBe(403);
  expect(storeImage).not.toHaveBeenCalled();
});
it("stores only raster bytes with provenance and returns a safe asset identifier",async()=>{
  vi.mocked(storeImage).mockResolvedValue({id:"saved"} as Awaited<ReturnType<typeof storeImage>>);
  const response=await POST(request(input));expect(response.status).toBe(201);expect(await response.json()).toEqual({id:"saved"});
  expect(storeImage).toHaveBeenCalledWith(expect.any(Buffer),expect.objectContaining({placeId:"pangyo-museum",kind:"upload",author:"담당자",license:input.license}),expect.any(AbortSignal));
});
it("rejects a URL payload and surfaces corrupt raster as a recoverable client error",async()=>{
  expect((await POST(request({...input,data:"https://internal/image.png"}))).status).toBe(400);
  vi.mocked(storeImage).mockRejectedValue(new Error("internal path secret"));
  const response=await POST(request(input));expect(response.status).toBe(400);expect(await response.text()).not.toContain("secret");
});
it("serves only validated immutable image bytes with nosniff",async()=>{
  vi.mocked(getStoredImage).mockResolvedValue({mime:"image/png"} as Awaited<ReturnType<typeof getStoredImage>>);
  vi.mocked(readImage).mockResolvedValue(new Uint8Array([1,2,3]));
  const response=await GET(new Request("http://localhost/api/images/id"),{params:Promise.resolve({id:"id"})});
  expect(response.status).toBe(200);expect(response.headers.get("x-content-type-options")).toBe("nosniff");expect(response.headers.get("content-type")).toBe("image/png");expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([1,2,3]));
});
