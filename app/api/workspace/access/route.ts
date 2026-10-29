import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const reply = (body: object, status: number) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store, private" } });

// V14.4: An authoritative server-side permission check, not a UI-only "403" message.
// No user/workspace IDs are accepted from the request. Supabase RLS applies.
export async function GET() {
  const supabase = await createClient();
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) return reply({ access: "signed_out" }, 401);

  const { data: memberships, error: membershipError } = await supabase
    .from("workspace_memberships")
    .select("workspace_id,role")
    .eq("user_id", auth.user.id)
    .limit(1);
  if (membershipError) return reply({ error: "Unable to verify membership" }, 503);

  const membership = memberships?.[0];
  if (membership) {
    return reply({ access: "active", role: membership.role }, 200);
  }

  // Legacy owner membership fallback. Prevents a false 403 for older accounts.
  const { data: owned, error: workspaceError } = await supabase
    .from("workspaces")
    .select("id")
    .eq("owner_id", auth.user.id)
    .limit(1);
  if (workspaceError) return reply({ error: "Unable to verify workspace" }, 503);
  if (owned && owned.length > 0) return reply({ access: "active", role: "owner" }, 200);

  const { data: notice, error: noticeError } = await supabase.rpc("get_intrigue_access_notice");
  if (noticeError) return reply({ error: "Unable to verify previous access" }, 503);
  if (notice && typeof notice === "object" && notice.revoked === true) {
    return reply({ access: "removed", company: notice.company_name ?? "former company" }, 403);
  }
  return reply({ access: "onboarding" }, 200);
}
