import { useState } from 'react';
import { remember } from '../api.js';

const SUGGESTIONS = [
  'I live in Paris',
  "I'm vegetarian",
  'I prefer window seats',
  'I moved to Berlin',
  "I don't eat red meat anymore",
];

export default function FactInput({ onEvent }) {
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const submit = async (text) => {
    const value = (text ?? input).trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await remember(value);
      setResult(res);
      onEvent(res.message);
      setInput('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const isContradiction = result?.outcome === 'contradiction';
  const isConfirm = result?.outcome === 'confirm';
  const isNoClaim = result?.outcome === 'no_claim';

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">✍️ Tell it something</h2>
        <p className="text-sm text-slate-400 mt-1">
          State a fact about yourself. It will be extracted, categorized, tagged with a confidence
          score — and checked against what I already know.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
          placeholder='e.g. "I live in Paris" or "I moved to Berlin"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
        <button
          onClick={() => submit()}
          disabled={busy || !input.trim()}
          className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Thinking…' : 'Remember'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            onClick={() => submit(s)}
            disabled={busy}
            className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-400 hover:text-white transition-colors"
          >
            {s}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">
          {error}
        </div>
      )}

      {result && (
        <div
          className={`rounded-lg border px-4 py-4 ${
            isContradiction
              ? 'border-amber-500/40 bg-amber-500/10'
              : isNoClaim
                ? 'border-slate-700 bg-slate-900'
                : 'border-emerald-500/40 bg-emerald-500/10'
          }`}
        >
          <p className={`text-sm font-medium ${isContradiction ? 'text-amber-300' : isNoClaim ? 'text-slate-300' : 'text-emerald-300'}`}>
            {result.message}
          </p>

          {isContradiction && (
            <div className="mt-4 space-y-3">
              <p className="text-xs text-slate-400">Both are now flagged <span className="font-mono text-amber-300">contested</span> pending your call:</p>
              {(result.involved || []).map((m) => (
                <div key={m.id} className="rounded-md border border-amber-500/30 bg-slate-900/60 p-3">
                  <div className="flex items-center justify-between">
                    <p className="text-sm text-slate-200">{m.fact_text || '(revoked)'}</p>
                    <span className="rounded-full border border-amber-500/40 px-2 py-0.5 text-[10px] font-mono uppercase text-amber-300">
                      contested
                    </span>
                  </div>
                </div>
              ))}
              <p className="text-xs text-slate-500">
                Next step: ask something, then resolve the conflict in the Memory Inspector — or just tell me which is right.
              </p>
            </div>
          )}

          {isConfirm && (
            <p className="mt-2 text-xs text-emerald-200/70">
              Corroboration count: {result.corroboration_count} · base confidence now {result.base_confidence}%
            </p>
          )}
        </div>
      )}
    </section>
  );
}