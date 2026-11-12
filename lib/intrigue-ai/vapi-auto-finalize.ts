import 'server-only';
import { voiceAccountKey, voiceService } from '@/lib/intrigue-ai/voice-gate';
import { validateCompletedVapiCall } from '@/lib/intrigue-ai/vapi-reconcile-validation';

type Obj = Record<string, unknown>;
const obj = (x: unknown): Obj => x !== null && typeof x === 'object' && !Array.isArray(x) ? x as Obj : {};
const str = (x: unknown): string => typeof x === 'string' ? x : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export type FinishResult = 'settled' | 'already_settled' | 'legacy' | 'skipped' | 'review_required';

/** A validated assistant webhook is a signal, never authority for actual provider cost.
 * All changes are restricted to an existing, workspace-bound inbound reservation.
 * Failures leave the reservation intact for operator review.
 */
export async function finalizeAdmittedVapiCall(input: {
  authorization: unknown; callId: string; assistantId: string;
}): Promise<FinishResult> {
  const auth = obj(input.authorization);
  const workspace = str(auth.workspace_id) || str(auth.tenant_id);
  if (process.env.INTRIGUE_AI_VOICE_POSTCALL_METERING_ENABLED !== 'true') return 'skipped';
  if (auth.authorized !== true || !uuid.test(workspace) || !uuid.test(input.callId) || !uuid.test(input.assistantId)) return 'skipped';
  try {
    const db = voiceService();
    const requestKey = `vapi:${input.callId}`;
    const { data: ledger, error: ledgerErr } = await db.from('intrigue_ai_usage_ledger')
      .select('kind,provider,payer,status,reserved_seconds')
      .eq('workspace_id',workspace).eq('request_key',requestKey).maybeSingle();
    if (ledgerErr) return 'review_required';
    if (!ledger) return 'legacy';
    if (ledger.status === 'settled') return 'already_settled';
    if (ledger.status !== 'reserved' || ledger.kind !== 'voice' || ledger.provider !== 'vapi' ||
        (ledger.payer !== 'managed' && ledger.payer !== 'byok')) return 'review_required';

    // Account credentials are selected only from the authenticated workspace.
    const key = await voiceAccountKey(db, workspace, ledger.payer);
    const response = await fetch(`https://api.vapi.ai/call/${encodeURIComponent(input.callId)}`, {
      headers: { Authorization: `Bearer ${key}` }, cache: 'no-store', signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return 'review_required';
    const call: unknown = await response.json().catch(() => null);
    const provider = obj(call);
    const phoneId = str(provider.phoneNumberId) || str(obj(provider.phoneNumber).id);
    if (!uuid.test(phoneId)) return 'review_required';
    const {data: route, error: routeErr} = await db.from('intrigue_ai_voice_routes')
      .select('workspace_id,phone_number_id,assistant_id,provider_mode,reservation_seconds')
      .eq('workspace_id', workspace).eq('phone_number_id', phoneId)
      .eq('assistant_id', input.assistantId).eq('provider_mode', ledger.payer).maybeSingle();
    if (routeErr || !route || Number(route.reservation_seconds) !== Number(ledger.reserved_seconds)) return 'review_required';
    let evidence: ReturnType<typeof validateCompletedVapiCall>;
    try {
      evidence = validateCompletedVapiCall(call, {
        callId: input.callId, phoneNumberId: phoneId, assistantId: input.assistantId,
        reservedSeconds: Number(ledger.reserved_seconds),
      });
    } catch { return 'review_required'; }
    if (evidence.exceededReservation) return 'review_required';
    const {error} = await db.rpc('intrigue_ai_settle', {
      p_workspace: workspace, p_request_key: requestKey,
      p_actual_usd: evidence.costUsd, p_actual_seconds: evidence.actualSeconds,
      p_input_tokens: null, p_output_tokens: null, p_provider_ref: input.callId,
    });
    if (!error) return 'settled';
    // Concurrent webhook or operator reconciliation may have settled first.
    const {data: after} = await db.from('intrigue_ai_usage_ledger')
      .select('status').eq('workspace_id',workspace).eq('request_key', requestKey).maybeSingle();
    return after?.status === 'settled' ? 'already_settled' : 'review_required';
  } catch {
    return 'review_required';
  }
}
