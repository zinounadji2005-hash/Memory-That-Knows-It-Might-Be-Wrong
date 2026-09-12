// Visually distinct "I might be wrong about this" state.
// Shown when a recall lands below the confidence threshold or on contested facts.
export default function UnsureBanner({ detail }) {
  return (
    <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <span className="text-xl leading-none mt-0.5">⚠️</span>
        <div>
          <p className="text-sm font-semibold text-rose-300">I might be wrong about this.</p>
          {detail && <p className="text-sm text-rose-200/80 mt-1">{detail}</p>}
        </div>
      </div>
    </div>
  );
}