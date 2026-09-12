// POST /api/resolve-conflict — Forgetting Path (Contradiction Resolution).
// User picks one of a contested pair as correct. Winner -> active, restored
// confidence. Loser -> 'revoked' with content wiped (same privacy rule as forget.js).
import { getSupabase, logEvent } from '../lib/supabase.js';
import { bumpedBase, CONTRADICTION_PENALTY } from '../lib/confidence.js';
import { json, handleOptions, readJson } from '../lib/http.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { request, env } = context;
  const client = getSupabase(env);
  const { winner_id, loser_id } = await readJson(request);

  if (!winner_id) {
    return json({ ok: false, error: 'Missing winner_id' }, 400);
  }

  const { data: winner, error: wErr } = await client
    .from('memories')
    .select('*')
    .eq('id', winner_id)
    .single();
  if (wErr || !winner) return json({ ok: false, error: 'Winner not found' }, 404);

  // Infer the loser from the winner's current conflict pointer when not given.
  const conflictId = loser_id || winner.contradicted_by;
  if (!conflictId || conflictId === winner_id) {
    return json({ ok: false, error: 'No conflict pair found for this memory' }, 400);
  }

  const { data: loser, error: lErr } = await client
    .from('memories')
    .select('id, fact_text, category, base_confidence')
    .eq('id', conflictId)
    .single();
  if (lErr || !loser) return json({ ok: false, error: 'Loser not found' }, 404);

  const now = new Date().toISOString();

  // -- Winner: back to active, confidence restored ---------------------
  // The penalty that was applied when the contradiction was flagged is paid
  // back so the user's chosen fact reads strong again, then it is re-confirmed.
  const restored = bumpedBase(winner.base_confidence ?? 50, CONTRADICTION_PENALTY);
  const { error: wUpdErr } = await client
    .from('memories')
    .update({
      status: 'active',
      contradicted_by: null,
      base_confidence: restored,
      confidence: restored,
      corroboration_count: Math.max(1, (winner.corroboration_count ?? 1) + 1),
      last_confirmed_at: now,
    })
    .eq('id', winner_id);
  if (wUpdErr) return json({ ok: false, error: 'Winner update failed', detail: wUpdErr.message }, 500);

  await logEvent(client, winner_id, 'resolve',
    `Resolved conflict: user chose "${winner.category}" memory as correct; confidence restored to ${restored}.`);

  // -- Loser: revoked, content wiped, never retrievable again ------------
  const { data: loserAfter, error: lUpdErr } = await client
    .from('memories')
    .update({ status: 'revoked', fact_text: null, base_confidence: 0, confidence: 0, contradicted_by: null, category: null })
    .eq('id', conflictId)
    .select('id, category');
  if (lUpdErr) return json({ ok: false, error: 'Loser update failed', detail: lUpdErr.message }, 500);

  await logEvent(client, conflictId, 'revoke',
    `Rejected in conflict resolution: user revoked a '${loser.category}' memory. Content intentionally not retained.`);
  await logEvent(client, conflictId, 'resolve',
    `Resolved conflict: this memory lost to memory ${winner_id} and was revoked.`);

  return json({
    ok: true,
    winner: {
      id: winner_id,
      fact_text: winner.fact_text,
      status: 'active',
      base_confidence: restored,
    },
    loser: {
      id: conflictId,
      fact_text: null,
      status: 'revoked',
      audit_category: loserAfter?.[0]?.category ?? loser.category,
    },
    message: `I'll trust "${winner.fact_text}" from now on. The other memory is gone for good.`,
  });
}