# Memory That Knows It Might Be Wrong

A confidence-aware agent memory layer for the *Memory That Knows It Might Be Wrong* hackathon challenge.

The idea in one sentence: **every fact carries a source, a dynamic confidence score, a freshness, and an explicit forgetting policy — and the system knows when to say "I might be wrong."**

This is deliberately **not** plain vector RAG. There is no embedding index and no similarity search. Facts are structured rows with a category and scope, and the *product* is the confidence model, the contradiction handling, and the real forgetting — not retrieval.

---

## Stack

| Layer | Tech |
| --- | --- |
| Hosting / runtime | Cloudflare Pages + Pages Functions (single project, no separate server) |
| Frontend | React 19 + Tailwind CSS v4 + Vite |
| Database | Supabase (PostgreSQL) — `memories` + `memory_events` audit log |
| AI inference | Gemini `gemini-3.5-flash`, called only from Pages Functions, server-side, `responseMimeType: "application/json"` |
| Secrets | `GEMINI_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` via `wrangler pages secret put`, read through `context.env` — never in the frontend bundle |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────────┐
│  Browser (React SPA — 3 purpose-built panels, no infinite chat log)      │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────────┐     │
│  │ FactInput    │  │ RecallPanel  │  │ MemoryInspector + Audit Log │     │
│  │ Tell facts   │  │ Ask + meters │  │ Confirm / Forget / Resolve  │     │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┬──────────────┘     │
└─────────┼─────────────────┼─────────────────────────┼────────────────────┘
          │ POST /remember  │ POST /recall            │ GET /inspector     │
          ▼                 ▼                         │ POST /forget       │
┌──────────────────────────────────────────────────────┴────────────────────┐
│ Cloudflare Pages Functions (functions/api/*.js)                           │
│                                                                            │
│  ┌───────────┐  ┌──────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ remember  │  │  recall  │  │   forget    │  │ resolve-con │            │
│  │  WRITE    │  │ RETRIEVE │  │   REVOKE    │  │  flict      │            │
│  │           │  │  +decay  │  │  (privacy)  │  │  (resolve)  │            │
│  └─────┬─────┘  └────┬─────┘  └──────┬──────┘  └──────┬──────┘            │
│        │             │               │                │                   │
│  ┌─────▼─────────────▼───────────────▼────────────────▼──────┐            │
│  │ functions/lib/                                            │            │
│  │   gemini.js      — structured JSON extraction + relation  │            │
│  │   confidence.js  — decay math + thresholds                │            │
│  │   supabase.js    — server-side client                     │            │
│  │   http.js        — CORS / JSON helpers                    │            │
│  └──────────────────────────────┬────────────────────────────┘            │
└─────────────────────────────────┼────────────────────────────────────────┘
                                  ▼
                 ┌────────────────────────────────┐
                 │  Supabase (two tables, no RAG) │
                 │  memories        + memory_events│
                 └────────────────────────────────┘
```

### The Three Paths

```
┌─ WRITE PATH (POST /api/remember) ─────────────────────────────────────────┐
│ free text ─► Gemini extracts {fact_text, category, confidence}            │
│     ▼                                                                     │
│ load same-scope same-category active/contested memories                   │
│     ▼                                                                     │
│ Gemini classifies each: confirm | contradict | unrelated                  │
│     ├─ contradict ─► BOTH set status='contested', contradicted_by=each    │
│     │                other, base_confidence −30, 'contradict' events      │
│     ├─ confirm    ─► corroboration_count+1, base_confidence +10,          │
│     │                last_confirmed_at=now, 'confirm' event               │
│     └─ new/unrel. ─► insert status='active', 'write' event                │
└────────────────────────────────────────────────────────────────────────────┘

┌─ RETRIEVAL PATH (POST /api/recall) ────────────────────────────────────────┐
│ question ─► Gemini routes to {category, scope, keywords}                  │
│     ▼                                                                     │
│ fetch active+contested memories for scope(/category)                      │
│     ▼                                                                     │
│ recompute effective confidence (time decay, contested cap)                │
│     ▼                                                                     │
│ eff < 15  ─► flip to 'stale' on this read, exclude from answers,          │
│              log 'decay' event                                            │
│     ▼                                                                     │
│ answer by tier + log 'recall' audit event (which ids, at what confidence) │
│   ≥70  ─► state directly, cite source + last-confirmed date               │
│  40-69 ─► "I believe X, not fully certain — last confirmed N days ago"    │
│  <40 or contested ─► "I MIGHT BE WRONG" + surface both contested facts,   │
│                      ask which is correct (never guess)                   │
└────────────────────────────────────────────────────────────────────────────┘

┌─ FORGETTING PATH (three explicit mechanisms, never conflated) ─────────────┐
│ 1. STALE        time decay suppresses confidence; on a read below         │
│                 STALE_FLOOR(15) status→'stale', excluded from confident   │
│                 answers; 'decay' event logged. No deletion needed.        │
│ 2. CONTRADICTED write path flags both contested; resolved explicitly via  │
│                 POST /api/resolve-conflict — winner→active restored,      │
│                 loser→revoked WITH fact_text nulled (privacy rule).       │
│ 3. REVOKED      POST /api/forget: user command or Inspector button.       │
│                 Clears fact_text + zeroes confidence immediately,         │
│                 status='revoked', 'revoke' event logged with CATEGORY     │
│                 ONLY. Irreversible: a revoked memory is never resurfaced, │
│                 even if decay math would otherwise resurrect it.          │
└────────────────────────────────────────────────────────────────────────────┘
```

### Confidence decay formula

```
eff(t) = max(0, round(base_confidence − decay(t)))

decay(t) = min(40, days-since-last-confirmed × 2)        // ~2 pts/day, capped
contested facts:  eff = min(eff, 45)                      // never reads confident
stale below:      eff < 15  → status becomes 'stale' on next read
confirm bump:     base_confidence = min(100, base + 10)   // user corroboration
contradiction:    base_confidence = max(0, base − 30)     // applied to both sides
resolve winner:   base_confidence restored (+30), then +1 corroboration
```

Effective confidence is **never stored** — it is recomputed on every read from
`base_confidence` and `last_confirmed_at`, so confidence is visibly dynamic
over time and needs no cron job.

---

## Local setup

Prereqs: Node 20+, a Supabase project, a Gemini API key, a Cloudflare account.

```bash
# 1. Install
npm install

# 2. Apply the schema
#    Open supabase/schema.sql in your Supabase SQL editor and run it.

# 3. Set secrets (never commit these)
npx wrangler pages secret put SUPABASE_URL
npx wrangler pages secret put SUPABASE_SERVICE_KEY
npx wrangler pages secret put GEMINI_API_KEY

# 4. Build the SPA + run the full stack locally
npm run build
npx wrangler pages dev dist
#    open http://localhost:8788
```

Deploy:

```bash
npm run build
npx wrangler pages deploy dist --project-name memory-that-knows
```

---

## The 90-second demo script

Do exactly this, in order, in front of a judge — each bold step lands on its own.

1. **Tell it something** (✍️) — state
   `I live in Paris`, `I'm vegetarian`, `I prefer window seats when I fly`.
   Each is noted with its category and confidence.
2. **Ask it something** (🔍) — ask
   `Where do I live?` → a confident answer appears, citing *user_stated* and
   the last-confirmed date, with a green confidence meter.
3. **Tell it something** — state
   `I moved to Berlin`. → "This contradicts what I knew before — flagging both
   for review." Both Paris and Berlin now show as **contested**.
4. **Ask it something** — ask
   `Where do I live?` again. → **THE MOMENT:** the app *explicitly says* "I
   might be wrong about this," surfaces both memories, and asks which one to
   keep. It does not pick a side.
5. **Open the Memory Inspector** — click **Keep this one → Berlin** in the
   conflict card. Paris is revoked and its content wiped; Berlin returns to
   active with restored confidence.
6. **Tell it something** or use the Inspector — say/do
   `forget my diet preference`. It disappears from the Inspector instantly.
   Scroll the audit log: the `revoke` row says only *"User revoked a 'diet'
   memory. Content intentionally not retained."* — proof of real privacy.

### Documented failure test (all three paths, with proof)

| Failure | What you state/do | What happens | Evidenced by |
| --- | --- | --- | --- |
| Contradiction | "I live in Paris" then "I moved to Berlin" | both flagged contested, recall says "I might be wrong", never guesses | `memory_events` rows `event_type='contradict'` + recall output |
| Stale data | create a low-confidence fact, wait, or set last_confirmed_at old in the DB | effective confidence decays; below 15 it flips to `stale` and is excluded from confident answers | `decay` event + Inspector shows `stale` |
| Privacy revocation | "forget my diet preference" | `memories.fact_text` becomes NULL, status `revoked`, retrieval never resurfaces it | `memories` row content nulled + `revoke` event with category-only detail |

---

## Project layout

```
functions/
  lib/  supabase.js · gemini.js · confidence.js · http.js
  api/  remember.js · recall.js · forget.js · resolve-conflict.js · inspector.js
src/
  api.js
  App.jsx · main.jsx · index.css
  components/ FactInput · RecallPanel · ConfidenceMeter · UnsureBanner ·
              MemoryInspector · ConflictCard
data/seed-conversations.json
supabase/schema.sql
wrangler.toml
```

## Docs

- `THESIS.md` — the point of view (≤300 words)
- `NOTES.md` — build notes, AI tools used, key decisions, out of scope

## Deliverables checklist

- [x] Clean clone → `npm install && npm run build` works
- [x] Live Cloudflare Pages URL (pending final deploy)
- [x] README architecture: write / retrieval / forgetting paths + decay formula + demo script
- [x] `NOTES.md` with AI tools, key decisions, out of scope
- [x] Documented failure test: contradiction, stale, and privacy revocation
- [x] `THESIS.md` ≤ 300 words
- [x] Memory Inspector (bonus signal)
- [x] Privacy control (forget) demoed live, content never retained (bonus signal)