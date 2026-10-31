/**
 * FleetComparePage — the one place to compare clusters.
 *
 * Fleet Compare (cluster configuration snapshot), Compliance's
 * "Configuration Drift" table and the Drift Detector (one resource across
 * clusters) checked overlapping things on three pages. They are now two modes
 * of this page:
 *   - Configuration (`?mode=config`, default): the cluster-config preset —
 *     version, identity providers, TLS, encryption, scheduler, ingress, RBAC.
 *   - Resource (`?mode=resource`): one named resource across all clusters.
 * /fleet/drift redirects to `?mode=resource`.
 */
import { useSearchParams } from 'react-router-dom';
import { cn } from '@/lib/utils';
import CompareView from './CompareView';
import { DriftDetectorView } from './DriftDetectorView';
import { FleetSubNav } from './FleetSubNav';

export type CompareMode = 'config' | 'resource';

export default function FleetComparePage() {
  const [params, setParams] = useSearchParams();
  const mode: CompareMode = params.get('mode') === 'resource' ? 'resource' : 'config';
  const setMode = (m: CompareMode) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (m === 'config') next.delete('mode'); else next.set('mode', m);
    return next;
  }, { replace: true });

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-4">
        <FleetSubNav />
        <div>
          <h1 className="text-2xl font-bold text-slate-100">Compare &amp; Drift</h1>
          <p className="text-sm text-slate-400 mt-1">
            Compare cluster configuration, or one resource, across connected clusters.
          </p>
        </div>
        <div role="radiogroup" aria-label="Compare mode" className="inline-flex gap-1 rounded-lg border border-slate-800 bg-slate-900 p-1">
          {([
            ['config', 'Cluster configuration'],
            ['resource', 'One resource'],
          ] as const).map(([m, label]) => (
            <button
              key={m}
              role="radio"
              aria-checked={mode === m}
              onClick={() => setMode(m)}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
                mode === m ? 'bg-blue-600 text-white' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        {mode === 'config' ? <CompareView /> : <DriftDetectorView />}
      </div>
    </div>
  );
}
