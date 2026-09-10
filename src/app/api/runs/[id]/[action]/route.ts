import { getService } from "@/lib/server";
import { body, handle } from "@/lib/http";
import { AppError } from "@/lib/service";
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
    if (action === "cancel") return service.cancel(id);
    if (action === "approve") return service.approve(id, input);
    if (action === "edit") return service.edit(id, input);
    if (action === "retry") return service.retry(id, input);
    throw new AppError("지원하지 않는 작업입니다.", 404);
  });
}
