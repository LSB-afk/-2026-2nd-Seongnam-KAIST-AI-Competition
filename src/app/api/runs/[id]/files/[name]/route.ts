import { getService } from "@/lib/server";
import { handle } from "@/lib/http";
import { downloadCurrentArtifact } from "@/lib/artifacts";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; name: string }> },
) {
  return handle(async () => {
    const { id, name } = await params;
    const store = getService().store;
    const data = await downloadCurrentArtifact(id, name, (id) => store.get(id));
    const inline = name.endsWith(".png");
    return new Response(new Uint8Array(data), {
      headers: {
        "content-type": inline
          ? "image/png"
          : name.endsWith(".zip")
            ? "application/zip"
            : name.endsWith(".json")
              ? "application/json; charset=utf-8"
              : "text/markdown; charset=utf-8",
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${name}"`,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      },
    });
  });
}
