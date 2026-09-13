import { handle } from "@/lib/http";
import { AppError } from "@/lib/service";
import { getStoredImage, readImage } from "@/lib/images";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}) {
  return handle(async()=>{
    const {id}=await params;
    try {
      const image=await getStoredImage(id);
      const data=await readImage(image);
      return new Response(new Uint8Array(data),{headers:{"content-type":image.mime,"content-length":String(data.length),"x-content-type-options":"nosniff","cache-control":"private, max-age=31536000, immutable","content-disposition":"inline"}});
    } catch {
      throw new AppError("이미지 파일을 찾거나 검증하지 못했습니다. 사진을 다시 선택하세요.",404);
    }
  });
}
