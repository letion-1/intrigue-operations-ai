/**
 * Provider evidence validation for operator-approved settlement.
 * Pure, deliberately strict: all mismatches fail closed without changing usage.
 */
export type ProviderCallSummary = {
  callId: string;
  phoneNumberId: string;
  assistantId: string;
  actualSeconds: number;
  costUsd: number;
  endedAt: string;
  exceededReservation: boolean;
};

type Dict = Record<string, unknown>;
const obj = (value: unknown): Dict => value && typeof value === 'object' && !Array.isArray(value) ? value as Dict : {};
const string = (value: unknown) => typeof value === 'string' ? value : '';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateCompletedVapiCall(raw: unknown, expected: {
  callId: string;
  phoneNumberId: string;
  assistantId: string;
  reservedSeconds: number;
}, nowMs = Date.now()): ProviderCallSummary {
  const call = obj(raw);
  if (!uuid.test(expected.callId) || !uuid.test(expected.phoneNumberId) || !uuid.test(expected.assistantId)) {
    throw new Error('Invalid expected call routing identifiers.');
  }
  if (call.id !== expected.callId || call.status !== 'ended' || call.type !== 'inboundPhoneCall') {
    throw new Error('Vapi has not confirmed this exact inbound call ended.');
  }
  const sourcePhone = string(call.phoneNumberId) || string(obj(call.phoneNumber).id);
  const sourceAssistant = string(call.assistantId) || string(obj(call.assistant).id);
  if (sourcePhone !== expected.phoneNumberId || sourceAssistant !== expected.assistantId) {
    throw new Error('Vapi call does not match the workspace phone and saved assistant.');
  }
  const began = Date.parse(string(call.startedAt)), ended = Date.parse(string(call.endedAt));
  if (!Number.isFinite(began) || !Number.isFinite(ended) || ended <= began || ended > nowMs + 60_000 || began > nowMs) {
    throw new Error('Vapi has not supplied valid completed-call timestamps.');
  }
  const seconds = Math.ceil((ended - began) / 1000);
  if (seconds < 1 || seconds > 7200) {
    throw new Error('Call duration is outside reconciliation safety limits.');
  }
  // Do not treat a missing cost as zero: that would hide unreported provider charges.
  if (typeof call.cost !== 'number' || !Number.isFinite(call.cost) || call.cost < 0 || call.cost > 100000) {
    throw new Error('Vapi has not supplied a trustworthy finalized call cost.');
  }
  if (!Number.isInteger(expected.reservedSeconds) || expected.reservedSeconds < 60 || expected.reservedSeconds > 1800) {
    throw new Error('The original reservation duration is invalid.');
  }
  return {
    callId: expected.callId,
    phoneNumberId: expected.phoneNumberId,
    assistantId: expected.assistantId,
    actualSeconds: seconds,
    costUsd: call.cost,
    endedAt: new Date(ended).toISOString(),
    exceededReservation: seconds > expected.reservedSeconds,
  };
}
