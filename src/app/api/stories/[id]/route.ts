import { handle } from "@/lib/http";
import { AppError } from "@/lib/service";
import { getSharedCityStoryStore, sharedStoryIdSchema } from "@/lib/shared-city-story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  return handle(async () => {
    const id = sharedStoryIdSchema.parse((await params).id);
    const story = getSharedCityStoryStore().get(id);
    if (!story) throw new AppError("공유된 이야기를 찾을 수 없습니다.", 404);
    return story;
  });
}
