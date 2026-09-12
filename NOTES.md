# Notes

## AI tools used

- **opencode + big-pickle model**: scaffolded the full project structure, wrote all files, resolved lint issues, and implemented all three backend paths with contradiction detection in a single session.
- **Gemini `gemini-3.5-flash`**: used at runtime (server-side only) for fact extraction, contradiction/confirmation classification, and question routing — all via structured JSON responses (`responseMimeType: "application/json"`).

## Key design decisions

1. **No vector search, no embeddings.** Every fact is a structured row with a category and scope. Gemini classifies new facts against existing ones relationally. This sidesteps embedding drift and makes confidence/forgetting the real product, not an afterthought bolted onto a retrieval index.

2. **Effective confidence is recomputed, never stored.** `base_confidence` and `last_confirmed_at` are persisted; effective confidence is derived from them on every read. This makes time-decay dynamic with zero background jobs.

3. **Three distinct forgetting mechanisms, never conflated.** Stale = time decay. Contradicted = user resolves a conflict. Revoked = explicit privacy erase. They are three different operations with three different UX surfaces, not a single "delete" button.

4. **Privacy-first revocation.** When a memory is revoked, `fact_text` is NULLed. The `memory_events` audit log stores only the category ("User revoked a 'diet' memory"), never the raw content. This is enforced in `forget.js` and `resolve-conflict.js`.

5. **Contested memories are capped at 45% effective confidence.** A disputed fact must never read as confident, regardless of how recently it was confirmed.

6. **Dedicated purpose-built UI, not a chat window.** Three panels: state facts, ask questions with visible confidence, inspect all memories. The brief explicitly rewards surfacing structure over conversation logs.

## Out of scope

- Multi-user authentication / identity — the demo uses a single hardcoded scope (`user:default`)
- Background workers or scheduled decay jobs — all decay is on-read recomputation
- Embedding-based semantic recall — facts are retrieved by category, not vector similarity
- End-to-end tests — the demo is manual against a real Supabase instance + Cloudflare Pages
- Custom domain / production deployment — wrangler pages deploy to a Cloudflare Pages project URL is sufficient for the hackathon