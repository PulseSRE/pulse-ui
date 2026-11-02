/**
 * One card per container with the facts a crash investigation needs, each
 * once: state now, how the last instance ended (reason, exit code, when, how
 * long it ran), image, limits/requests, probe timing, and links to the pull
 * secrets, PVCs, ConfigMaps and Secrets it depends on.
 */
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { Container, ContainerStatus, Pod } from '../../engine/types';
import { TONE_CLASSES } from '../../engine/statusColors';
import { formatDurationMs } from '../../engine/format';
import { containerRefs, currentStateText, lastTermination, probeTiming } from '../../engine/podFacts';

function Fact({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={cn('text-sm text-slate-200 break-words', className)}>{children}</div>
    </div>
  );
}

function resourcesText(c: Container): React.ReactNode {
  const r = c.resources;
  const cpu = `${r?.limits?.cpu ?? 'no limit'} / ${r?.requests?.cpu ?? 'no request'}`;
  const mem = `${r?.limits?.memory ?? 'no limit'} / ${r?.requests?.memory ?? 'no request'}`;
  return <span>cpu {cpu} · memory {mem} <span className="text-xs text-slate-500">(limit / request)</span></span>;
}

export function ContainerFacts({ pod, go }: { pod: K8sResource; go: (path: string, title: string) => void }) {
  const spec = pod.spec as Pod['spec'];
  const statuses: ContainerStatus[] = (pod.status as Pod['status'] | undefined)?.containerStatuses ?? [];
  const containers: Container[] = spec?.containers ?? [];

  return (
    <>
      {containers.map((c) => {
        const cs = statuses.find((s) => s.name === c.name);
        const term = lastTermination(cs);
        const refs = containerRefs(pod as never, c);
        const probes: Array<[string, Container['livenessProbe']]> = [
          ['Startup probe', c.startupProbe], ['Liveness probe', c.livenessProbe], ['Readiness probe', c.readinessProbe],
        ];
        return (
          <section key={c.name} aria-label={`Container ${c.name}`} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
            <h2 className="mb-3 text-sm font-semibold text-slate-100">
              Container <span className="font-mono font-medium">{c.name}</span>
            </h2>
            <div className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
              <Fact label="Now">{currentStateText(cs)}</Fact>
              <Fact label="Last termination" className={term && (term.exitCode ?? 0) !== 0 ? TONE_CLASSES.danger.text : undefined}>
                {term
                  ? [
                      term.reason,
                      `exit ${term.exitCode ?? '—'}`,
                      term.finishedAt ? new Date(term.finishedAt).toLocaleTimeString() : 'time unknown',
                      term.ranForMs !== null ? `ran ${formatDurationMs(term.ranForMs)}` : 'run time unknown',
                    ].join(' · ')
                  : 'None (this container has not restarted)'}
              </Fact>
              <Fact label="Image" className="font-mono text-xs">{c.image}</Fact>
              <Fact label="Resources">{resourcesText(c)}</Fact>
              {probes.map(([label, p]) => (p ? <Fact key={label} label={label}>{probeTiming(p)}</Fact> : null))}
              {!c.livenessProbe && !c.readinessProbe && !c.startupProbe && <Fact label="Probes">None</Fact>}
              <Fact label="Pull secret · volumes · config">
                {refs.length === 0 ? (
                  <span className="text-slate-500">None</span>
                ) : (
                  <span className="flex flex-wrap gap-x-2 gap-y-1">
                    {refs.map((r, i) => (
                      <span key={`${r.kind}/${r.name}`}>
                        <button
                          type="button"
                          onClick={() => go(r.path, r.name)}
                          className="text-blue-400 hover:text-blue-300 hover:underline"
                          title={r.use}
                        >
                          {r.kind === 'PersistentVolumeClaim' ? 'PVC' : r.kind} {r.name}
                        </button>
                        {i < refs.length - 1 && <span className="text-slate-600"> ·</span>}
                      </span>
                    ))}
                  </span>
                )}
              </Fact>
            </div>
          </section>
        );
      })}
    </>
  );
}
