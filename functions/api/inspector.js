// GET /api/inspector — "What do you remember about me?"
// Full list of active/contested/stale memories with effective confidence,
// plus recent audit events for the transparency view.
import { getSupabase } from '../lib/supabase.js';
import { effectiveConfidence, daysSince } from '../lib/confidence.js';
import { json, corsify } from '../lib/http.js';

export const onRequestOptions = () => new Response(null, { status: 204, headers: corsify() });

export async function onRequestGet(context) {
  const { env, request } = context;
  const client = getSupabase(env);
  const scope = new URL(request.url).searchParams.get('scope') || 'user:default';

  const { data: memories, error: mErr } = await client
    .from('memories')
    .select('*')
    .eq('scope', scope)
    .in('status', ['active', 'contested', 'stale'])
    .order('created_at', { ascending: false });
  if (mErr) return json({ ok: false, error: 'DB query failed', detail: mErr.message }, 500);

  const { data: events, error: eErr } = await client
    .from('memory_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  if (eErr) return json({ ok: false, error: 'Events query failed', detail: eErr.message }, 500);

  const { count: revokedCount, error: rErr } = await client
    .from('memories')
    .select('id', { count: 'exact', head: true })
    .eq('scope', scope)
    .eq('status', 'revoked');
  if (rErr) return json({ ok: false, error: 'Revoked count failed', detail: rErr.message }, 500);

  const annotated = (memories || []).map((m) => ({
    ...m,
    fact_text: m.fact_text ?? null,
    effective_confidence: m.fact_text ? effectiveConfidence(m) : 0,
    days_since_confirm: m.last_confirmed_at ? Math.round(daysSince(m.last_confirmed_at) * 10) / 10 : null,
  }));

  return json({
    ok: true,
    scope,
    memories: annotated,
    revoked_count: revokedCount ?? 0,
    events: events || [],
  });
}