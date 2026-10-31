import { AlertTriangle } from 'lucide-react';

/** Per-source failures in a merged log view: which pod/container, and why. */
export function MergedLogErrors({ label, errors }: { label: 'pod' | 'container'; errors: Array<{ source: string; error: string }> }) {
  if (errors.length === 0) return null;
  return (
    <div role="alert" className="border-b border-red-900/60 bg-red-950/30 px-3 py-2 text-xs text-red-200">
      {errors.map(({ source, error }) => (
        <div key={source} className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-400" aria-hidden="true" />
          <span>Could not load logs from {label} <strong>{source}</strong>: {error}</span>
        </div>
      ))}
    </div>
  );
}
