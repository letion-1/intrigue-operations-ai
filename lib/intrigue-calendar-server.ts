import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { createClient } from "@/lib/supabase/server";

type Provider = "cal" | "calendly";
export type CalendarTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
};
export function validProvider(value: string | null): value is Provider {
  return value === "cal" || value === "calendly";
}

export function siteOrigin() {
  const raw = process.env.INTRIGUE_PUBLIC_URL;
  if (!raw) throw new Error("INTRIGUE_PUBLIC_URL not configured");
  const url = new URL(raw);
  if ((url.protocol !== "https:" && url.hostname !== "localhost") || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("INTRIGUE_PUBLIC_URL must be the canonical HTTPS site origin");
  }
  return url.origin;
}

export function providerConfig(provider: Provider) {
  const prefix = provider === "cal" ? "CAL" : "CALENDLY";
  const clientId = process.env[`${prefix}_OAUTH_CLIENT_ID`];
  const clientSecret = process.env[`${prefix}_OAUTH_CLIENT_SECRET`];
  if (!clientId || !clientSecret) throw new Error(`${provider} OAuth app credentials not configured`);
  return { clientId, clientSecret, redirectUri: `${siteOrigin()}/api/integrations/calendar/callback` };
}

function encryptionKey(): Buffer {
  const value = process.env.INTRIGUE_CALENDAR_ENCRYPTION_KEY || "";
  if (!/^[0-9a-fA-F]{64}$/.test(value)) throw new Error("INTRIGUE_CALENDAR_ENCRYPTION_KEY must be 64 hex characters");
  return Buffer.from(value, "hex");
}
export function seal(tokens: CalendarTokens, workspaceId: string, provider: Provider): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(Buffer.from(`${workspaceId}:${provider}`));
  const payload = Buffer.concat([cipher.update(JSON.stringify(tokens), "utf8"), cipher.final()]);
  return ["v1",iv.toString("base64url"),cipher.getAuthTag().toString("base64url"),payload.toString("base64url")].join(".");
}
export function unseal(data: string, workspaceId: string, provider: Provider): CalendarTokens {
  const [version, ivB64, tagB64, encryptedB64] = data.split(".");
  if (version !== "v1" || !ivB64 || !tagB64 || !encryptedB64) throw new Error("Credential format invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivB64,"base64url"));
  decipher.setAAD(Buffer.from(`${workspaceId}:${provider}`));
  decipher.setAuthTag(Buffer.from(tagB64,"base64url"));
  const out = JSON.parse(Buffer.concat([decipher.update(Buffer.from(encryptedB64,"base64url")),decipher.final()]).toString("utf8")) as CalendarTokens;
  if (typeof out.access_token !== "string" || typeof out.refresh_token !== "string" || typeof out.expires_at !== "number") throw new Error("Credential payload invalid");
  return out;
}

export async function ownerContext() {
  const supabase = await createClient();
  const {data:{user},error} = await supabase.auth.getUser();
  if (error || !user) return null;
  const {data: workspace, error: workspaceError} = await supabase.from("workspaces")
    .select("id").eq("owner_id",user.id).maybeSingle();
  if (workspaceError || !workspace) return null;
  return {supabase,workspaceId:workspace.id as string,userId:user.id};
}
export type OwnerContext = NonNullable<Awaited<ReturnType<typeof ownerContext>>>;

export async function getStored(ctx: OwnerContext, provider: Provider) {
  const {data,error} = await ctx.supabase.rpc("intrigue_calendar_connection",{
    p_workspace_id:ctx.workspaceId,p_provider:provider,p_operation:"get",
  });
  if (error) throw new Error("Calendar storage not available: " + error.message);
  const result = data as {connected?:boolean;encrypted_tokens?:string;connected_at?:string}|null;
  return result?.connected && result.encrypted_tokens ? result : null;
}
export async function putStored(ctx: OwnerContext,provider: Provider, tokens:CalendarTokens) {
  const {error}=await ctx.supabase.rpc("intrigue_calendar_connection",{
    p_workspace_id:ctx.workspaceId,p_provider:provider,p_operation:"store",
    p_encrypted_tokens:seal(tokens,ctx.workspaceId,provider),
  });
  if(error)throw new Error("Could not save calendar connection: "+error.message);
}

export async function exchangeTokens(provider:Provider, mode:"authorization_code"|"refresh_token", codeOrRefresh:string, verifier?:string):Promise<CalendarTokens> {
  const {clientId,clientSecret,redirectUri}=providerConfig(provider);
  let response:Response;
  if(provider==="cal") {
    response=await fetch("https://api.cal.com/v2/auth/oauth2/token",{
      method:"POST",headers:{"Content-Type":"application/json"},cache:"no-store",signal:AbortSignal.timeout(12000),
      body:JSON.stringify({client_id:clientId,client_secret:clientSecret,grant_type:mode,
        ...(mode==="authorization_code"?{code:codeOrRefresh,redirect_uri:redirectUri}:{refresh_token:codeOrRefresh})}),
    });
  } else {
    const body=new URLSearchParams({grant_type:mode,client_id:clientId,
      ...(mode==="authorization_code"?{code:codeOrRefresh,redirect_uri:redirectUri,code_verifier:verifier||""}:{refresh_token:codeOrRefresh})});
    response=await fetch("https://auth.calendly.com/oauth/token",{
      method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded",Authorization:"Basic "+Buffer.from(`${clientId}:${clientSecret}`).toString("base64")},
      body:body.toString(),cache:"no-store",signal:AbortSignal.timeout(12000),
    });
  }
  if(!response.ok) throw new Error(`Provider token exchange failed (${response.status}); reconnect calendar`);
  const data=await response.json() as {access_token?:string;refresh_token?:string;expires_in?:number};
  if(!data.access_token || !data.refresh_token)throw new Error("Provider returned incomplete OAuth credentials");
  return {access_token:data.access_token,refresh_token:data.refresh_token,expires_at:Date.now()+Math.max(60,Number(data.expires_in)||1800)*1000};
}

export async function activeTokens(ctx:OwnerContext,provider:Provider):Promise<CalendarTokens|null> {
  const connection=await getStored(ctx,provider);
  if(!connection?.encrypted_tokens)return null;
  const tokens=unseal(connection.encrypted_tokens,ctx.workspaceId,provider);
  if(tokens.expires_at > Date.now()+60_000)return tokens;
  const fresh=await exchangeTokens(provider,"refresh_token",tokens.refresh_token);
  await putStored(ctx,provider,fresh);
  return fresh;
}
