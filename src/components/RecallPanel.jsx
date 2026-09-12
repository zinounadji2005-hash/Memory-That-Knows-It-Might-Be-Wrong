import { useEffect, useRef, useState } from 'react';
import { recall, remember } from '../api.js';
import ConfidenceMeter from './ConfidenceMeter.jsx';
import UnsureBanner from './UnsureBanner.jsx';
import ConflictCard from './ConflictCard.jsx';

const QUESTIONS = [
  'Where do I live?',
  'What do I like to eat?',
  'Do I have a seat preference?',
  'What do you remember about me?',
];

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

export default function RecallPanel({ onEvent }) {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [resolvedMsg, setResolvedMsg] = useState(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  const initialAsked = useRef(false);

  const ask = async (q) => {
    const value = (q ?? question).trim();
    if (!value || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setResolvedMsg(null);
    try {
      const res = await recall(value);
      setResult(res);
      onEvent(res.answer);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  // Auto-run a trivial "what do you remember about me?" once on first mount
  // so the panel demos immediately.
  useEffect(() => {
    if (!initialAsked.current) {
      initialAsked.current = true;
      ask('What do you remember about me?');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirmMemory = async () => {
    const fact = result?.relied_on?.[0]?.fact_text;
    if (!fact) return;
    setConfirmBusy(true);
    try {
      const res = await remember(fact);
      setResolvedMsg(res.message);
      const fresh = await recall(question || 'What do you remember about me?');
      setResult(fresh);
      onEvent(res.message);
    } catch (err) {
      setError(err.message);
    } finally {
      setConfirmBusy(false);
    }
  };

  const pair = result?.conflicts?.[0];

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold text-white">🔍 Ask it something</h2>
        <p className="text-sm text-slate-400 mt-1">
          Answers reflect effective confidence after time-decay, cite what they rely on, and
          visibly show when I'm not sure.
        </p>
      </div>

      <div className="flex gap-2">
        <input
          className="flex-1 rounded-lg border border-slate-700 bg-slate-900 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 placeholder-slate-500"
          placeholder='e.g. "Where do I live?"'
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button
          onClick={() => ask()}
          disabled={busy || !question.trim()}
          className="rounded-lg bg-indigo-500 px-5 py-3 text-sm font-semibold text-white hover:bg-indigo-400 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {busy ? 'Thinking…' : 'Ask'}
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        {QUESTIONS.map((q) => (
          <button
            key={q}
            onClick={() => { setQuestion(q); ask(q); }}
            disabled={busy}
            className="rounded-full border border-slate-700 bg-slate-800/50 px-3 py-1.5 text-xs text-slate-300 hover:border-indigo-400 hover:text-white transition-colors"
          >
            {q}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3 text-sm text-rose-300">{error}</div>
      )}

      {result && (
        <div className="space-y-4">
          <div className="rounded-lg border border-slate-800 bg-slate-900/70 p-5">
            <p className="text-sm text-slate-200 leading-relaxed">{result.answer}</p>

            <div className="mt-4">
              <ConfidenceMeter value={result.effective_confidence} label="Effective confidence (time-decayed)" />
              <p className="mt-1 text-[10px] text-slate-600 font-mono">
                base − decay · contested capped at 45 · stale below 15
              </p>
            </div>
          </div>

          {result.unsure && <UnsureBanner detail={result.answer} />}

          {pair && <ConflictCard pair={pair} onResolved={onConflictResolved} />}

          {result.unsure && !pair && result.relied_on?.[0] && (
            <button
              onClick={confirmMemory}
              disabled={confirmBusy}
              className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-2 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors"
            >
              {confirmBusy ? 'Confirming…' : "Actually, I'm sure — confirm it"}
            </button>
          )}

          {result.relied_on && result.relied_on.length > 0 && (
            <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
              <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 mb-2">Relying on</p>
              <ul className="space-y-2">
                {result.relied_on.map((r) => (
                  <li key={r.id} className="flex items-start justify-between gap-3 text-sm">
                    <span className="text-slate-300">“{r.fact_text}”</span>
                    <span className="text-xs text-slate-500 whitespace-nowrap">
                      {r.source} · confirmed {fmtDate(r.last_confirmed_at)} · {r.effective_confidence}%
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {resolvedMsg && (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          {resolvedMsg}
        </div>
      )}
    </section>
  );

  function onConflictResolved(res) {
    setResolvedMsg(res.message);
    setResult(null);
    onEvent(res.message);
  }
}