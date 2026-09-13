import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RunStore } from "../src/lib/store";
import { RunService } from "../src/lib/service";
import { newRun } from "../src/lib/run";
import type { CardImage, ImageAsset, Run } from "../src/lib/types";

const dirs: string[] = [];
afterEach(() => dirs.splice(0).forEach(path => rmSync(path,{recursive:true,force:true})));
const photo: CardImage = {id:"photo1",placeId:"pangyo-museum",kind:"photo",src:"/places/test.png",sha256:"a".repeat(64),width:1600,height:1200,mime:"image/png",sourceUrl:"https://example.org/photo",author:"작가",license:"CC BY 4.0",licenseUrl:"https://creativecommons.org/licenses/by/4.0/",createdAt:"2026-09-13",crop:{x:.5,y:.5,zoom:1}};
function setup(generate?: (run:Run, signal:AbortSignal,persist:(r:Run)=>void)=>Promise<ImageAsset>) {
  const dir=mkdtempSync(join(tmpdir(),"image-service-"));dirs.push(dir);
  const store=new RunStore(join(dir,"runs.sqlite"));
  const service=new RunService(store,{runner:async r=>r,search:async()=>({sources:[],evidence:[]}),render:async()=>[],checkArtifacts:async()=>true,
    image:{configured:()=>true,defaultImage:async()=>structuredClone(photo),getAsset:async id=>({...photo,id,kind:"upload"}),generate:async(r,_p,_a,s,persist)=>generate?generate(r,s,persist):({...photo,kind:"ai"}),buildPrompt:(r,c)=>({place:r.brief.place,subject:c.title,composition:"wide",lighting:"natural",palette:"blue",materials:"stone",referenceImage:c.image?.src??null,textSpace:"top",imagination:c.imagination})}});
  const run=newRun({mode:"fixture"});run.version=1;run.reviewVersion=1;run.status="approved";run.approval={version:1,at:run.createdAt,reviewer:"담당자"};run.protectedCardIds=["c1"];
  run.cards=["c1","c2"].map(id=>({id,title:`제목${id}`,body:`사람이 쓴 문구${id}`,script:"대본",claimIds:[],imagination:false,image:structuredClone(photo)}));
  store.insert(run,"image-test");return {store,service,run};
}
describe("image changes share the content version and approval boundary",()=>{
  it("crops only the selected image and preserves protected text and other cards",async()=>{
    const {store,service,run}=setup();
    const edited=await service.image(run.id,{version:1,cardId:"c1",operation:"crop",crop:{x:.2,y:.7,zoom:1.4}});
    expect(edited.version).toBe(2);expect(edited.reviewVersion).toBeNull();expect(edited.approval).toBeNull();expect(edited.artifacts).toEqual([]);expect(edited.status).toBe("needs_review");
    expect(edited.cards[0].body).toBe(run.cards[0].body);expect(edited.cards[1]).toEqual(run.cards[1]);expect(edited.protectedCardIds).toEqual(["c1"]);
    expect(edited.cards[0].image?.crop).toEqual({x:.2,y:.7,zoom:1.4});expect(edited.revisions.at(-1)?.cards[0].image?.crop.zoom).toBe(1.4);
    await expect(service.image(run.id,{version:1,cardId:"c1",operation:"crop",crop:{x:.5,y:.5,zoom:1}})).rejects.toThrow(/버전/);store.close();
  });
  it("rejects invalid crop and preserves the reviewed version",async()=>{
    const {store,service,run}=setup();
    await expect(service.image(run.id,{version:1,cardId:"c1",operation:"crop",crop:{x:2,y:0,zoom:0}})).rejects.toThrow();expect(store.get(run.id)?.version).toBe(1);store.close();
  });
  it("generates one image and invalidates approval only after successful application",async()=>{
    const {store,service,run}=setup();
    const started=await service.image(run.id,{version:1,cardId:"c1",operation:"generate"});expect(started.imageJob?.status).toBe("running");
    await service.idle(run.id);const result=store.get(run.id)!;expect(result.imageJob?.status).toBe("succeeded");expect(result.version).toBe(2);expect(result.cards[0].image?.kind).toBe("ai");expect(result.cards[0].body).toBe(run.cards[0].body);expect(result.cards[1]).toEqual(run.cards[1]);store.close();
  });
  it("cancellation keeps old images and reserved usage despite a late success",async()=>{
    let resume!:()=>void,enter!:()=>void;
    const waiting=new Promise<void>(r=>resume=r),entered=new Promise<void>(r=>enter=r);
    const {store,service,run}=setup(async(r,_s,persist)=>{r.usage.costUsd=.1;persist(r);enter();await waiting;return {...photo,kind:"ai"};});
    await service.image(run.id,{version:1,cardId:"c1",operation:"generate"});await entered;
    expect(()=>service.edit(run.id,{version:1,cardId:"c1",title:"new",body:"new"})).toThrow(/실행/);
    service.cancelImage(run.id,{version:1});resume();await service.idle(run.id);
    const result=store.get(run.id)!;expect(result.imageJob?.status).toBe("cancelled");expect(result.version).toBe(1);expect(result.cards).toEqual(run.cards);expect(result.usage.costUsd).toBe(.1);store.close();
  });
  it("failure preserves edits and allows an explicit retry",async()=>{
    let attempts=0;const {store,service,run}=setup(async()=>{if(++attempts===1)throw new Error("연결 실패");return {...photo,kind:"ai"};});
    await service.image(run.id,{version:1,cardId:"c1",operation:"generate"});await service.idle(run.id);expect(store.get(run.id)?.imageJob?.status).toBe("failed");expect(store.get(run.id)?.version).toBe(1);
    await service.image(run.id,{version:1,cardId:"c1",operation:"generate"});await service.idle(run.id);expect(store.get(run.id)?.version).toBe(2);store.close();
  });
});
