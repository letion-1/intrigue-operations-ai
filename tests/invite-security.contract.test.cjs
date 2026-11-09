"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname,"..");
const read = f => fs.readFileSync(path.join(root,f),"utf8");

test("Join flow uses only the independent guarded acceptance RPC", () => {
  const dash = read("app/dashboard/page.tsx");
  const join = read("app/join/page.tsx");
  assert.match(dash,/rpc\("accept_intrigue_team_invite_secure"/);
  assert.match(join,/rpc\("accept_intrigue_team_invite_secure"/);
  assert.doesNotMatch(dash,/rpc\("accept_intrigue_team_invite"/);
});
test("Team uses new owner-only invite, listing and revocation RPCs", () => {
  const dash = read("app/dashboard/page.tsx");
  for(const f of ["create_intrigue_secure_team_invite","list_intrigue_secure_team_invites","revoke_intrigue_secure_team_invite"]) {
    assert.match(dash,new RegExp(`rpc\\("${f}"`));
  }
  assert.doesNotMatch(dash,/from\("workspace_invitations"\)/);
});
test("DB migration implements independent one-time verified invite acceptance", () => {
  const sql = read("sql/INTRIGUE_INVITE_GATE_COMPLETE.sql");
  for(const expected of [
    "CREATE TABLE public.intrigue_secure_team_invitations",
    "token_hash text NOT NULL UNIQUE", "email_confirmed_at", "invited_email",
    "expires_at<=now()", "v_inv.status<>'pending'", "FOR UPDATE",
    "INSERT INTO public.workspace_memberships", "SET status='accepted'",
    "CREATE OR REPLACE FUNCTION public.create_intrigue_secure_team_invite",
    "CREATE OR REPLACE FUNCTION public.list_intrigue_secure_team_invites",
    "CREATE OR REPLACE FUNCTION public.revoke_intrigue_secure_team_invite",
    "REVOKE INSERT ON TABLE public.workspace_memberships", "AS RESTRICTIVE FOR INSERT",
    "REVOKE INSERT ON TABLE public.workspaces", "CREATE OR REPLACE FUNCTION public.accept_intrigue_team_invite_secure"
  ]) assert.ok(sql.includes(expected), `Missing DB protection: ${expected}`);
  assert.doesNotMatch(sql,/PERFORM public.accept_intrigue_team_invite\(/);
});
test("Uninvited account cannot self-provision company", () => {
 const dash=read("app/dashboard/page.tsx");
 const sql=read("sql/INTRIGUE_INVITE_GATE_COMPLETE.sql");
 assert.doesNotMatch(dash,/rpc\("create_intrigue_company"/);
 assert.match(dash,/No company workspace assigned/);
 assert.match(sql,/p.proname='create_intrigue_company'/);
});
