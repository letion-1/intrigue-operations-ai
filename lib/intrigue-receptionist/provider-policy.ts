import 'server-only';
import {voiceService,voiceUuid} from '@/lib/intrigue-ai/voice-gate';

export type ProviderToolPolicy={allowed:boolean;error?:string};
const deny=(error:string):ProviderToolPolicy=>({allowed:false,error});
/**
 * Enforces tenant's selected calendar for Vapi tools when explicitly enabled.
 * Never accepts a workspace ID supplied by a caller, client, or Vapi tool arguments.
 * Instead requires an existing admitted call reservation and an active verified route.
 * The feature flag defaults to OFF for backwards compatibility during deployment.
 */
export async function checkCalendarToolPolicy(args:{assistantId:string;callId:string;toolName:string}):Promise<ProviderToolPolicy>{
 if(process.env.INTRIGUE_RECEPTIONIST_PROVIDER_ROUTING_V1!=='true')return {allowed:true};
 const {assistantId,callId,toolName}=args;
 const isGoogle=toolName==='google_check_availability'||toolName==='google_book_appointment';
 const isCalendly=toolName==='check_availability'||toolName==='book_appointment';
 const isLink=toolName==='get_booking_link';
 if(!isGoogle&&!isCalendly&&!isLink)return {allowed:true};
 if(!voiceUuid.test(assistantId)||!voiceUuid.test(callId))return deny('A verified inbound call is required for calendar access.');
 try{
  const db=voiceService();
  const {data:routes,error:routeError}=await db.from('intrigue_ai_voice_routes')
    .select('workspace_id').eq('assistant_id',assistantId).eq('active',true).limit(100);
  if(routeError||!routes?.length)return deny('No verified company receptionist route is configured.');
  const unique=[...new Set(routes.map(r=>String(r.workspace_id)))];
  if(unique.length!==1)return deny('This assistant is assigned across multiple companies. Request a dedicated assistant.');
  const workspaceId=unique[0];
  const {data:reservation,error:ledgerError}=await db.from('intrigue_ai_usage_ledger')
    .select('status').eq('workspace_id',workspaceId).eq('request_key','vapi:'+callId)
    .eq('kind','voice').maybeSingle();
  if(ledgerError||reservation?.status!=='reserved')return deny('No active workspace-specific inbound call reservation found.');
  const {data:settings,error}=await db.from('intrigue_receptionist_workspace_settings')
    .select('calendar_provider,booking_mode').eq('workspace_id',workspaceId).maybeSingle();
  if(error||!settings)return deny('Choose and save the company calendar in Receptionist Settings before scheduling.');
  if(settings.booking_mode==='disabled')return deny('Live calendar tools are disabled for this company.');
  if(isGoogle&&settings.calendar_provider!=='google')return deny('The saved company calendar is not Google. Reconfigure the receptionist tools for its selected provider.');
  if(isCalendly&&settings.calendar_provider!=='calendly')return deny('The saved company calendar is not Calendly. Reconfigure the receptionist tools for its selected provider.');
  if(isLink&&(settings.booking_mode!=='link'||settings.calendar_provider==='google'))
    return deny('A verified booking-page link is not enabled for this company.');
  if(isGoogle&&toolName==='google_book_appointment'&&settings.booking_mode!=='direct')return deny('Direct Google booking is disabled for this company.');
  if(isCalendly&&toolName==='book_appointment'&&settings.booking_mode!=='direct')return deny('Direct Calendly booking is disabled for this company.');
  return {allowed:true};
 }catch{return deny('Calendar routing validation unavailable. No booking was made.');}
}
