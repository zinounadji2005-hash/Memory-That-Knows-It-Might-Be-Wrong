// POST /api/remember — Write Path.
// Free-text input -> structured fact extraction -> contradiction/confirmation
// check against existing same-category memories -> write | boost | flag.
import { getSupabase, logEvent } from '../lib/supabase.js';
import { extractFact, classifyRelation } from '../lib/gemini.js';
import { bumpedBase, CONTRADICTION_PENALTY, CONFIRM_BOOST } from '../lib/confidence.js';
import { json, handleOptions, readJson } from '../lib/http.js';

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { request, env } = context;
  const client = getSupabase(env);
  const { input, scope = 'user:default' } = await readJson(request);

  if (!input || typeof input !== 'string' || !input.trim()) {
    return json({ ok: false, error: 'Missing input' }, 400);
  }

  // -- Step 2: extract a structured claim ----------------------------
  const fallback = { fact_text: input.trim(), category: 'other', confidence: 55, is_claim: true };
  const fact = await extractFact(env, input, fallback);
  if (!fact) {
    return json({
      ok: true,
      outcome: 'no_claim',
      message: 'I could not find a factual claim in that — ask me to remember something you told me about yourself.',
    });
  }

  const factText = fact.fact_text.trim();
  const category = fact.category || 'other';
  const base = Math.max(0, Math.min(100, Number(fact.confidence) || 55));

  // -- Step 3: existing same-category memories -----------------------
  const { data: existing, error: qErr } = await client
    .from('memories')
    .select('*')
    .eq('scope', scope)
    .eq('category', category)
    .in('status', ['active', 'contested'])
    .not('id', 'is', null)
    .limit(50);
  if (qErr) return json({ ok: false, error: 'DB query failed', detail: qErr.message }, 500);

  // -- Step 4: relation check (confirm / contradict / unrelated) -----
  let confirmedId = null;
  let contradictedId = null;
  let contradictionReason = null;

  for (const mem of existing || []) {
    if (!mem.fact_text) continue;
    const res = await classifyRelation(env, factText, category, mem.fact_text);
    const relation = res?.relation || 'unrelated';
    if (relation === 'contradict' && !contradictedId) {
      contradictedId = mem.id;
      contradictionReason = res?.reason || `Conflicts with an existing "${category}" memory`;
      break;
    }
    if (relation === 'confirm' && !confirmedId) {
      confirmedId = mem.id;
    }
  }

  const now = new Date().toISOString();

  // ---- CONTRADICTION FLOW ------------------------------------------
  if (contradictedId) {
    const old = (existing || []).find((m) => m.id === contradictedId);

    // Insert the new fact as a contested memory pointing at the old one.
    const { data: inserted, error: iErr } = await client
      .from('memories')
      .insert({
        scope,
        fact_text: factText,
        category,
        source: 'user_stated',
        confidence: bumpedBase(base, -CONTRADICTION_PENALTY),
        base_confidence: bumpedBase(base, -CONTRADICTION_PENALTY),
        status: 'contested',
        corroboration_count: 1,
        contradicted_by: contradictedId,
        created_at: now,
        last_confirmed_at: now,
      })
      .select('id')
      .single();
    if (iErr) return json({ ok: false, error: 'Insert failed', detail: iErr.message }, 500);

    const newId = inserted.id;

    const oldPenalized = bumpedBase(old?.base_confidence ?? 50, -CONTRADICTION_PENALTY);
    const { error: uErr } = await client
      .from('memories')
      .update({
        status: 'contested',
        contradicted_by: newId,
        confidence: oldPenalized,
        base_confidence: oldPenalized,
        last_confirmed_at: now,
      })
      .eq('id', contradictedId);
    if (uErr) return json({ ok: false, error: 'Update failed', detail: uErr.message }, 500);

    await logEvent(client, contradictedId, 'contradict', `Contradiction flagged: new "${category}" claim conflicts with this memory.`);
    await logEvent(client, newId, 'contradict', `Flagged as contested: conflicts with memory ${contradictedId}.`);

    return json({
      ok: true,
      outcome: 'contradiction',
      message: `This contradicts what I knew before — flagging both for review. Old memory: "${old?.fact_text}". New claim: "${factText}".`,
      new_memory_id: newId,
      contradicted_memory_id: contradictedId,
      reason: contradictionReason,
      involved: [
        { id: contradictedId, fact_text: old?.fact_text, status: 'contested' },
        { id: newId, fact_text: factText, status: 'contested' },
      ],
    });
  }

  // ---- CONFIRM FLOW -------------------------------------------------
  if (confirmedId) {
    const target = (existing || []).find((m) => m.id === confirmedId);
    const newBase = bumpedBase(target?.base_confidence ?? 50, CONFIRM_BOOST);
    const { error: uErr } = await client
      .from('memories')
      .update({
        corroboration_count: (target?.corroboration_count ?? 1) + 1,
        base_confidence: newBase,
        confidence: newBase,
        last_confirmed_at: now,
        status: 'active',
      })
      .eq('id', confirmedId);
    if (uErr) return json({ ok: false, error: 'Update failed', detail: uErr.message }, 500);

    await logEvent(client, confirmedId, 'confirm', `Corroborated: user restated "${category}" fact — confidence raised by ${CONFIRM_BOOST}.`);

    return json({
      ok: true,
      outcome: 'confirm',
      message: `Got it — this corroborates an existing ${category} memory ("${target?.fact_text}"). Confidence raised, marked fresh.`,
      memory_id: confirmedId,
      corroboration_count: (target?.corroboration_count ?? 1) + 1,
      base_confidence: newBase,
    });
  }

  // ---- NEW / UNRELATED FLOW ------------------------------------------
  const { data: created, error: cErr } = await client
    .from('memories')
    .insert({
      scope,
      fact_text: factText,
      category,
      source: 'user_stated',
      confidence: base,
      base_confidence: base,
      status: 'active',
      corroboration_count: 1,
      created_at: now,
      last_confirmed_at: now,
    })
    .select('*')
    .single();
  if (cErr) return json({ ok: false, error: 'Insert failed', detail: cErr.message }, 500);

  await logEvent(client, created.id, 'write', `New "${category}" memory noted from user statement.`);

  return json({
    ok: true,
    outcome: 'write',
    message: `Got it — noted as ${category}, confidence ${base}%.`,
    memory: created,
  });
}