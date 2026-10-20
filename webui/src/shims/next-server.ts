// Minimal stand-in for next/server's NextResponse.
export class NextResponse {
  static json(data: unknown, init?: ResponseInit): Response {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
    return new Response(JSON.stringify(data), { ...init, headers });
  }
}
