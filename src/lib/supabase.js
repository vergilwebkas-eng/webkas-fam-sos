import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const supabaseConfigured = Boolean(url && key && !url.includes('YOUR_') && !key.includes('YOUR_'));
export const supabase = supabaseConfigured ? createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null;

export function emailFromIc(icName) {
  const bytes = new TextEncoder().encode(String(icName || '').trim().toLocaleLowerCase('id-ID'));
  const hex = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
  return 'ic-' + hex + '@webkas-fam-sos.invalid';
}
