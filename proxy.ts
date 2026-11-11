import { NextResponse } from "next/server";
import { updateSession } from "@/lib/supabase/proxy";
import { type NextRequest } from "next/server";

export async function proxy(request: NextRequest) {
  // Vapi authenticates using its own Bearer token.
  // Do not redirect machine-to-machine webhooks to Supabase login.
  if (request.nextUrl.pathname === "/api/integrations/vapi/webhook") {
    return NextResponse.next();
  }
  // Internal worker gateway: authentication happens inside
// the API route using the private worker token.
if (
  request.nextUrl.pathname === "/api/ai-runtime/chat" &&
  request.method === "POST"
) {
  return NextResponse.next();
}

  // Verified Vapi phone gate authenticates its own per-number bearer token.
  if (request.nextUrl.pathname === "/api/integrations/vapi/call-gate" &&
      request.method === "POST") {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - images - .svg, .png, .jpg, .jpeg, .gif, .webp
     * Feel free to modify this pattern to include more paths.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
