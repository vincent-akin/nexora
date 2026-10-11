import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Service-role client. Bypasses RLS and may call the trusted database functions
 * (grant_reward, start_game_run, settle_game_run, ...). Server code only: never
 * import this from a client component.
 */
export function createAdminClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
