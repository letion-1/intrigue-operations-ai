import { handleCalendlyVoiceTool } from "@/lib/intrigue-vapi-calendly";
import { handleGoogleTool } from "@/lib/intrigue-vapi-google";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

// No Supabase service-role key or Vapi API key is used by this webhook.
// Every event is authenticated inside a narrowly scoped database RPC.
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store" },
});
type Obj = Record<string, unknown>;
const asObj = (v: unknown): Obj => v && typeof v === "object" && !Array.isArray(v) ? v as Obj : {};
const asStr = (v: unknown): string => typeof v === "string" ? v : "";

export async function POST(request: NextRequest) {
  const header = request.headers.get("authorization") || "";
  const match = /^Bearer ([a-f0-9]{64})$/.exec(header);
  if (!match) return json({ error: "Webhook authorization required" }, 401);
  if (Number(request.headers.get("content-length") || 0) > 1_000_000) return json({ error: "Payload too large" }, 413);

  let payload: unknown;
  try {
    const raw = await request.text();
    if (raw.length > 1_000_000) return json({ error: "Payload too large" }, 413);
    payload = JSON.parse(raw);
  } catch { return json({ error: "Invalid JSON" }, 400); }

  const message = asObj(asObj(payload).message);
  const eventType = asStr(message.type);
  const call = asObj(message.call);
  const assistant = asObj(message.assistant);
  const assistantId = asStr(call.assistantId) || asStr(message.assistantId) || asStr(assistant.id);
  if (!uuid.test(assistantId)) return json({ error: "Saved assistant ID missing" }, 400);
  if (!['tool-calls', 'end-of-call-report'].includes(eventType)) {
    // Informational events have no side effects; omit transcript/recording entirely.
    return json({ received: true, ignored: true });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return json({ error: "Webhook not configured" }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const callId = asStr(call.id);
  const { data, error } = await supabase.rpc("intrigue_vapi_inbound", {
    p_token: match[1], p_assistant_id: assistantId,
    p_kind: eventType === 'tool-calls' ? 'tool' : 'end-of-call-report',
    p_call_id: eventType === 'end-of-call-report' ? callId : null,
    p_ended_reason: eventType === 'end-of-call-report' ? asStr(message.endedReason).slice(0, 160) : null,
  });
  if (error) return json({ error: "Call event could not be processed" }, 422);
  if (!asObj(data).authorized) return json({ error: "Invalid webhook credential or assistant" }, 401);

  if (eventType === "tool-calls") {
    const calls = Array.isArray(message.toolCallList) ? message.toolCallList.slice(0, 10) : [];
    return json({ results: await Promise.all(calls.map(async (value: unknown) => {
      const item = asObj(value);
      const name = asStr(asObj(item.function).name);
      const toolCallId = asStr(item.id);
      if (name === "get_booking_link") {
        const url = asStr(asObj(data).booking_url);
        return {
          toolCallId,
          ...(url
            ? { result: JSON.stringify({ booking_url: url, status: "link_only", booked: false }) }
            : { error: "No booking link configured. Ask caller to contact the business." }),
        };
      }
      if (name === "google_check_availability" || name === "google_book_appointment") {
        const response = await handleGoogleTool({
          db: supabase, token: match[1], assistantId, callId, toolCallId,
          name, arguments: asObj(item.function).arguments,
        });
        return {toolCallId,...response};
      }
      if (name === "check_availability" || name === "book_appointment") {
        const response=await handleCalendlyVoiceTool({
          supabase,token:match[1],assistantId,callId,toolCallId,
          name,arguments:asObj(item.function).arguments,
        });
        return {toolCallId,...response};
      }
      return { toolCallId, error: "This tool is not enabled. Do not claim a booking or message was sent." };
    })) });
  }
  return json({ received: true });
}
