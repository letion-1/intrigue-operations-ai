import type { NextRequest } from 'next/server';
import { platformAuth, mustBeOperator, checkOrigin, uuid, json, apiError, LifecycleError } from '@/lib/intrigue-platform';
import { voiceAccountKey } from '@/lib/intrigue-ai/voice-gate';
import { validateCompletedVapiCall } from '@/lib/intrigue-ai/vapi-reconcile-validation';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
type Mode = 'managed' | 'byok';

/**
 * Private operator workflow. Inspect is read-only. Settle requires explicit
 * operator confirmation, a server-side provider GET and a matching reservation.
 * No caller phone, transcript, recording or calendar tokens are returned.
 */
export async function POST(req: NextRequest) {
  try {
    checkOrigin(req);
    const ctx = await platformAuth(req);
    await mustBeOperator(ctx);
    const b = obj(await req.json().catch(() => null));
    const action = b.action;
    if (action !== 'inspect' && action !== 'settle') throw new LifecycleError(400, 'Choose inspect or settle.');
    if (!uuid(b.workspace_id) || !uuid(b.phone_number_id) || !uuid(b.call_id)) {
      throw new LifecycleError(400, 'Valid workspace, phone and Vapi call IDs are required.');
    }
    const workspace = String(b.workspace_id), phone = String(b.phone_number_id), callId = String(b.call_id);
    const requestKey = `vapi:${callId}`;
    const [{ data: route, error: routeError }, { data: ledger, error: ledgerError }] = await Promise.all([
      ctx.service.from('intrigue_ai_voice_routes')
        .select('workspace_id,phone_number_id,assistant_id,provider_mode,reservation_seconds')
        .eq('workspace_id', workspace).eq('phone_number_id', phone).maybeSingle(),
      ctx.service.from('intrigue_ai_usage_ledger')
        .select('workspace_id,request_key,kind,provider,payer,status,reserved_seconds,actual_seconds,actual_usd')
        .eq('workspace_id', workspace).eq('request_key', requestKey).maybeSingle(),
    ]);
    if (routeError || ledgerError) throw new LifecycleError(503, 'Voice records unavailable.');
    if (!route || !ledger || ledger.kind !== 'voice' || ledger.provider !== 'vapi' ||
        (route.provider_mode !== 'managed' && route.provider_mode !== 'byok') ||
        ledger.payer !== route.provider_mode) {
      throw new LifecycleError(404, 'No matching admitted Vapi reservation in this workspace.');
    }
    if (ledger.status === 'settled') return json({
      status: 'settled', alreadySettled: true, callId,
      actualSeconds: ledger.actual_seconds, costUsd: ledger.actual_usd,
    });
    if (ledger.status !== 'reserved' || Number(ledger.reserved_seconds) !== Number(route.reservation_seconds)) {
      throw new LifecycleError(409, 'Reservation state or duration changed. Investigate before settlement.');
    }
    const key = await voiceAccountKey(ctx.service, workspace, route.provider_mode as Mode);
    // Fetch one immutable provider call ID; never log or return its transcripts or caller data.
    const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(callId)}`, {
      headers: { Authorization: `Bearer ${key}` },
      cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new LifecycleError(502, 'Vapi did not verify this call in the selected provider account.');
    const payload: unknown = await response.json().catch(() => null);
    let evidence: ReturnType<typeof validateCompletedVapiCall>;
    try {
      evidence = validateCompletedVapiCall(payload, {
        callId, phoneNumberId: phone, assistantId: String(route.assistant_id),
        reservedSeconds: Number(route.reservation_seconds),
      });
    } catch (e) {
      throw new LifecycleError(409, e instanceof Error ? e.message : 'Provider evidence invalid.');
    }
    if (action === 'inspect') return json({ status: 'ready_for_review', ...evidence });
    if (process.env.INTRIGUE_VOICE_OPERATOR_RECONCILE_ENABLED !== 'true') {
      throw new LifecycleError(403, 'Operator settlement is disabled. Inspect first, then enable the guarded action.');
    }
    if (b.confirm_call_id !== callId) throw new LifecycleError(400, 'Confirm the full call ID to settle.');
    if (evidence.exceededReservation) {
      throw new LifecycleError(409, 'Call exceeded its reserved maximum. Investigate the provider duration before settling.');
    }
    const { error: settleError } = await ctx.service.rpc('intrigue_ai_settle', {
      p_workspace: workspace, p_request_key: requestKey,
      p_actual_usd: evidence.costUsd, p_actual_seconds: evidence.actualSeconds,
      p_input_tokens: null, p_output_tokens: null, p_provider_ref: callId,
    });
    if (settleError) {
      // Concurrent end-of-call report may have settled first. Do not overwrite it.
      const { data: after } = await ctx.service.from('intrigue_ai_usage_ledger')
        .select('status,actual_seconds,actual_usd').eq('workspace_id', workspace)
        .eq('request_key', requestKey).maybeSingle();
      if (after?.status === 'settled') {
        return json({ status: 'settled', alreadySettled: true, callId,
          actualSeconds: after.actual_seconds, costUsd: after.actual_usd });
      }
      throw new LifecycleError(503, 'Provider evidence was verified, but database settlement failed. No manual adjustment was made.');
    }
    return json({ status: 'settled', callId, actualSeconds: evidence.actualSeconds, costUsd: evidence.costUsd });
  } catch (error) {
    return apiError(error);
  }
}
