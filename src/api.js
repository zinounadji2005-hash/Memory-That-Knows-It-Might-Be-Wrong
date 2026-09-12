// Client-side API helpers. Calls are routed to Pages Functions at the same origin.
// No secrets are in this file — Gemini and Supabase keys live in functions/lib/.

const BASE = ''; // same origin — Pages Functions live under /api/*.

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function get(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export function remember(input, scope) {
  return post('/api/remember', { input, scope });
}

export function recall(question, scope) {
  return post('/api/recall', { question, scope });
}

export function forget(memoryId) {
  return post('/api/forget', { memory_id: memoryId });
}

export function resolveConflict(winnerId, loserId) {
  return post('/api/resolve-conflict', { winner_id: winnerId, loser_id: loserId });
}

export function inspector(scope = 'user:default') {
  return get(`/api/inspector?scope=${encodeURIComponent(scope)}`);
}