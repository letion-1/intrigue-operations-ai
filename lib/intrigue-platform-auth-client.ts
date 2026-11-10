'use client';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Deliberately independent of the client's @supabase/ssr cookie session.
// Only used by the private platform portal, never by client workspace pages.
let instance: SupabaseClient | undefined;
export function createPlatformClient(): SupabaseClient {
  if (!instance) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new Error('Private sign-in is temporarily unavailable.');
    const browser = typeof window !== 'undefined';
    instance = createClient(url, key, {
      auth: {
        storageKey: 'intrigue-private-platform-auth',
        persistSession: browser,
        autoRefreshToken: browser,
        detectSessionInUrl: false,
      },
    });
  }
  return instance;
}
