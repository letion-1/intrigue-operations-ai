import type { NextRequest } from 'next/server';
import { identity, admin, checkOrigin, LifecycleError, safeResponseError } from '@/lib/intrigue-account-lifecycle/server';

export { LifecycleError, safeResponseError, checkOrigin };

export async function platformAuth(req: NextRequest) {
  const auth = await identity(req);
  return { ...auth, service: admin(auth.url, auth.serviceKey) };
}

export async function mustBeOperator(ctx: Awaited<ReturnType<typeof platformAuth>>) {
  const { data, error } = await ctx.service.rpc('intrigue_platform_is_operator', {p_actor: ctx.user.id});
  if (error) throw new LifecycleError(503, 'Platform access check unavailable. Contact INTRIGUE Support.');
  if (data !== true) throw new LifecycleError(403, 'Private platform access required.');
  // A platform account MUST be distinct from all client accounts, including
  // workspace Owners, Admins, Staff and Viewers. Fail closed on DB errors.
  const [member, owner] = await Promise.all([
    ctx.service.from('workspace_memberships').select('user_id',{count:'exact',head:true}).eq('user_id',ctx.user.id),
    ctx.service.from('workspaces').select('id',{count:'exact',head:true}).eq('owner_id',ctx.user.id)
  ]);
  if(member.error || owner.error) throw new LifecycleError(503,'Private platform authorization unavailable.');
  if((member.count??0)>0 || (owner.count??0)>0)
    throw new LifecycleError(403,'A company login cannot access private administration.');
}

export function uuid(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function stringValue(value: unknown, max: number): string {
  if (typeof value !== 'string') throw new LifecycleError(400, 'Invalid text input.');
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) throw new LifecycleError(400, `Text must contain 1 to ${max} characters.`);
  return trimmed;
}

export function json(value: unknown, status = 200) {
  return Response.json(value, {status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}

export function apiError(err: unknown) {
  const issue = safeResponseError(err);
  return json({ error: issue.message }, issue.status);
}
