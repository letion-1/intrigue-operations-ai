"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, CheckCircle2, LockKeyhole, LogOut, ShieldCheck } from "lucide-react";

type Mode = "signin" | "signup";
type Stage = "loading" | "authentication" | "accepting" | "verification" | "error";
const TOKEN_RE = /^[a-f0-9]{64}$/;

export default function JoinWorkspacePage() {
  const supabase = useMemo(() => createClient(), []);
  const [token, setToken] = useState("");
  const [mode, setMode] = useState<Mode>("signin");
  const [stage, setStage] = useState<Stage>("loading");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [signedInEmail, setSignedInEmail] = useState("");
  const initialCheck = useRef("");

  const remember = useCallback(async (value: string) => {
    const response = await fetch("/api/invitations/pending", {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: value }),
    });
    if (!response.ok) throw new Error("Unable to preserve this invitation for sign-up. Please reopen the original link.");
  }, []);

  const accept = useCallback(async (value: string) => {
    setStage("accepting");
    setMessage("");
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      setSignedInEmail("");
      setStage("authentication");
      return;
    }
    setSignedInEmail(data.user.email ?? "");
    if (!data.user.email_confirmed_at) {
      setMessage("Confirm the invited email address before accepting. Check your inbox, then return to this link.");
      setStage("verification");
      return;
    }
    // Server-side secure RPC independently checks verified email, expiry, role,
    // workspace ownership and one-time invitation consumption. Never use a service key.
    const result = await supabase.rpc("accept_intrigue_team_invite_secure", { p_token: value });
    if (result.error) {
      setMessage(`Invitation not accepted: ${result.error.message}. Check that you're signed into the invited email and that the invitation is still valid.`);
      setStage("error");
      return;
    }
    // A user may belong to more than one workspace. Prefer the one just joined,
    // without changing membership permissions or trusting the browser for access.
    try {
      const workspaceId = (result.data as { workspace_id?: string } | null)?.workspace_id;
      if (typeof workspaceId === "string" && /^[0-9a-f-]{36}$/i.test(workspaceId)) {
        window.sessionStorage.setItem(`intrigue-preferred-workspace:${data.user.id}`, workspaceId);
      }
    } catch { /* Session storage may be disabled. */ }
    // Clear the handoff cookie so later dashboard visits do not loop through /join.
    try {
      const cleared = await fetch("/api/invitations/pending", { method: "DELETE", cache: "no-store" });
      if (!cleared.ok) throw new Error("Could not clear the temporary invitation session.");
    } catch {
      setMessage("Your membership was accepted, but the temporary invitation could not be cleared. Try again or contact your workspace owner.");
      setStage("error");
      return;
    }
    window.location.replace("/dashboard");
  }, [supabase]);

  useEffect(() => {
    let active = true;
    void (async () => {
      const candidate = new URLSearchParams(window.location.search).get("token")?.toLowerCase() || "";
      let resolved = candidate;
      if (!resolved) {
        try {
          const response = await fetch("/api/invitations/pending", { cache: "no-store" });
          const body: { token?: string } = await response.json();
          resolved = body.token || "";
        } catch { /* Fallback to invalid-link message. */ }
      }
      if (!active) return;
      if (!TOKEN_RE.test(resolved)) {
        setMessage("This invitation link is missing or invalid. Ask your company owner for a new invitation.");
        setStage("error");
        return;
      }
      setToken(resolved);
      try {
        await remember(resolved);
      } catch (err) {
        if (active) {
          setMessage(err instanceof Error ? err.message : "Invitation could not be saved.");
          setStage("error");
        }
        return;
      }
      if (initialCheck.current !== resolved) {
        initialCheck.current = resolved;
        void accept(resolved);
      }
    })();
    return () => { active = false; };
  }, [accept, remember]);

  const discardInvitation = async () => {
    setBusy(true);
    try {
      await fetch("/api/invitations/pending", { method: "DELETE", cache: "no-store" });
      window.location.replace("/dashboard");
    } catch {
      setMessage("Unable to exit the invitation flow. Close this tab and ask your owner for help.");
    } finally { setBusy(false); }
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!token || busy) return;
    setMessage("");
    const address = email.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(address)) { setMessage("Enter a valid email address."); return; }
    if (mode === "signup" && (password.length < 12 || password !== confirmPassword)) {
      setMessage("Use a password of at least 12 characters, and make sure both password fields match.");
      return;
    }
    setBusy(true);
    try {
      // Preserve the one-time invitation through Supabase's email verification.
      const next = `/join?token=${token}`;
      if (mode === "signup") {
        const emailRedirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
        const { data, error } = await supabase.auth.signUp({
          email: address, password,
          options: { emailRedirectTo },
        });
        if (error) throw new Error(error.message);
        setPassword(""); setConfirmPassword("");
        if (!data.session) {
          setMessage("Check your email to confirm your login. Then follow the confirmation link to finish joining your company's workspace. No new company will be created.");
          setStage("verification");
          return;
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: address, password });
        if (error) throw new Error(error.message);
        setPassword("");
      }
      await accept(token);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Unable to sign in.");
      setStage("authentication");
    } finally { setBusy(false); }
  };

  const switchAccount = async () => {
    setBusy(true);
    try {
      await supabase.auth.signOut({ scope: "local" });
      setSignedInEmail(""); setMessage(""); setPassword("");
      setStage("authentication");
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Could not sign out.");
    } finally { setBusy(false); }
  };

  return (
    <main className="flex min-h-svh items-center justify-center bg-[#0b1827] px-4 py-12 text-[#f5f0e8]">
      <div className="w-full max-w-lg rounded-3xl border border-[#866d40] bg-[#142539] p-6 shadow-2xl sm:p-9">
        <div className="mb-5 flex items-center gap-3 text-[#e8c582]"><ShieldCheck size={28}/><span className="text-xs font-bold tracking-[0.22em]">INTRIGUE STUDIOS</span></div>
        <h1 className="text-3xl font-semibold leading-tight">Join your company workspace</h1>
        <p className="mt-3 text-sm leading-6 text-[#bbc9d4]">Use the exact email your company owner invited. Your employee login joins the existing company. It does not create another company or billing account.</p>
        {(stage === "loading" || stage === "accepting") && <p className="mt-7 text-sm text-[#e8c582]" role="status">{stage === "loading" ? "Checking invitation…" : "Verifying your invitation and workspace access…"}</p>}
        {stage === "authentication" && <>
          <div className="mt-7 grid grid-cols-2 gap-2 rounded-xl bg-[#0e1d2d] p-1">
            <button type="button" onClick={() => { setMode("signin"); setMessage(""); }} className={`rounded-lg px-3 py-2 text-sm ${mode === "signin" ? "bg-[#c9a552] font-bold text-[#111b29]" : "text-[#c5d3df]"}`}>Sign in</button>
            <button type="button" onClick={() => { setMode("signup"); setMessage(""); }} className={`rounded-lg px-3 py-2 text-sm ${mode === "signup" ? "bg-[#c9a552] font-bold text-[#111b29]" : "text-[#c5d3df]"}`}>Create employee login</button>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            <label className="block text-xs text-[#e5c27e]">Invited email<input type="email" required autoComplete="email" maxLength={254} value={email} onChange={e => setEmail(e.target.value)} className="mt-2 w-full rounded-xl border border-[#4b6073] bg-[#0e2032] px-4 py-3 text-sm text-white"/></label>
            <label className="block text-xs text-[#e5c27e]">Password<input type="password" required autoComplete={mode === "signin" ? "current-password" : "new-password"} minLength={mode === "signup" ? 12 : undefined} value={password} onChange={e => setPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-[#4b6073] bg-[#0e2032] px-4 py-3 text-sm text-white"/></label>
            {mode === "signup" && <label className="block text-xs text-[#e5c27e]">Confirm password<input type="password" required autoComplete="new-password" minLength={12} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} className="mt-2 w-full rounded-xl border border-[#4b6073] bg-[#0e2032] px-4 py-3 text-sm text-white"/></label>}
            <button type="submit" disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#c9a552] px-4 py-3 text-sm font-bold text-[#111b29] disabled:opacity-50">{busy ? "Verifying…" : mode === "signin" ? "Sign in and join" : "Create login and join"}<ArrowRight size={17}/></button>
          </form>
        </>}
        {stage === "verification" && <div className="mt-6 rounded-xl border border-[#716039] bg-[#1a2a3b] p-4 text-sm text-[#e5d5af]"><CheckCircle2 className="mr-2 inline" size={18}/> Email verification is required. Open the link from your email to finish joining.</div>}
        {stage === "error" && signedInEmail && <button type="button" disabled={busy} onClick={switchAccount} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-[#9c8559] px-4 py-2 text-sm text-[#e8c582]"><LogOut size={16}/> Switch account ({signedInEmail})</button>}
        {stage === "error" && <button type="button" disabled={busy} onClick={discardInvitation} className="ml-2 mt-4 rounded-lg border border-[#526076] px-4 py-2 text-sm text-[#c4d0db]">Leave invitation</button>}
        {stage === "verification" && signedInEmail && <button type="button" disabled={busy} onClick={switchAccount} className="mt-4 rounded-lg border border-[#9c8559] px-4 py-2 text-sm text-[#e8c582]">Sign in with a different email</button>}
        {message && <p role={stage === "error" ? "alert" : "status"} className="mt-5 break-words rounded-xl border border-[#826c47] bg-[#382b22]/50 p-4 text-xs leading-6 text-[#f2d5ad]">{message}</p>}
        <p className="mt-6 flex items-center gap-2 text-xs text-[#91a5b8]"><LockKeyhole size={14}/> Invitation and membership permissions are validated by Supabase.</p>
      </div>
    </main>
  );
}
