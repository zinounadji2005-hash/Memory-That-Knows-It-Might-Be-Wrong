// POST /api/recall — Retrieval Path.
// Question -> category routing -> fetch matching memories -> apply time decay
// -> compose answer by confidence tier -> log a recall audit event.
import { getSupabase, logEvent } from '../lib/supabase.js';
import { routeQuestion } from '../lib/gemini.js';
import {
  effectiveConfidence,
  confidenceTier,
  isStaleCandidate,
  STALE_FLOOR,
  CONFIDENCE_LOW,
  daysSince,
} from '../lib/confidence.js';
import { json, handleOptions, readJson } from '../lib/http.js';

// Deterministic local router — a stronger signal than the LLM route. The demo
// must never miss the "I might be wrong" moment because the language model
// failed to detect that "where do I live?" is about location.
const ROUTE_KEYWORDS = {
  location: ['live', 'living', 'locate', 'located', 'move', 'moved', 'city', 'hometown', 'home', 'address', 'where do i'],
  diet: ['eat', 'eating', 'food', 'meals', 'vegetarian', 'vegan', 'diet', 'restaurant', 'cooking'],
  contact: ['email', 'phone', 'number', 'call', 'contact', 'reach'],
  preference: ['prefer', 'preference', 'like', 'favorite', 'favourite', 'seat', 'window', 'love', 'enjoy'],
};

function keywordRoute(question) {
  const q = question.toLowerCase();
  for (const [category, words] of Object.entries(ROUTE_KEYWORDS)) {
    // Word-boundary matching, never substring — `eat` must not match `seat`
    // and `prefer` must not match `preference`.
    if (words.some((w) => new RegExp(`\\b${w}\\b`).test(q))) {
      return { scope: 'user:default', category, keywords: words.filter((w) => new RegExp(`\\b${w}\\b`).test(q)) };
    }
  }
  return { scope: 'user:default', category: null, keywords: [] };
}

function routeFor(question, llmRoute) {
  const kw = keywordRoute(question);
  if (kw.category) return kw; // deterministic beats model
  if (llmRoute?.category) return { ...kw, category: llmRoute.category };
  return kw;
}

export const onRequestOptions = () => handleOptions();

export async function onRequestPost(context) {
  const { request, env } = context;
  const client = getSupabase(env);
  const { question, scope = 'user:default' } = await readJson(request);

  if (!question || typeof question !== 'string' || !question.trim()) {
    return json({ ok: false, error: 'Missing question' }, 400);
  }

  // -- Step 2: route to category -------------------------------------
  // Local keywords take priority for determinism; the LLM refines the rest.
  const llmRoute = await routeQuestion(env, question, {
    scope: 'user:default',
    category: null,
    keywords: [],
  });
  const route = routeFor(question, llmRoute);

  let builder = client
    .from('memories')
    .select('*')
    .eq('scope', scope)
    .in('status', ['active', 'contested']);

  if (route?.category) builder = builder.eq('category', route.category);

  const { data: memories, error: qErr } = await builder.order('last_confirmed_at', { ascending: false }).limit(50);
  if (qErr) return json({ ok: false, error: 'DB query failed', detail: qErr.message }, 500);

  const live = (memories || []).filter((m) => m.fact_text);

  if (live.length === 0) {
    return json({
      ok: true,
      answer: `I don't remember anything about that yet. Tell me a fact about yourself and I'll start a memory for it.`,
      effective_confidence: 0,
      tier: 'none',
      unsure: false,
      relied_on: [],
      conflicts: [],
      route,
    });
  }

  // -- Step 4: apply decay, and demote stale memories on this read ----
  const withEff = live.map((m) => ({
    ...m,
    effective: effectiveConfidence(m),
    days_since_confirm: Math.round(daysSince(m.last_confirmed_at) * 10) / 10,
  }));

  const staleOnes = withEff.filter((m) => isStaleCandidate(m, m.effective));
  for (const s of staleOnes) {
    await client.from('memories').update({ status: 'stale' }).eq('id', s.id);
    await logEvent(client, s.id, 'decay', `Effective confidence fell below ${STALE_FLOOR}; marked stale and excluded from future confident answers.`);
  }

  const ranked = withEff
    .filter((m) => m.status !== 'stale')
    .sort((a, b) => b.effective - a.effective);

  // Contested pairs to surface (provoke the explicit "I might be wrong").
  const conflictPairs = [];
  const paired = new Set();
  for (const m of ranked) {
    if (m.status === 'contested' && m.contradicted_by && !paired.has(m.id)) {
      const other = ranked.find((o) => o.id === m.contradicted_by);
      if (other && !paired.has(other.id)) {
        paired.add(m.id);
        paired.add(other.id);
        conflictPairs.push({ a: m, b: other });
      } else {
        paired.add(m.id);
      }
    }
  }

  const best = ranked[0];
  const tier = best ? confidenceTier(best.effective) : 'none';

  // -- Step 5: compose the answer by tier ------------------------------
  let answer;
  let unsure = false;

  if (best && best.status === 'contested') {
    // Hard "I might be wrong" moment — never guess between conflicting facts.
    unsure = true;
    if (conflictPairs.length > 0) {
      const [a, b] = [conflictPairs[0].a, conflictPairs[0].b];
      answer =
        `I might be wrong about this. I'm holding two conflicting memories about your ${a.category}: ` +
        `"${a.fact_text}" and "${b.fact_text}". I'm not sure which is current — can you tell me which one to keep?`;
    } else {
      answer =
        `I might be wrong about this. My memory "${best.fact_text}" is marked as contested and I won't guess ` +
        `which version is current. Can you confirm?`;
    }
  } else if (best && tier === 'high') {
    answer =
      `I'm fairly confident this is right: ${best.fact_text}. I'm relying on what you told me (${best.source}), ` +
      `last confirmed ${best.days_since_confirm === 0 ? 'today' : `${best.days_since_confirm} days ago`}.`;
  } else if (best && tier === 'medium') {
    unsure = true;
    answer =
      `I think it's true that ${best.fact_text}, but I'm not fully certain — this was last confirmed ` +
      `${best.days_since_confirm === 0 ? 'today' : `${best.days_since_confirm} days ago`} and my confidence has decayed.`;
  } else {
    // Effective < CONFIDENCE_LOW — explicit uncertainty.
    unsure = true;
    answer =
      `I might be wrong about this. I do have a memory that ${best?.fact_text}, ` +
      `but my confidence in it has dropped below my threshold and I'd rather not assert it. Could you confirm?`;
  }

  // Comma-wise, only surface meaningful memories (effective >= low threshold).
  const reliedOn = ranked
    .filter((m) => m.effective >= CONFIDENCE_LOW)
    .slice(0, 3)
    .map((m) => ({
      id: m.id,
      fact_text: m.fact_text,
      category: m.category,
      source: m.source,
      status: m.status,
      effective_confidence: m.effective,
      base_confidence: m.base_confidence,
      last_confirmed_at: m.last_confirmed_at,
      corroboration_count: m.corroboration_count,
    }));

  // -- Step 6: audit log ------------------------------------------------
  const surfacedIds = ranked.filter((m) => m.effective >= CONFIDENCE_LOW).slice(0, 3).map((m) => m.id);
  const detailIds = surfacedIds.length ? surfacedIds.join(', ') : best?.id ?? '';
  const detail = `Recalled ${detailIds || 'no usable memories'} for "${question}" with effective confidence ${best?.effective ?? 0}.`;

  for (const id of surfacedIds) {
    await logEvent(client, id, 'recall', detail);
  }
  if (!surfacedIds.length && best) {
    await logEvent(client, best.id, 'recall', detail);
  }

  return json({
    ok: true,
    answer,
    unsure,
    tier,
    best_effective_confidence: best?.effective ?? 0,
    effective_confidence: best?.effective ?? 0,
    relied_on: reliedOn,
    conflicts: conflictPairs.map(({ a, b }) => ({
      a: { id: a.id, fact_text: a.fact_text, effective_confidence: a.effective },
      b: { id: b.id, fact_text: b.fact_text, effective_confidence: b.effective },
    })),
    route,
  });
}