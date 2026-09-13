import { z } from "zod";
import { body, handle, json } from "@/lib/http";
import { AppError } from "@/lib/service";
import { getPlace } from "@/lib/places";
import { storeImage } from "@/lib/images";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.object({
  data:z.string().min(4).max(12*1024*1024),
  mime:z.enum(["image/jpeg","image/png","image/webp"]),
  placeId:z.string().max(100),
  author:z.string().trim().min(1).max(100),
  license:z.literal("사용자가 이용 권한을 확인한 사진"),
}).strict();
export async function POST(request:Request) {
  return handle(async()=>{
    const input=schema.parse(await body(request,12*1024*1024));
    const place=getPlace(input.placeId);
    if (!place || place.id!==input.placeId) throw new AppError("등록된 장소를 선택하세요.");
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.data) || input.data.length%4!==0) throw new AppError("올바른 이미지 파일이 필요합니다.");
    const bytes=Buffer.from(input.data,"base64");
    if (bytes.length>8*1024*1024) throw new AppError("사진은 최대 8MB까지 업로드할 수 있습니다.",413);
    try {
      const image=await storeImage(bytes,{placeId:place.id,kind:"upload",sourceUrl:"",author:input.author,license:input.license,licenseUrl:""},request.signal);
      return json(image,201);
    } catch {
      throw new AppError("사진을 읽지 못했습니다. 8MB·2천만 픽셀 이하의 PNG, JPEG, WebP 파일을 선택하세요.");
    }
  });
}
