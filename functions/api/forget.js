// POST /api/forget — Forgetting Path (User Revocation).
// Hard privacy control: clears fact_text, sets status 'revoked', logs the
// event with category only — NEVER the raw content.
import { getSupabase, logEvent } from '../lib/supabase.js';
import { json, handleOptions, readJson } from '../lib/http.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { request, env } = context;
  const client = getSupabase(env);
  const { memory_id } = await readJson(request);

  if (!memory_id) {
    return json({ ok: false, error: 'Missing memory_id' }, 400);
  }

  // Fetch the memory BEFORE we wipe it — we need the category for the audit
  // log, but we must never pass the fact_text into the log.
  const { data: mem, error: fErr } = await client
    .from('memories')
    .select('id, category, status, scope')
    .eq('id', memory_id)
    .single();

  if (fErr || !mem) {
    return json({ ok: false, error: 'Memory not found' }, 404);
  }
  if (mem.status === 'revoked') {
    return json({ ok: true, message: 'Already revoked.' });
  }

  // Wipe the memory content — hard null on fact_text, zero confidence,
  // clear any conflict pointer. The row stays to maintain referential
  // integrity and ensure the revoke event has a valid memory_id FK.
  const { error: uErr } = await client
    .from('memories')
    .update({
      fact_text: null,
      status: 'revoked',
      base_confidence: 0,
      confidence: 0,
      contradicted_by: null,
      category: null,
      last_confirmed_at: new Date().toISOString(),
    })
    .eq('id', memory_id);
  if (uErr) return json({ ok: false, error: 'Update failed', detail: uErr.message }, 500);

  // If another memory pointed at this one as contradicted_by, clear it too.
  await client
    .from('memories')
    .update({ contradicted_by: null })
    .eq('contradicted_by', memory_id);

  // Audit event: category only, never raw content.
  const detail = mem.category
    ? `User revoked a '${mem.category}' memory. Content intentionally not retained.`
    : 'User revoked a memory. Content intentionally not retained.';

  await logEvent(client, memory_id, 'revoke', detail);

  return json({
    ok: true,
    message: 'Memory permanently forgotten. No content was retained in the event log.',
    memory_id,
  });
}