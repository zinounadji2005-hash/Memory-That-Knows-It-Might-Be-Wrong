// Server-side Gemini wrapper. Keys come from context.env (wrangler secrets),
// never from the frontend bundle. All calls use responseMimeType JSON.

const MODEL = 'gemini-3.5-flash';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export function getGeminiKey(env) {
  const key = env.GEMINI_API_KEY;
  if (!key) {
    throw new Error('GEMINI_API_KEY missing. Set it via `wrangler pages secret put GEMINI_API_KEY`.');
  }
  return key;
}

// Parse a model JSON string defensively: strip code fences, find the first
// {...} block, and fall back to the provided default when parsing fails.
export function generateObject(text, fallback) {
  if (!text) return fallback;
  let cleaned = String(text).trim();
  cleaned = cleaned.replace(/```(?:json)?/gi, '').replace(/```/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return fallback;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return fallback;
  }
}

// Generic structured completion: system prompt + user text, returns parsed JSON
// or a provided fallback if the model output can't be parsed.
export async function structuredCompletion(env, { systemPrompt, userText, fallback }) {
  const key = getGeminiKey(env);
  const res = await fetch(`${ENDPOINT}?key=${key}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error('Gemini error', res.status, body.slice(0, 500));
    return fallback;
  }

  const data = await res.json();
  try {
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('') ?? '';
    return generateObject(text, fallback);
  } catch (err) {
    console.error('Gemini parse error', err.message);
    return fallback;
  }
}

// -----------------------------------------------------------------------------
// Fact extraction prompt (Write Path step 2 in the brief)
// -----------------------------------------------------------------------------
const FACT_EXTRACT_SYSTEM = `You extract ONE factual claim from free-text user input and return it as strict JSON.

Rules:
- Normalize the claim into a terse, third-person statement (e.g. "lives in Paris", "is vegetarian").
- Do not invent facts not stated. If the input is a question or contains no claim, return fact_text: "". 
- confidence (0-100): how clearly and explicitly the user stated this. Direct statements about the user's own life are high (80-95). Hedgey or vague statements are lower (50-70).
- category is one of: "location", "preference", "diet", "contact", "other".

Respond ONLY as JSON, no markdown, no prose:
{"fact_text": string, "category": string, "confidence": number, "is_claim": boolean}`;

export async function extractFact(env, rawInput, fallback) {
  const parsed = await structuredCompletion(env, {
    systemPrompt: FACT_EXTRACT_SYSTEM,
    userText: `Input: "${rawInput}"`,
    fallback,
  });
  if (parsed && parsed.is_claim === false) return null;
  if (parsed && parsed.fact_text) return parsed;
  return null;
}

// -----------------------------------------------------------------------------
// Contradiction / confirmation check (Write Path step 4 in the brief)
// -----------------------------------------------------------------------------
const RELATION_SYSTEM = `You compare a NEW fact against an EXISTING memory and decide whether the new fact confirms it, contradicts it, or is unrelated.

Return strict JSON:
{"relation": "confirm" | "contradict" | "unrelated", "reason": string}

- "confirm": same underlying claim, consistent detail, or a natural extension that strengthens it.
- "contradict": mutually exclusive claims about the same thing (e.g. "lives in Paris" vs "lives in Berlin").
- "unrelated": different claim, no real conflict, e.g. a preference that doesn't touch an existing fact.

Be conservative: only "contradict" when the facts are genuinely mutually exclusive. Respond ONLY as JSON.`;

export async function classifyRelation(env, newFactText, newCategory, existingFactText) {
  const fallback = { relation: 'unrelated', reason: 'fallback: treated as unrelated' };
  return structuredCompletion(env, {
    systemPrompt: RELATION_SYSTEM,
    userText: `New fact (category ${newCategory}): "${newFactText}"\nExisting memory (category ${newCategory}): "${existingFactText}"`,
    fallback,
  });
}

// -----------------------------------------------------------------------------
// Question routing (Retrieval Path step 2 in the brief)
// -----------------------------------------------------------------------------
const ROUTE_SYSTEM = `Decide which memory scope and category a user's question is asking about.

Return strict JSON:
{"scope": "user:default", "category": string | null, "keywords": string[]}

category must be one of: "location", "preference", "diet", "contact", "other", or null if the question is about nothing specific. Respond ONLY as JSON.`;

export async function routeQuestion(env, question, fallback) {
  return structuredCompletion(env, {
    systemPrompt: ROUTE_SYSTEM,
    userText: `Question: "${question}"`,
    fallback,
  });
}