/** Extract only a configured, non-sensitive post-call summary from a Vapi call.
 * Vapi legacy: call.analysis.summary; modern: call.artifact.structuredOutputs[outputId].
 * We do not parse transcripts, fetch recordings, or infer an outcome from tool names.
 */
type RecordValue = Record<string, unknown>;
const asObj = (v: unknown): RecordValue =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as RecordValue : {};
const short = (v: unknown, max = 4000): string =>
  typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '';

const allowedNames = new Set(['intrigue call summary', 'call summary']);

function formatResult(input: unknown): string | null {
  const plain = short(input);
  if (plain) return plain;
  const fields = asObj(input);
  const summary = short(fields.summary, 2800);
  if (!summary) return null;
  const request = short(fields.customerRequest, 300);
  const outcome = short(fields.outcome, 400);
  const followUp = typeof fields.followUpRequired === 'boolean'
    ? `Follow-up required: ${fields.followUpRequired ? 'Yes' : 'No'}.`
    : '';
  // Only show fields Vapi actually returned. This is not verified fact.
  return [summary,
    request ? `Customer request: ${request}.` : '',
    outcome ? `Outcome: ${outcome}.` : '',
    followUp,
  ].filter(Boolean).join(' ').slice(0, 4000);
}

export function extractVapiSummary(raw: unknown): string | null {
  const call = asObj(raw);
  const artifact = asObj(call.artifact);
  const legacy = short(asObj(call.analysis).summary) || short(asObj(artifact.analysis).summary);
  if (legacy) return legacy;

  const outputs = artifact.structuredOutputs;
  const entries = Array.isArray(outputs) ? outputs : Object.values(asObj(outputs));
  for (const value of entries.slice(0, 50)) {
    const entry = asObj(value);
    const name = short(entry.name, 100).toLowerCase();
    if (!allowedNames.has(name)) continue;
    const summary = formatResult(entry.result);
    if (summary) return summary;
  }
  return null;
}
