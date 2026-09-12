import { useEffect, useState } from 'react';
import { inspector, remember, forget } from '../api.js';
import ConfidenceMeter from './ConfidenceMeter.jsx';
import ConflictCard from './ConflictCard.jsx';

const STATUS_STYLE = {
  active: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  contested: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  stale: 'bg-slate-500/15 text-slate-400 border-slate-500/40',
  revoked: 'bg-rose-500/15 text-rose-300 border-rose-500/40',
};

const EVENT_DOT = {
  write: 'bg-emerald-400',
  confirm: 'bg-sky-400',
  contradict: 'bg-amber-400',
  recall: 'bg-indigo-400',
  decay: 'bg-slate-400',
  revoke: 'bg-rose-400',
  resolve: 'bg-violet-400',
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

export default function MemoryInspector({ refreshKey, onEvent }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [conflictPair, setConflictPair] = useState(null);

  const load = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await inspector();
      setData(res);
      setConflictPair(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  if (busy && !data)
    return (
      <section>
        <h2 className="text-lg font-semibold text-white">🗂️ Memory Inspector</h2>
        <p className="text-sm text-slate-400 mt-3 animate-pulse">Loading your memories…</p>
      </section>
    );

  if (error && !data)
    return (
      <section>
        <h2 className="text-lg font-semibold text-white">🗂️ Memory Inspector</h2>
        <p className="text-sm text-rose-300 mt-3">{error}</p>
      </section>
    );

  const memories = data?.memories ?? [];
  const contested = memories.filter((m) => m.status === 'contested' && m.fact_text);
  const active = memories.filter((m) => m.status === 'active' && m.fact_text);
  const stale = memories.filter((m) => m.status === 'stale' && m.fact_text);

  const confirmMemory = async (m) => {
    setBusyId(m.id);
    try {
      const res = await remember(m.fact_text);
      onEvent(res.message);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const forgetMemory = async (m) => {
    setBusyId(m.id);
    try {
      const res = await forget(m.id);
      onEvent(res.message);
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const MemoryRow = ({ m }) => (
    <div className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`rounded-full border px-2 py-0.5 text-[10px] font-mono uppercase ${STATUS_STYLE[m.status] || STATUS_STYLE.active}`}>
              {m.status}
            </span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-[10px] font-mono uppercase text-slate-400">
              {m.category || '?'}
            </span>
            <span className="text-[10px] text-slate-600 font-mono">{m.source}</span>
          </div>
          <p className="text-sm text-slate-100 mt-2">{m.fact_text}</p>
          <p className="text-xs text-slate-500 mt-1">
            {m.status === 'active' ? 'last confirmed' : 'created'} {fmtDate(m.last_confirmed_at || m.created_at)} ·
            corroborated ×{m.corroboration_count}
            {m.days_since_confirm != null && m.days_since_confirm > 0.4
              ? ` · ${m.days_since_confirm} days since confirm`
              : ''}
          </p>
        </div>
        <div className="w-36 shrink-0">
          <ConfidenceMeter value={m.effective_confidence ?? 0} showLabel={false} />
        </div>
      </div>
      {m.status === 'active' && (
        <div className="flex gap-2">
          <button
            onClick={() => confirmMemory(m)}
            disabled={busyId === m.id}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-500/20 transition-colors disabled:opacity-40"
          >
            ✓ Confirm
          </button>
          <button
            onClick={() => forgetMemory(m)}
            disabled={busyId === m.id}
            className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-300 hover:bg-rose-500/20 transition-colors disabled:opacity-40"
          >
            🗑 Forget this
          </button>
        </div>
      )}
    </div>
  );

  const pairFor = (m) => {
    const other = memories.find((o) => o.id === m.contradicted_by && o.fact_text);
    if (!other) return null;
    return {
      a: { id: m.id, fact_text: m.fact_text, effective_confidence: m.effective_confidence },
      b: { id: other.id, fact_text: other.fact_text, effective_confidence: other.effective_confidence },
    };
  };

  return (
    <section className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">🗂️ Memory Inspector</h2>
          <p className="text-sm text-slate-400 mt-1">
            What do you remember about me? Confidence below is live-decayed — it changes with time.
          </p>
        </div>
        <button
          onClick={load}
          disabled={busy}
          className="rounded-md border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-300 hover:text-white transition-colors disabled:opacity-40"
        >
          {busy ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      {error && <p className="text-sm text-rose-300">{error}</p>}

      {conflictPair && (
        <ConflictCard pair={conflictPair} onResolved={(res) => { onEvent(res.message); setConflictPair(null); setBusy(true); load(); }} />
      )}

      {data && (
        <div className="grid sm:grid-cols-2 gap-3">
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center">
            <p className="text-2xl font-bold text-emerald-400">{active.length}</p>
            <p className="text-xs text-slate-400">active</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center">
            <p className="text-2xl font-bold text-amber-400">{contested.length}</p>
            <p className="text-xs text-slate-400">contested</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center">
            <p className="text-2xl font-bold text-slate-300">{stale.length}</p>
            <p className="text-xs text-slate-400">stale</p>
          </div>
          <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3 text-center">
            <p className="text-2xl font-bold text-rose-400">{data.revoked_count ?? 0}</p>
            <p className="text-xs text-slate-400">forgotten (content wiped)</p>
          </div>
        </div>
      )}

      {memories.length === 0 && (
        <div className="rounded-lg border border-dashed border-slate-700 p-8 text-center text-sm text-slate-500">
          No memories yet. Tell me something about yourself in the first tab.
        </div>
      )}

      {contested.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-amber-400/70">⚠ Contested — resolve below</p>
          {contested.map((m) => {
            const p = pairFor(m);
            if (!p) return null;
            if (conflictPair || m.id > p.b.id) return null;
            return (
              <button
                key={m.id + p.b.id}
                onClick={() => setConflictPair(p)}
                disabled={busyId === m.id}
                className="w-full rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-left text-sm text-amber-200 hover:bg-amber-500/10 transition-colors"
              >
                ⚖️ “{p.a.fact_text}” vs “{p.b.fact_text}” — <span className="underline">resolve</span>
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-2">
        <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">Active memories</p>
        {active.map((m) => <MemoryRow key={m.id} m={m} />)}
      </div>

      {stale.length > 0 && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500">
            Stale (never answered confidently, awaiting you to re-confirm or delete)
          </p>
          {stale.map((m) => <MemoryRow key={m.id} m={m} />)}
        </div>
      )}

      {data && (
        <div className="space-y-2">
          <p className="text-[10px] font-mono uppercase tracking-widest text-slate-500 pt-2">
            📜 Audit log ({data.events?.length ?? 0} recent events — revocations contain no content)
          </p>
          <ul className="space-y-1.5">
            {(data.events ?? []).slice(0, 25).map((e) => (
              <li key={e.id} className="flex items-start gap-2 text-xs">
                <span className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${EVENT_DOT[e.event_type] || 'bg-slate-400'}`} />
                <span className="font-mono text-[10px] text-slate-500 shrink-0">{fmtDate(e.created_at)} {fmtTime(e.created_at)}</span>
                <span className="text-slate-300">
                  <span className="font-mono text-[10px] uppercase text-slate-500">{e.event_type}</span>{' '}
                  {e.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}