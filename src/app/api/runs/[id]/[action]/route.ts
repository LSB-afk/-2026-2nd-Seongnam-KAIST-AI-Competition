import { getService } from "@/lib/server";
import { body, handle } from "@/lib/http";
import { AppError } from "@/lib/service";
import { publicRun } from "@/lib/public-run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; action: string }> },
) {
  return handle(async () => {
    const { id, action } = await params;
    const input = await body(request);
    const service = getService();
    if (action === "cancel") return publicRun(await service.cancel(id));
    if (action === "approve") return publicRun(await service.approve(id, input));
    if (action === "edit") return publicRun(service.edit(id, input));
    if (action === "retry") return publicRun(service.retry(id, input));
    if (action === "simplify") return publicRun(service.simplify(id, input));
    if (action === "image") return publicRun(await service.image(id, input));
    if (action === "image-cancel") return publicRun(service.cancelImage(id, input));
    throw new AppError("지원하지 않는 작업입니다.", 404);
  });
}
