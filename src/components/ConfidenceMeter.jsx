export default function ConfidenceMeter({ value = 0, label = 'Confidence', showLabel = true }) {
  const clamped = Math.max(0, Math.min(100, value));
  const color =
    clamped >= 70 ? 'bg-emerald-500' : clamped >= 40 ? 'bg-amber-400' : 'bg-rose-500';
  const text =
    clamped >= 70 ? 'text-emerald-400' : clamped >= 40 ? 'text-amber-300' : 'text-rose-400';

  return (
    <div className="w-full">
      {showLabel && (
        <div className="flex justify-between items-center mb-1">
          <span className="text-xs text-slate-400">{label}</span>
          <span className={`text-sm font-semibold tabular-nums ${text}`}>{clamped}%</span>
        </div>
      )}
      <div className="h-2.5 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all duration-700`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}