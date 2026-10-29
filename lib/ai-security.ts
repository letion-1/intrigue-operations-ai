import { NextResponse } from "next/server";

// Guard cookie-authenticated mutations against requests initiated by other websites.
// Browsers send Origin on POST/DELETE. Non-browser requests must not rely on
// cookies as an authentication mechanism.
export function crossOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return request.headers.get("sec-fetch-site") === "cross-site";
  try { return new URL(origin).origin !== new URL(request.url).origin; }
  catch { return true; }
}

export function quotaErrorResponse(error: { message: string }): NextResponse {
  if (error.message.includes("INTRIGUE_MINUTE_QUOTA")) {
    return NextResponse.json({ error: "AI request limit: 6 chats or 2 indexing requests per minute. Try again shortly." }, {
      status: 429, headers: { "Retry-After": "60", "Cache-Control": "no-store" },
    });
  }
  if (error.message.includes("INTRIGUE_DAILY_QUOTA")) {
    return NextResponse.json({ error: "Today's AI allowance has been used. Please try again after midnight UTC." }, {
      status: 429, headers: { "Cache-Control": "no-store" },
    });
  }
  // Fail closed: a missing SQL migration must never silently disable usage limits.
  return NextResponse.json({ error: "AI usage protection is unavailable. Apply the V13.9 Supabase SQL migration or contact support." }, {
    status: 503, headers: { "Cache-Control": "no-store" },
  });
}
