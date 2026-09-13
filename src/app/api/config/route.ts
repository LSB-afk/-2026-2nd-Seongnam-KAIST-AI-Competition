import { getLiveConfig } from "@/lib/provider";
import { DEFAULT_BRIEF } from "@/lib/run";
import { json } from "@/lib/http";
import { getImageConfig } from "@/lib/image-provider";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export function GET() {
  const config = getLiveConfig();
  return json({
    live: {
      configured: config.configured,
      reason: config.reason,
      model: config.model,
    },
    defaults: DEFAULT_BRIEF,
    image: getImageConfig(),
  });
}
