import { useState } from 'react';
import { resolveConflict } from '../api.js';
import ConfidenceMeter from './ConfidenceMeter.jsx';

// Shows a contested pair side by side. Choosing one resolves the conflict:
// the chosen memory returns to active with restored confidence, the other is
// permanently revoked (content wiped, per the privacy rule).
export default function ConflictCard({ pair, onResolved }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const choose = async (winnerId, loserId) => {
    setBusy(true);
    setError(null);
    try {
      const res = await resolveConflict(winnerId, loserId);
      onResolved?.(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <p className="text-sm font-semibold text-amber-300 mb-3">⚖️ Conflicting memories — which is correct?</p>
      <div className="flex flex-col sm:flex-row gap-3">
        <Walk side="memory A" m={pair?.a} otherId={pair?.b?.id} onChoose={(w, l) => choose(w, l)} busy={busy} />
        <Walk side="memory B" m={pair?.b} otherId={pair?.a?.id} onChoose={(w, l) => choose(w, l)} busy={busy} />
      </div>
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function Walk({ side, m, otherId, onChoose, busy }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-slate-700 bg-slate-900/60 p-4 flex-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-mono uppercase tracking-widest text-slate-500">{side}</span>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] font-mono uppercase text-amber-300">
          contested
        </span>
      </div>
      <p className="text-sm text-slate-100">{m.fact_text}</p>
      <ConfidenceMeter value={m.effective_confidence ?? 0} label="Effective confidence" />
      <button
        onClick={() => onChoose(m.id, otherId)}
        disabled={busy}
        className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-40 transition-colors"
      >
        Keep this one
      </button>
    </div>
  );
}