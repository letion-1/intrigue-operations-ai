/** Pure validation helpers. Call identity, money, and timestamps must come from Vapi's GET /call/{id}. */
export const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const e164Pattern = /^\+[1-9][0-9]{7,14}$/;
const record = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string,unknown> : {};
const str = (x:unknown):string => typeof x === 'string' ? x : '';
export type OutboundEvidence = { callId:string; actualSeconds:number; costUsd:number; endedAt:string; exceededReservation:boolean };
export function allowedDestination(number:string, allowedPrefixes:string[]) {
  return e164Pattern.test(number) && allowedPrefixes.some(prefix => number.startsWith(prefix));
}
export function redactNumber(number:string){ return number.length>4 ? `••••${number.slice(-4)}` : '••••'; }
export function validateOutboundEvidence(value:unknown, expected:{callId:string;phoneId:string;assistantId:string;destination:string;reservedSeconds:number},now=Date.now()):OutboundEvidence{
  const call = record(value);
  if (!uuidPattern.test(expected.callId) || !uuidPattern.test(expected.phoneId) || !uuidPattern.test(expected.assistantId)) throw Error('Invalid expected provider identifiers.');
  if(call.id!==expected.callId || call.status!=='ended' || call.type!=='outboundPhoneCall') throw Error('The exact outbound call has not ended.');
  const phoneId=str(call.phoneNumberId)||str(record(call.phoneNumber).id);
  const assistantId=str(call.assistantId)||str(record(call.assistant).id);
  const destination=str(record(call.customer).number);
  if(phoneId!==expected.phoneId||assistantId!==expected.assistantId||destination!==expected.destination) throw Error('Provider call does not match the workspace route or recipient.');
  const started=Date.parse(str(call.startedAt)), ended=Date.parse(str(call.endedAt));
  if(!Number.isFinite(started)||!Number.isFinite(ended)||ended<=started||ended>now+60_000||started>now) throw Error('Vapi has not provided verified finished-call timestamps.');
  const seconds=Math.ceil((ended-started)/1000);
  if(seconds<1||seconds>7200)throw Error('Call duration outside approved limits.');
  if(typeof call.cost!=='number'||!Number.isFinite(call.cost)||call.cost<0||call.cost>100000) throw Error('Vapi cost is not yet verified.');
  if(!Number.isInteger(expected.reservedSeconds)||expected.reservedSeconds<60||expected.reservedSeconds>1800) throw Error('Reserved call duration invalid.');
  return {callId:expected.callId,actualSeconds:seconds,costUsd:call.cost,endedAt:new Date(ended).toISOString(),exceededReservation:seconds>expected.reservedSeconds};
}
