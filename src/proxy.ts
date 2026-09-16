import type { NextRequest } from "next/server";

// Next's router throws while decoding dynamic params from a malformed path and answers 500.
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  try {
    decodeURIComponent(pathname);
  } catch {
    const message = "주소 형식이 올바르지 않습니다.";
    const headers = { "cache-control": "no-store" };
    return pathname.startsWith("/api/")
      ? Response.json({ error: message }, { status: 400, headers })
      : new Response(message, { status: 400, headers });
  }
}

export const config = {
  // Only percent-encoded paths can fail to decode. Other requests, such as image uploads,
  // skip the proxy and the 10MB body cap Next applies to proxied requests.
  matcher: ["/api/(.*%.*)", "/stories/(.*%.*)"],
};
