import { afterEach, expect, it, vi } from "vitest";
import { GET as listRuns, POST as createRun } from "../src/app/api/runs/route";
import { GET as getRun } from "../src/app/api/runs/[id]/route";
import { POST as runAction } from "../src/app/api/runs/[id]/[action]/route";
import { getService } from "../src/lib/server";
import { publicRun } from "../src/lib/public-run";
import { newRun } from "../src/lib/run";
import type { RunService } from "../src/lib/service";
vi.mock("../src/lib/server",()=>({getService:vi.fn()}));
afterEach(()=>vi.resetAllMocks());
function storedRun() {
  const run=newRun({mode:"fixture"});
  run.artifacts=[{name:"timestory.zip",path:"/srv/timestory/outputs/run/v1/timestory.zip",sha256:"hash",version:1,reviewVersion:1,kind:"zip"}];
  return run;
}
const post=(url:string)=>new Request(url,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});
it("drops server file paths from artifacts without touching the stored run",()=>{
  const run=storedRun();
  expect(publicRun(run).artifacts).toEqual([{name:"timestory.zip",sha256:"hash",version:1,reviewVersion:1,kind:"zip"}]);
  expect(run.artifacts[0].path).toBe("/srv/timestory/outputs/run/v1/timestory.zip");
});
it("never returns artifact paths from run API responses",async()=>{
  const run=storedRun();
  const service={store:{list:()=>[run],get:()=>run},create:()=>run,cancel:()=>run,approve:async()=>run,edit:()=>run,retry:()=>run,simplify:()=>run,image:async()=>run,cancelImage:()=>run};
  vi.mocked(getService).mockReturnValue(service as unknown as RunService);
  const actions=["cancel","approve","edit","retry","simplify","image","image-cancel"];
  const responses=[
    await listRuns(),
    await createRun(post("http://localhost:3000/api/runs")),
    await getRun(new Request(`http://localhost:3000/api/runs/${run.id}`),{params:Promise.resolve({id:run.id})}),
    ...await Promise.all(actions.map(action=>runAction(post(`http://localhost:3000/api/runs/${run.id}/${action}`),{params:Promise.resolve({id:run.id,action})}))),
  ];
  for (const response of responses) {
    const text=await response.text();
    expect(response.status).toBe(200);expect(text).toContain("timestory.zip");expect(text).not.toContain("/srv/timestory");expect(text).not.toContain('"path"');
  }
});
