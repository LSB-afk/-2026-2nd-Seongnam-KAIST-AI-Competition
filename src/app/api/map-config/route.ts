import { getMapConfig } from "@/lib/map-config";

export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(getMapConfig(), { headers: { "Cache-Control": "no-store" } });
}
