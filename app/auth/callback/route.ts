import { createClient } from "@/lib/supabase/server";
import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/dashboard";

  const safeNext =
    next.startsWith("/") &&
    !next.startsWith("//") &&
    !next.includes("\\")
      ? next
      : "/dashboard";

  if (!code) {
    return NextResponse.redirect(
      new URL("/auth/error?error=Missing+recovery+code", url.origin)
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(
      new URL("/auth/error?error=Recovery+link+invalid+or+expired", url.origin)
    );
  }

  return NextResponse.redirect(new URL(safeNext, url.origin));
}