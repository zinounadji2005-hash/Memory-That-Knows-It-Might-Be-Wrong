import { useState } from 'react';
import FactInput from './components/FactInput.jsx';
import RecallPanel from './components/RecallPanel.jsx';
import MemoryInspector from './components/MemoryInspector.jsx';

const TABS = [
  { id: 'tell', label: 'Tell it something', icon: '✍️', desc: 'State a fact about yourself' },
  { id: 'ask', label: 'Ask it something', icon: '🔍', desc: 'Ask a question that relies on memory' },
  { id: 'inspect', label: 'Memory Inspector', icon: '🗂️', desc: 'What do you remember about me?' },
];

export default function App() {
  const [tab, setTab] = useState('tell');
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastEvent, setLastEvent] = useState(null);

  const bump = (event) => {
    setRefreshKey((k) => k + 1);
    if (event) setLastEvent(event);
  };

  return (
    <div className="min-h-screen bg-[#0b1020] text-slate-200">
      <header className="border-b border-slate-800 bg-[#0f1526]/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-6 py-5">
          <div className="flex items-baseline justify-between">
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight">
                Memory That Knows It Might Be Wrong
              </h1>
              <p className="text-xs text-slate-400 mt-1">
                Every fact carries a source, a confidence score, a freshness — and the right to be doubted or forgotten.
              </p>
            </div>
            <span className="text-[10px] uppercase tracking-widest text-slate-500 font-mono">
              confidence-aware memory layer
            </span>
          </div>
        </div>
      </header>

      <nav className="border-b border-slate-800">
        <div className="max-w-5xl mx-auto px-6 flex gap-1">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px focus:outline-none ${
                tab === t.id
                  ? 'border-indigo-400 text-white bg-indigo-400/5'
                  : 'border-transparent text-slate-400 hover:text-slate-200'
              }`}
            >
              <span className="mr-2">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {lastEvent && (
        <div className="max-w-5xl mx-auto px-6 pt-4">
          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/10 px-4 py-2.5 text-sm text-indigo-200 flex items-start gap-2">
            <span>💬</span>
            <span>{lastEvent}</span>
          </div>
        </div>
      )}

      <main className="max-w-5xl mx-auto px-6 py-8">
        {tab === 'tell' && <FactInput onEvent={bump} />}
        {tab === 'ask' && <RecallPanel onEvent={bump} />}
        {tab === 'inspect' && (
          <MemoryInspector refreshKey={refreshKey} onEvent={bump} />
        )}
      </main>

      <footer className="max-w-5xl mx-auto px-6 py-8 text-center text-xs text-slate-600">
        Not a chat log — a structured memory with confidence, contradictions, and real forgetting.
      </footer>
    </div>
  );
}