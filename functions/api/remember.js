// POST /api/remember — Write Path.
// Free-text input -> structured fact extraction -> contradiction/confirmation
// check against existing same-category memories -> write | boost | flag.
import { getSupabase, logEvent } from '../lib/supabase.js';
import { extractFact, classifyRelation } from '../lib/gemini.js';
import { bumpedBase, CONTRADICTION_PENALTY, CONFIRM_BOOST } from '../lib/confidence.js';
import { keywordCategory } from '../lib/categories.js';
import { json, handleOptions, readJson } from '../lib/http.js';

// Deterministic cleanup of a fresh claim before conflict checking.
// The LLM alone is not reliable enough for a live demo: it has misclassified
// "I moved to Berlin" as category "other" with the raw text echoed back, which
// silently skipped contradiction detection. These rules fix the clear cases.
function normalizeClaim(fact, rawInput) {
  let text = String(fact.fact_text || rawInput).trim();
  const llmCategory = fact.category || 'other';
  const kw = keywordCategory(rawInput);

  // LLM said "other" but the input clearly signals a known category.
  const category = llmCategory !== 'other' ? llmCategory : kw || 'other';

  if (category === 'location') {
    // "I moved to Berlin" -> "lives in Berlin"  (relocations are a location fact)
    text = text.replace(/^i\s+/i, '').trim();
    text = text.replace(/^(?:lives?|live|am living|living)\s+in\s+/i, 'lives in ');
    text = text.replace(/^moved?\s+to\s+/i, 'lives in ');
    text = text.replace(/^move\s+to\s+/i, 'lives in ');
  } else if (category === 'preference') {
    text = text.replace(/^i\s+prefer\s+/i, 'prefers ');
  } else if (category === 'diet') {
    text = text.replace(/^i'?m\s+/i, 'is ');
  }

  return { fact_text: text, category };
}

// Deterministic statement confidence. The model's self-assigned number is too
// unreliable for a live demo (it has returned 55 for crystal-clear statements).
// Confidence = how clearly and directly the user stated the fact. Direct,
// first-person claims score high; hedged or vague ones score low.
const HEDGE_WORDS = /(\bmaybe\b|\bprobably\b|\bnot sure\b|\bi think\b|\bkind of\b|\bsort of\b|\bsometimes\b|\bi guess\b|\bpretty sure\b|\bfairly sure\b|\bpossibly\b|\bmight be\b)/i;

function statementConfidence(input) {
  const s = String(input || '');
  if (HEDGE_WORDS.test(s)) return 55;
  if (/^(i|my|me|we|our)\b/i.test(s.trim())) return 90;
  return 80; // third-person or statement-like phrasing, still clearly asserted
}

// Deterministic contradiction backstop for the demo's centerpiece moment:
// two location facts referring to different places are always a conflict,
// even if the LLM classifies them as "unrelated".
function trailingPlace(factText) {
  const m = String(factText || '').match(/\bin\s+(.+)$/i);
  return m ? m[1].trim().toLowerCase() : null;
}

function deterministicLocationConflict(newText, newCategory, existingText, existingCategory) {
  if (newCategory !== 'location' || existingCategory !== 'location') return false;
  const a = trailingPlace(newText);
  const b = trailingPlace(existingText);
  if (!a || !b) return false;
  return a !== b;
}

// Canonical key for comparing claims: "Lives  in Paris" and "lives in paris"
// are the same fact. Used by the identical-claim merge on the write path.
function claimKey(text) {
  const s = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return s || null;
}

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

  const { fact_text: factText, category } = normalizeClaim(fact, input);
  const base = statementConfidence(input);

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

  // -- Step 3b: identical-claim merge (deterministic) ------------------
  // Restating the same fact must NEVER create a duplicate row.
  //   - active  -> corroborate: confidence +10, corroboration++, mark fresh
  //   - contested -> the user just re-asserted one side: resolve toward it.
  //                 This side becomes active + boosted; its conflict partner is
  //                 revoked with content wiped (same privacy rule as forget.js).
  let confirmedId = null;
  let skipRelationLoop = false;
  const newKey = claimKey(factText);
  if (newKey) {
    const duplicate = (existing || []).find((m) => claimKey(m.fact_text) === newKey);
    if (duplicate && duplicate.status === 'contested') {
      const partner = (existing || []).find(
        (m) =>
          m.id !== duplicate.id &&
          m.status === 'contested' &&
          (m.contradicted_by === duplicate.id || duplicate.contradicted_by === m.id)
      );
      const newBase = bumpedBase(duplicate.base_confidence ?? 50, CONFIRM_BOOST);
      await client
        .from('memories')
        .update({
          status: 'active',
          contradicted_by: null,
          base_confidence: newBase,
          confidence: newBase,
          corroboration_count: (duplicate.corroboration_count ?? 1) + 1,
          last_confirmed_at: new Date().toISOString(),
        })
        .eq('id', duplicate.id);
      if (partner) {
        await client
          .from('memories')
          .update({
            status: 'revoked',
            fact_text: null,
            base_confidence: 0,
            confidence: 0,
            contradicted_by: null,
            category: null,
          })
          .eq('id', partner.id);
        await client.from('memories').update({ contradicted_by: null }).eq('contradicted_by', partner.id);
        await logEvent(client, partner.id, 'revoke',
          `Rejected in favour of a re-asserted memory: user revoked a '${partner.category}' memory. Content intentionally not retained.`);
      }
      await logEvent(client, duplicate.id, 'resolve',
        `Conflict resolved: user re-asserted this "${duplicate.category}" memory; the conflicting one was revoked.`);
      return json({
        ok: true,
        outcome: 'reaffirm',
        message: partner
          ? `Got it — you reaffirmed "${duplicate.fact_text}", so I trust it and have let go of the conflicting version.`
          : `Got it — reaffirmed "${duplicate.fact_text}", marked fresh.`,
        memory_id: duplicate.id,
        base_confidence: newBase,
        revoked_id: partner?.id ?? null,
      });
    }
    if (duplicate) {
      confirmedId = duplicate.id;
      skipRelationLoop = true;
    }
  }

  // -- Step 4: relation check (confirm / contradict / unrelated) -----
  let contradictedId = null;
  let contradictionReason = null;

  if (!skipRelationLoop) {
    for (const mem of existing || []) {
      if (!mem.fact_text) continue;
      const res = await classifyRelation(env, factText, category, mem.fact_text);
      let relation = res?.relation || 'unrelated';
      if (relation !== 'contradict' &&
          deterministicLocationConflict(factText, category, mem.fact_text, mem.category)) {
        relation = 'contradict';
      }
      if (relation === 'contradict' && !contradictedId) {
        contradictedId = mem.id;
        contradictionReason = res?.reason || `Conflicts with an existing "${category}" memory`;
        break;
      }
      if (relation === 'confirm' && !confirmedId) {
        confirmedId = mem.id;
      }
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

    // Already-contested memories do not get re-penalized: the -30 was applied
    // once when they first entered the dispute, so confidence can never stack
    // down to zero from repeated contradictory statements.
    const oldPenalized =
      old?.status === 'contested'
        ? (old?.base_confidence ?? 50)
        : bumpedBase(old?.base_confidence ?? 50, -CONTRADICTION_PENALTY);
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