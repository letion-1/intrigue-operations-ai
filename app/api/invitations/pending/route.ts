import { NextRequest, NextResponse } from "next/server";

// Temporary handoff between email verification and joining an existing company.
// This cookie conveys intent only. Supabase's accept_intrigue_team_invite RPC
// remains the security boundary for verified email, expiry, role and workspace.
const COOKIE = "intrigue_pending_invite";
const TOKEN = /^[0-9a-f]{64}$/;
const headers = { "Cache-Control": "no-store, private" };
const cookieOptions = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/", maxAge: 60 * 60 * 2 };

export async function GET(request: NextRequest) {
  const token = request.cookies.get(COOKIE)?.value ?? "";
  return NextResponse.json({ token: TOKEN.test(token) ? token : null }, { headers });
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers });
  }
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== "string" || !TOKEN.test(body.token)) {
    return NextResponse.json({ error: "Invalid invitation token" }, { status: 400, headers });
  }
  const response = NextResponse.json({ saved: true }, { headers });
  response.cookies.set(COOKIE, body.token, cookieOptions);
  return response;
}

export async function DELETE(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403, headers });
  }
  const response = NextResponse.json({ cleared: true }, { headers });
  response.cookies.set(COOKIE, "", { ...cookieOptions, maxAge: 0 });
  return response;
}
