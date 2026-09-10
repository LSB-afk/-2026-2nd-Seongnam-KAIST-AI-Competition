import { getService } from "@/lib/server";
import { body, handle } from "@/lib/http";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  return handle(() => getService().store.list());
}
export async function POST(request: Request) {
  return handle(async () => getService().create(await body(request)));
}
