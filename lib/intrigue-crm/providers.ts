/** Explicit allowlist: never send CRM access tokens to user-provided URLs. */
export const CRM_PROVIDERS = ['zoho', 'hubspot', 'pipedrive'] as const;
export type CrmProvider = (typeof CRM_PROVIDERS)[number];
export type CrmContact = {
  full_name: string; email: string; phone: string; company_name: string;
};
export function isCrmProvider(value: unknown): value is CrmProvider {
  return typeof value === 'string' && (CRM_PROVIDERS as readonly string[]).includes(value);
}
export function zohoRegion(): string {
  const region = (process.env.INTRIGUE_ZOHO_REGION || 'eu').toLowerCase();
  if (!['com','eu','in','com.au','jp','com.cn','zohocloud.ca'].includes(region)) throw Error('Unsupported Zoho region');
  return region;
}
export function zohoAccountsDomain(): string {
  const region = zohoRegion();
  return region === 'zohocloud.ca' ? 'https://accounts.zohocloud.ca' : `https://accounts.zoho.${region}`;
}
export function oauthConfig(provider: CrmProvider, origin: string) {
  const base = `INTRIGUE_${provider.toUpperCase()}`;
  const clientId = process.env[`${base}_CLIENT_ID`] || '';
  const secret = process.env[`${base}_CLIENT_SECRET`] || '';
  if (!clientId || !secret) throw Error(`${provider} OAuth application has not been configured.`);
  const redirectUri = `${origin}/api/integrations/crm/callback`;
  const authorize = provider === 'zoho' ? `${zohoAccountsDomain()}/oauth/v2/auth`
    : provider === 'hubspot' ? 'https://app.hubspot.com/oauth/authorize'
    : 'https://oauth.pipedrive.com/oauth/authorize';
  const tokenUrl = provider === 'zoho' ? `${zohoAccountsDomain()}/oauth/v2/token`
    : provider === 'hubspot' ? 'https://api.hubapi.com/oauth/v1/token'
    : 'https://oauth.pipedrive.com/oauth/token';
  const scope = provider === 'zoho' ? 'ZohoCRM.modules.contacts.READ'
    : provider === 'hubspot' ? 'crm.objects.contacts.read' : '';
  return { clientId, secret, redirectUri, authorize, tokenUrl, scope };
}
export function safeApiDomain(provider: CrmProvider, raw: string | undefined): string {
  const fallback = provider === 'zoho'
    ? `https://www.zohoapis.${zohoRegion()}`
    : provider === 'hubspot' ? 'https://api.hubapi.com' : '';
  const candidate = raw || fallback;
  let u: URL;
  try { u = new URL(candidate); } catch { throw Error('CRM returned an invalid API domain.'); }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || u.pathname !== '/' || u.search || u.hash) throw Error('Invalid CRM API domain.');
  if (provider === 'hubspot' && u.hostname !== 'api.hubapi.com') throw Error('Unexpected HubSpot API host.');
  if (provider === 'zoho') {
    const host = `www.zohoapis.${zohoRegion()}`;
    if (u.hostname !== host) throw Error('Zoho API data center does not match your configured region.');
  }
  if (provider === 'pipedrive' && !(u.hostname === 'api.pipedrive.com' || (u.hostname.endsWith('.pipedrive.com') && u.hostname.length > '.pipedrive.com'.length))) throw Error('Unexpected Pipedrive API host.');
  return u.origin;
}
function clean(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0,max) : '';
}
function primary(values: unknown): string {
  if (typeof values === 'string') return values;
  if (!Array.isArray(values)) return '';
  const item = values.find(v=>v && typeof v==='object' && v.primary) || values[0];
  return typeof item === 'string' ? item : item && typeof item==='object' ? String(item.value || '') : '';
}
export function mapCrmContacts(provider: CrmProvider, payload: unknown): CrmContact[] {
  const obj = payload && typeof payload === 'object' ? payload as Record<string,unknown> : {};
  const records = provider === 'zoho' ? obj.data : provider === 'hubspot' ? obj.results : obj.data;
  if (!Array.isArray(records)) return [];
  return records.map(raw=>{
    const r = raw && typeof raw==='object' ? raw as Record<string,unknown> : {};
    if (provider==='zoho') return {
      full_name: clean([r.First_Name,r.Last_Name].filter(Boolean).join(' ') || r.Full_Name,150),
      email: clean(r.Email,254).toLowerCase(), phone: clean(r.Phone,40),
      company_name: clean(typeof r.Account_Name==='object' && r.Account_Name ? (r.Account_Name as Record<string,unknown>).name : r.Account_Name,200),
    };
    if (provider==='hubspot') {
      const p = r.properties && typeof r.properties==='object' ? r.properties as Record<string,unknown> : {};
      return {full_name:clean([p.firstname,p.lastname].filter(Boolean).join(' '),150),email:clean(p.email,254).toLowerCase(),phone:clean(p.phone,40),company_name:clean(p.company,200)};
    }
    return {full_name:clean(r.name,150),email:clean(primary(r.emails),254).toLowerCase(),phone:clean(primary(r.phones),40),company_name:clean(typeof r.org_id==='object' && r.org_id ? (r.org_id as Record<string,unknown>).name : '',200)};
  }).filter(c=>Boolean(c.full_name && c.email));
}
