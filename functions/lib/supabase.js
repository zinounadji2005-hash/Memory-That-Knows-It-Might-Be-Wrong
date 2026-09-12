import { createClient } from '@supabase/supabase-js';

// Server-side only. Keys come from env via wrangler secrets (context.env),
// never from the frontend bundle.
export function getSupabase(env) {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    throw new Error('Supabase env vars missing. Set SUPABASE_URL and SUPABASE_SERVICE_KEY via `wrangler pages secret put`.');
  }
  return createClient(url, key);
}

export function logEvent(client, memoryId, eventType, detail) {
  return client
    .from('memory_events')
    .insert({ memory_id: memoryId, event_type: eventType, detail })
    .select('id')
    .single();
}