import { ZodError } from "zod";
import { AppError } from "./service";
export function json(value: unknown, status = 200): Response {
  return Response.json(value, {
    status,
    headers: { "cache-control": "no-store" },
  });
}
export async function handle(
  fn: () => unknown | Promise<unknown>,
): Promise<Response> {
  try {
    const value = await fn();
    return value instanceof Response ? value : json(value);
  } catch (error) {
    if (error instanceof ZodError)
      return json(
        {
          error: "입력값을 확인하세요.",
          details: error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        },
        400,
      );
    if (error instanceof AppError)
      return json({ error: error.message }, error.status);
    if (error instanceof SyntaxError)
      return json({ error: "올바른 JSON 요청이 필요합니다." }, 400);
    console.error(
      "[timestory]",
      error instanceof Error ? error.message : "Unexpected server error",
    );
    return json(
      {
        error:
          "요청을 처리하지 못했습니다. 서버 기록과 현재 상태를 확인하세요.",
      },
      500,
    );
  }
}
export async function body(request: Request, maxBytes = 16384): Promise<unknown> {
  const origin = request.headers.get("origin");
  // Next's internal Request URL normalizes 127.0.0.1 to localhost; compare the
  // browser's Origin with the original Host, restricted to the local app.
  if (origin) {
    let supplied: URL;
    try {
      supplied = new URL(origin);
    } catch {
      throw new AppError(
        "다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.",
        403,
      );
    }
    const host = request.headers.get("host") ?? new URL(request.url).host;
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(supplied.hostname) ||
      supplied.host !== host ||
      supplied.protocol !== new URL(request.url).protocol
    )
      throw new AppError(
        "다른 사이트에서 보낸 변경 요청은 허용하지 않습니다.",
        403,
      );
  }
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new AppError("요청 본문이 너무 큽니다.", 413);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new AppError("JSON 요청이 필요합니다.", 415);
  const reader = request.body?.getReader();
  if (!reader) return {};
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maxBytes) throw new AppError("요청 본문이 너무 큽니다.", 413);
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
  } catch {
    throw new AppError("UTF-8로 인코딩된 JSON 요청이 필요합니다.", 400);
  }
  return text ? JSON.parse(text) : {};
}
