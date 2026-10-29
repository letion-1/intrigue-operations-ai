import { redirect } from "next/navigation";

// The old Supabase Starter /protected page exposed an unbranded demo and
// only checked login, not INTRIGUE workspace membership. All account types
// now go through the workspace-aware dashboard access flow.
export default function LegacyProtectedPage() {
  redirect("/dashboard");
}
