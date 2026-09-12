// Shared response + CORS helpers for Pages Functions.

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function corsify(init = {}) {
  return { ...CORS_HEADERS, ...init };
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: corsify({ 'Content-Type': 'application/json' }),
  });
}

export function handleOptions() {
  return new Response(null, { status: 204, headers: corsify() });
}

export async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}