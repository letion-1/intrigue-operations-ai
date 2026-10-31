/* Normalizes untrusted Vapi call payloads. Never export credentials/recording URLs. */
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown) => typeof v === 'string' ? v : '';
const clip = (v: unknown, max: number) => str(v).slice(0,max);
const validDate = (v: unknown) => {
  const s = str(v);
  return s && Number.isFinite(Date.parse(s)) ? new Date(s).toISOString() : null;
};
export function callRow(raw: unknown, includeTranscript = false) {
  const c = obj(raw);
  const artifact = obj(c.artifact);
  const customer = obj(c.customer);
  const type = str(c.type);
  const direction = type === 'inboundPhoneCall' ? 'inbound' : type === 'outboundPhoneCall' ? 'outbound' : type === 'webCall' ? 'web' : 'unknown';
  const start = validDate(c.startedAt) || validDate(c.createdAt);
  const end = validDate(c.endedAt);
  const elapsed = start && end ? Math.max(0,Math.floor((Date.parse(end)-Date.parse(start))/1000)) : null;
  const status = str(c.status);
  const call_status = status === 'ended' ? 'ended' : status === 'in-progress' ? 'in_progress' : ['queued','ringing','failed'].includes(status) ? status : 'unknown';
  const analysis = obj(c.analysis);
  const summary = clip(analysis.summary,4000) || clip(obj(artifact.analysis).summary,4000) || null;
  const transcript = includeTranscript ? clip(artifact.transcript,50000) || clip(c.transcript,50000) || null : null;
  return {
    provider_call_id: clip(c.id,160),
    assistant_id: clip(c.assistantId,80),
    direction, call_status, outcome: 'unreviewed',
    caller_number: clip(customer.number,50) || clip(obj(c.phoneCall).number,50) || null,
    called_number: clip(obj(c.phoneNumber).number,50) || null,
    started_at: start, ended_at: end,
    duration_seconds: elapsed,
    ended_reason: clip(c.endedReason,160) || null,
    summary, transcript,
    recording_available: Boolean(artifact.recordingUrl || artifact.stereoRecordingUrl || artifact.recording),
    recording_consent_verified: false,
  };
}
