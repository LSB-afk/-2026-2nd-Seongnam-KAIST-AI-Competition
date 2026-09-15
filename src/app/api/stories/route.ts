import { body, handle } from "@/lib/http";
import { getService } from "@/lib/server";
import { getSharedCityStoryStore, sharedStoryRequestSchema } from "@/lib/shared-city-story";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return handle(async () => {
    const { runId, version } = sharedStoryRequestSchema.parse(await body(request));
    const run = getService().store.get(runId);
    return getSharedCityStoryStore().publish(run, version);
  });
}
