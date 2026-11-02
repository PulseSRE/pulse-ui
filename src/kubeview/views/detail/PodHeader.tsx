/**
 * The top of the pod page (under the name and status badge): what owns it at
 * which revision and where it runs, then the three numbers that usually explain a
 * crash — how the last instance ended, how often it restarted, and memory
 * used against the limit. A number that could not be read is "—" with why.
 */
import { cn } from '@/lib/utils';
import type { K8sResource } from '../../engine/renderers';
import type { Pod } from '../../engine/types';
import { StatCard } from '../../components/primitives/StatCard';
import { TONE_CLASSES } from '../../engine/statusColors';
import { formatBytes } from '../../engine/format';
import { parseMem } from '../../engine/formatting';
import { primaryContainer, lastTermination } from '../../engine/podFacts';
import type { PodOwner } from './usePodOwner';
import type { UsageResult } from './usePodUsage';

interface PodHeaderProps {
  pod: K8sResource;
  owner: PodOwner | null;
  usage: UsageResult | undefined;
  usageLoading: boolean;
  go: (path: string, title: string) => void;
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} className="text-blue-400 hover:text-blue-300 hover:underline">{children}</button>;
}

export function PodHeader({ pod, owner, usage, usageLoading, go }: PodHeaderProps) {
  const spec = pod.spec as Pod['spec'];
  const status = pod.status as Pod['status'] | undefined;
  const ns = pod.metadata.namespace || '';
  const primary = primaryContainer(pod as never);
  const term = lastTermination(primary?.status);
  const restarts = (status?.containerStatuses ?? []).reduce((n, c) => n + (c.restartCount || 0), 0);
  const node = spec?.nodeName;
  const container = spec?.containers?.find((c) => c.name === primary?.name);
  const limit = container?.resources?.limits?.memory;
  const multi = (spec?.containers?.length ?? 0) > 1;

  let memValue: React.ReactNode = '—';
  let memSub: React.ReactNode = undefined;
  if (usageLoading) {
    memValue = '…';
  } else if (!usage || usage.state !== 'ok') {
    memSub = `Unknown: ${usage && usage.state === 'unknown' ? usage.reason : 'not measured'}`;
  } else if (primary && usage.memory[primary.name] !== undefined) {
    const p95 = usage.memory[primary.name];
    const over = !!limit && p95 >= parseMem(limit) * 0.9;
    memValue = (
      <span>
        {formatBytes(p95)} / <span className={cn(over && TONE_CLASSES.danger.text)}>{limit ? limit : 'no limit'}</span>
      </span>
    );
    memSub = `p95 over 6h${multi ? ` · container ${primary.name}` : ''}`;
  } else {
    memSub = `Unknown: no samples for container ${primary?.name ?? ''}`;
  }

  return (
    <section aria-label="Pod status" className="flex flex-wrap items-start gap-x-6 gap-y-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <div className="text-sm text-slate-400" data-testid="pod-lineage">
          Pod in <Link onClick={() => go(`/project/${encodeURIComponent(ns)}`, ns)}>{ns}</Link>
          {owner ? (
            <>
              {' · owned by '}
              <Link onClick={() => go(owner.path, owner.name)}>{owner.kind} {owner.name}</Link>
              {owner.revision
                ? ` (revision ${owner.revision})`
                : owner.revisionUnknown ? ` (revision unknown: ${owner.revisionUnknown})` : ''}
            </>
          ) : ' · no owner (a bare pod: nothing recreates it)'}
          {' · '}
          {node ? <>node <Link onClick={() => go(`/r/v1~nodes/_/${node}`, node)}>{node}</Link></> : 'not scheduled'}
        </div>
      </div>
      <div className="ml-auto grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <StatCard
          className="min-w-[150px]"
          label="Last exit"
          value={term ? `${term.reason} · ${term.exitCode ?? '—'}` : 'None'}
          tone={term && (term.exitCode ?? 0) !== 0 ? 'danger' : undefined}
          subtitle={term ? (multi ? `container ${primary?.name}` : term.finishedAt ? new Date(term.finishedAt).toLocaleTimeString() : undefined) : 'no previous instance'}
        />
        <StatCard
          className="min-w-[150px]"
          label="Restarts"
          value={restarts}
          tone={restarts > 5 ? 'danger' : restarts > 0 ? 'warning' : undefined}
          subtitle="since the pod started"
        />
        <StatCard
          className="min-w-[150px]"
          label="Memory p95 / limit"
          value={memValue}
          subtitle={memSub}
        />
      </div>
    </section>
  );
}
