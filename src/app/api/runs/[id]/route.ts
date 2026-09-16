import { getService } from "@/lib/server";
import { handle } from "@/lib/http";
import { AppError } from "@/lib/service";
import { publicRun } from "@/lib/public-run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return handle(async () => {
    const { id } = await params;
    const run = getService().store.get(id);
    if (!run) throw new AppError("제작 기록을 찾을 수 없습니다.", 404);
    return publicRun(run);
  });
}
