import { getService } from "@/lib/server";
import { body, handle } from "@/lib/http";
import { publicRun } from "@/lib/public-run";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(() => getService().store.list().map(publicRun));
}
export async function POST(request: Request) {
  return handle(async () => publicRun(getService().create(await body(request))));
}
