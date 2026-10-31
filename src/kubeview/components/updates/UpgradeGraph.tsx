/**
 * UpgradeGraph — OpenShift update graph.
 *
 * Installed path (history) → current version → every target CVO offers,
 * one column per minor version, edges coloured by what the cluster says about
 * the target: recommended (availableUpdates), conditional (conditionalUpdates
 * with named risks) or blocked (a minor target while Upgradeable=False).
 * Selecting a target shows its risks and, when the page can act, an update
 * action; the in-flight section shows CVO progress, ClusterOperators at the
 * target version, MachineConfigPool rollout and blockers; history is a
 * timeline with real durations.
 *
 * Used by Admin › Updates (live, with actions) and by the agent's
 * `upgrade_graph` component (read-only, links to Admin › Updates).
 */

import React from 'react';
import {
  ArrowUpCircle, ExternalLink, AlertTriangle, Ban, CheckCircle, Clock, Loader2, XCircle, ShieldAlert,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  compareVersions, durationMinutes, lastCompletedDuration, minorOf,
  type UpgradeModel, type UpgradeTarget,
} from '../../engine/upgradeGraph';

const NODE_W = 112;
const NODE_H = 34;
const COL_W = 156;
const ROW_H = 48;
const PAD = 16;

const STATE_STYLE: Record<UpgradeTarget['state'], { stroke: string; fill: string; text: string; dash?: string; label: string }> = {
  recommended: { stroke: '#34d399', fill: 'rgba(16,185,129,0.12)', text: '#a7f3d0', label: 'Recommended' },
  conditional: { stroke: '#fbbf24', fill: 'rgba(245,158,11,0.12)', text: '#fde68a', dash: '6 4', label: 'Conditional' },
  blocked: { stroke: '#f87171', fill: 'rgba(239,68,68,0.08)', text: '#fca5a5', dash: '2 4', label: 'Blocked' },
};

export interface UpgradeGraphProps {
  model: UpgradeModel;
  /** Start an update to this target. Omit for a read-only graph. */
  onUpdate?: (target: UpgradeTarget) => void;
  /** Why updating is not possible right now (in progress, no permission…). */
  updateDisabledReason?: string;
  /** In-app navigation for object links. */
  onNavigate?: (path: string, title: string) => void;
  /** Shown instead of the update button when onUpdate is absent. */
  readOnlyHint?: React.ReactNode;
  /** Blocker types another panel on the page already explains. */
  hiddenBlockerTypes?: string[];
  /** Why the target list may be incomplete (ClusterVersion unreadable, updates not retrieved). */
  updatesUnknownReason?: string;
}

interface Placed {
  key: string;
  version: string;
  x: number;
  y: number;
  kind: 'history' | 'current' | 'desired' | 'target';
  target?: UpgradeTarget;
}

function layout(model: UpgradeModel) {
  const current = model.current.version;
  // Installed path: the last few versions this cluster ran, oldest first.
  const seen = new Set<string>([current]);
  const pastVersions: string[] = [];
  for (const h of model.history) {
    if (h.state !== 'Completed' || seen.has(h.version)) continue;
    seen.add(h.version);
    pastVersions.push(h.version);
    if (pastVersions.length === 3) break;
  }
  pastVersions.reverse();

  const byMinor = new Map<string, UpgradeTarget[]>();
  for (const n of model.nodes) {
    const m = minorOf(n.version);
    byMinor.set(m, [...(byMinor.get(m) || []), n]);
  }
  const minors = [...byMinor.keys()].sort((a, b) => compareVersions(`${a}.0`, `${b}.0`));
  for (const m of minors) byMinor.get(m)!.sort((a, b) => compareVersions(b.version, a.version));
  const maxRows = Math.max(1, ...minors.map((m) => byMinor.get(m)!.length));
  const height = PAD * 2 + maxRows * ROW_H;
  const midY = PAD + ((maxRows - 1) * ROW_H) / 2;

  const placed: Placed[] = [];
  let col = 0;
  for (const v of pastVersions) placed.push({ key: `h-${v}`, version: v, x: PAD + col++ * COL_W, y: midY, kind: 'history' });
  const currentNode: Placed = { key: 'current', version: current || 'unknown', x: PAD + col++ * COL_W, y: midY, kind: 'current' };
  placed.push(currentNode);
  // In flight: the release being installed sits between current and the
  // targets, which CVO computes from it.
  const from = model.updatesFrom || model.edges?.[0]?.from;
  let sourceNode = currentNode;
  if (from && current && from !== current) {
    sourceNode = { key: 'desired', version: from, x: PAD + col++ * COL_W, y: midY, kind: 'desired' };
    placed.push(sourceNode);
  }
  for (const m of minors) {
    const items = byMinor.get(m)!;
    const top = PAD + ((maxRows - items.length) * ROW_H) / 2;
    items.forEach((t, i) => placed.push({ key: `t-${t.version}`, version: t.version, x: PAD + col * COL_W, y: top + i * ROW_H, kind: 'target', target: t }));
    col++;
  }
  const width = PAD * 2 + (col - 1) * COL_W + NODE_W;
  return { placed, currentNode, sourceNode, width, height, minors };
}

function edgePath(from: Placed, to: Placed): string {
  const x1 = from.x + NODE_W;
  const y1 = from.y + NODE_H / 2;
  const x2 = to.x;
  const y2 = to.y + NODE_H / 2;
  const dx = (x2 - x1) / 2;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function Bar({ value, total, tone = 'blue', label }: { value: number; total: number; tone?: 'blue' | 'red' | 'amber'; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
      className="h-1.5 bg-slate-800 rounded-full overflow-hidden"
    >
      <div
        className={cn('h-full rounded-full transition-all', tone === 'red' ? 'bg-red-500' : tone === 'amber' ? 'bg-amber-500' : 'bg-blue-500')}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

function LinkButton({ path, title, onNavigate, children }: { path?: string; title: string; onNavigate?: UpgradeGraphProps['onNavigate']; children: React.ReactNode }) {
  if (!path || !onNavigate) return <span className="font-mono text-slate-300">{children}</span>;
  return (
    <button type="button" onClick={() => onNavigate(path, title)} className="font-mono text-blue-400 hover:text-blue-300 hover:underline">
      {children}
    </button>
  );
}

export function UpgradeGraph({ model: fullModel, onUpdate, updateDisabledReason, onNavigate, readOnlyHint, hiddenBlockerTypes, updatesUnknownReason }: UpgradeGraphProps) {
  const model = React.useMemo(() => (hiddenBlockerTypes?.length
    ? { ...fullModel, blockers: fullModel.blockers.filter((b) => !hiddenBlockerTypes.includes(b.type)) }
    : fullModel), [fullModel, hiddenBlockerTypes]);
  const { placed, currentNode, sourceNode, width, height } = React.useMemo(() => layout(model), [model]);
  const [selected, setSelected] = React.useState<string | null>(null);
  const selectedTarget = model.nodes.find((n) => n.version === selected) || null;
  const inFlightVersion = model.progress.phase !== 'idle' && model.desired?.version && model.desired.version !== model.current.version
    ? model.desired.version : null;
  const sourceIsDesired = sourceNode !== currentNode;
  const last = lastCompletedDuration(model.history);
  const historyNodes = placed.filter((p) => p.kind === 'history');

  const select = (v: string) => setSelected((s) => (s === v ? null : v));

  return (
    <div className="space-y-4" data-testid="upgrade-graph">
      {/* Graph */}
      <div className="rounded-lg border border-slate-800 bg-slate-950/60">
        <div className="overflow-x-auto">
          <svg
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            role="group"
            aria-label={`Update graph from ${model.current.version || 'unknown'}: ${model.nodes.length} target${model.nodes.length === 1 ? '' : 's'}`}
            className="block"
          >
            <defs>
              <marker id="ug-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" fill="#64748b" />
              </marker>
            </defs>

            {/* Installed path */}
            {[...historyNodes, currentNode].slice(1).map((n, i) => {
              const prev = [...historyNodes, currentNode][i];
              return <path key={`hp-${n.key}`} d={edgePath(prev, n)} stroke="#475569" strokeWidth={2} fill="none" data-edge="history" />;
            })}

            {/* Current → release being installed */}
            {sourceIsDesired && (
              <path d={edgePath(currentNode, sourceNode)} stroke="#60a5fa" strokeWidth={2.5} strokeDasharray="6 4" fill="none" markerEnd="url(#ug-arrow)" data-edge="in-flight">
                <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />
              </path>
            )}

            {/* Edges to targets */}
            {placed.filter((p) => p.kind === 'target').map((p) => {
              const st = STATE_STYLE[p.target!.state];
              const inFlight = p.version === inFlightVersion;
              return (
                <path
                  key={`e-${p.key}`}
                  d={edgePath(sourceNode, p)}
                  stroke={inFlight ? '#60a5fa' : st.stroke}
                  strokeOpacity={selected && selected !== p.version ? 0.35 : 0.9}
                  strokeWidth={inFlight || selected === p.version ? 2.5 : 1.5}
                  strokeDasharray={inFlight ? '6 4' : st.dash}
                  fill="none"
                  markerEnd="url(#ug-arrow)"
                  data-edge={inFlight ? 'in-flight' : p.target!.state}
                >
                  {inFlight && <animate attributeName="stroke-dashoffset" from="20" to="0" dur="1s" repeatCount="indefinite" />}
                </path>
              );
            })}

            {/* Nodes */}
            {placed.map((p) => {
              if (p.kind === 'target') {
                const t = p.target!;
                const st = STATE_STYLE[t.state];
                const isSel = selected === t.version;
                return (
                  <g
                    key={p.key}
                    transform={`translate(${p.x},${p.y})`}
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSel}
                    aria-label={`${t.version} — ${st.label}${t.risks.length ? `, ${t.risks.length} risk${t.risks.length > 1 ? 's' : ''}` : ''}`}
                    onClick={() => select(t.version)}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(t.version); } }}
                    className="cursor-pointer focus:outline-hidden"
                  >
                    <rect width={NODE_W} height={NODE_H} rx={8} fill={st.fill} stroke={isSel ? '#e2e8f0' : st.stroke} strokeWidth={isSel ? 2 : 1} strokeDasharray={isSel ? undefined : st.dash} />
                    <text x={10} y={NODE_H / 2 + 4} fontSize={12} fontFamily="ui-monospace, monospace" fill={st.text}>{t.version}</text>
                    {t.risks.length > 0 && (
                      <g transform={`translate(${NODE_W - 26},${NODE_H / 2 - 8})`}>
                        <rect width={20} height={16} rx={4} fill="rgba(245,158,11,0.25)" />
                        <text x={10} y={12} fontSize={10} textAnchor="middle" fill="#fcd34d">{t.risks.length}</text>
                      </g>
                    )}
                    {t.state === 'blocked' && (
                      <text x={NODE_W - 16} y={NODE_H / 2 + 4} fontSize={11} fill="#f87171" textAnchor="middle">⊘</text>
                    )}
                    {p.version === inFlightVersion && (
                      <rect width={NODE_W} height={NODE_H} rx={8} fill="none" stroke="#60a5fa" strokeWidth={2}>
                        <animate attributeName="stroke-opacity" values="1;0.2;1" dur="1.6s" repeatCount="indefinite" />
                      </rect>
                    )}
                  </g>
                );
              }
              if (p.kind === 'desired') {
                return (
                  <g key={p.key} transform={`translate(${p.x},${p.y})`} data-node="desired" aria-label={`Installing ${p.version}`} role="img">
                    <rect width={NODE_W} height={NODE_H} rx={8} fill="rgba(59,130,246,0.10)" stroke="#60a5fa" strokeWidth={1.5} strokeDasharray="4 3" />
                    <text x={10} y={NODE_H / 2 + 4} fontSize={12} fontFamily="ui-monospace, monospace" fill="#bfdbfe">{p.version}</text>
                    <text x={NODE_W - 8} y={NODE_H / 2 + 4} fontSize={9} textAnchor="end" fill="#93c5fd">installing</text>
                  </g>
                );
              }
              const isCurrent = p.kind === 'current';
              return (
                <g key={p.key} transform={`translate(${p.x},${p.y})`} data-node={p.kind} aria-label={isCurrent ? `Current version ${p.version}` : `Previously installed ${p.version}`} role="img">
                  <rect width={NODE_W} height={NODE_H} rx={8}
                    fill={isCurrent ? 'rgba(59,130,246,0.18)' : 'rgba(30,41,59,0.8)'}
                    stroke={isCurrent ? '#60a5fa' : '#475569'} strokeWidth={isCurrent ? 2 : 1} />
                  <text x={10} y={NODE_H / 2 + 4} fontSize={12} fontFamily="ui-monospace, monospace" fill={isCurrent ? '#bfdbfe' : '#94a3b8'}>{p.version}</text>
                  {isCurrent && <text x={NODE_W - 8} y={NODE_H / 2 + 4} fontSize={9} textAnchor="end" fill="#93c5fd">now</text>}
                </g>
              );
            })}
          </svg>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-t border-slate-800 text-[11px] text-slate-400">
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-400" /> Recommended</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0 border-t-2 border-dashed border-amber-400" /> Conditional (known risks)</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0 border-t-2 border-dotted border-red-400" /> Blocked</span>
          <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-slate-500" /> Installed path</span>
          {model.current.channel && <span className="ml-auto font-mono text-slate-500">{model.current.channel}</span>}
        </div>
        {updatesUnknownReason && (
          <div role="status" className="flex items-start gap-2 px-3 py-2 border-t border-slate-800 text-xs text-slate-400">
            <AlertTriangle className="w-3.5 h-3.5 text-slate-500 mt-0.5 shrink-0" />
            <span><span className="text-slate-300">Update status unknown</span> {'\u2014'} {updatesUnknownReason}</span>
          </div>
        )}
        {model.nodes.length === 0 && !updatesUnknownReason && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-800 text-xs text-slate-400">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
            Cluster is up to date{model.current.channel ? ` on ${model.current.channel}` : ''}
          </div>
        )}
      </div>

      {/* Selected target */}
      {selectedTarget && (
        <TargetPanel
          target={selectedTarget}
          current={model.updatesFrom || model.current.version}
          blockerMessage={fullModel.blockers.find((b) => b.type === 'upgradeable')?.message}
          lastDuration={last}
          onUpdate={onUpdate}
          updateDisabledReason={updateDisabledReason}
          readOnlyHint={readOnlyHint}
        />
      )}

      {/* In-flight progress */}
      {model.progress.phase !== 'idle' && <ProgressSection model={model} onNavigate={onNavigate} />}

      {/* Blockers that are not progress-specific */}
      {model.progress.phase === 'idle' && model.blockers.length > 0 && <Blockers model={model} onNavigate={onNavigate} />}

      {/* History */}
      {model.history.length > 0 && <HistoryTimeline model={model} />}
    </div>
  );
}

function TargetPanel({ target, current, blockerMessage, lastDuration, onUpdate, updateDisabledReason, readOnlyHint }: {
  target: UpgradeTarget; current: string; blockerMessage?: string;
  lastDuration: { version: string; minutes: number } | null;
  onUpdate?: (t: UpgradeTarget) => void; updateDisabledReason?: string; readOnlyHint?: React.ReactNode;
}) {
  const st = STATE_STYLE[target.state];
  const minorJump = parseInt(target.version.split('.')[1] || '0', 10) - parseInt(current.split('.')[1] || '0', 10);
  const disabledReason = target.state === 'blocked'
    ? `Blocked: minor-version updates are not allowed while the cluster reports Upgradeable=False${blockerMessage ? ` (${blockerMessage})` : ''}.`
    : !target.image ? 'The update service gave no release image for this version.' : updateDisabledReason;
  return (
    <section aria-label={`Update target ${target.version}`} className="rounded-lg border border-slate-800 bg-slate-900/60 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-mono text-slate-100">{current} → {target.version}</span>
        <span className="text-[11px] px-1.5 py-0.5 rounded-sm" style={{ color: st.text, background: st.fill, border: `1px solid ${st.stroke}55` }}>{st.label}</span>
        {minorJump > 1 && <span className="text-[11px] px-1.5 py-0.5 rounded-sm bg-amber-900/40 text-amber-300">Skips {minorJump - 1} minor</span>}
        {target.channels && target.channels.length > 0 && <span className="text-[11px] text-slate-500 font-mono">{target.channels.join(', ')}</span>}
      </div>

      {target.state === 'conditional' && (
        <div className="space-y-2">
          <p className="text-xs text-slate-400">
            Not recommended for this cluster{target.recommendation ? `: ${target.recommendation}` : ''}. Updating requires accepting {target.risks.length === 1 ? 'this risk' : `these ${target.risks.length} risks`}:
          </p>
          <ul className="space-y-2">
            {target.risks.map((r) => (
              <li key={r.name} className="p-2.5 rounded-sm bg-amber-950/20 border border-amber-900/40">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span className="text-xs font-medium text-amber-200">{r.name}</span>
                  {r.url && (
                    <a href={r.url} target="_blank" rel="noreferrer" className="ml-auto text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1">
                      Details <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
                {r.message && <p className="text-xs text-slate-400 mt-1 whitespace-pre-wrap">{r.message}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-slate-500 flex items-center gap-1.5">
        <Clock className="w-3.5 h-3.5" />
        {lastDuration
          ? <>Estimated duration: ~{lastDuration.minutes} min <span className="text-slate-600">(based on the last completed update, to {lastDuration.version})</span></>
          : <>Estimated duration: unknown <span className="text-slate-600">(no completed update with recorded times to base it on)</span></>}
      </p>

      {onUpdate ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => onUpdate(target)}
            disabled={!!disabledReason}
            className={cn(
              'px-3 py-1.5 text-xs rounded-sm text-white flex items-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed',
              target.state === 'conditional' ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500',
            )}
          >
            <ArrowUpCircle className="w-3.5 h-3.5" />
            {target.state === 'conditional' ? `Review risks and update to ${target.version}` : `Update to ${target.version}`}
          </button>
          {disabledReason && <span className="text-xs text-slate-500">{disabledReason}</span>}
        </div>
      ) : readOnlyHint}
    </section>
  );
}

function ProgressSection({ model, onNavigate }: { model: UpgradeModel; onNavigate?: UpgradeGraphProps['onNavigate'] }) {
  const p = model.progress;
  const target = model.desired?.version || '';
  const failing = p.phase === 'failing';
  return (
    <section aria-label="Update progress" className={cn('rounded-lg border p-4 space-y-4', failing ? 'border-red-900 bg-red-950/20' : 'border-blue-900/60 bg-blue-950/10')}>
      <div className="flex items-start gap-2">
        {failing ? <XCircle className="w-4 h-4 text-red-400 mt-0.5 shrink-0" /> : <Loader2 className="w-4 h-4 text-blue-400 animate-spin mt-0.5 shrink-0" />}
        <div className="min-w-0 flex-1">
          <div className={cn('text-sm font-medium', failing ? 'text-red-300' : 'text-blue-300')}>
            {failing ? 'Update failing' : `Updating to ${target || 'the new release'}`}
          </div>
          {p.message && <p className="text-xs text-slate-400 mt-0.5">{p.message}</p>}
        </div>
      </div>

      {p.percent != null && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-300">Release manifests</span>
            <span className="font-mono text-slate-400">{p.done} of {p.total} ({p.percent}%)</span>
          </div>
          <Bar value={p.percent} total={100} label="Overall update progress" tone={failing ? 'red' : 'blue'} />
        </div>
      )}

      {p.clusterOperators && (
        <div>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-slate-300">ClusterOperators at {target}</span>
            <span className="font-mono text-slate-400">{p.clusterOperators.updated} of {p.clusterOperators.total}</span>
          </div>
          <Bar value={p.clusterOperators.updated} total={p.clusterOperators.total} label="ClusterOperators at target version" tone={p.clusterOperators.degraded.length ? 'amber' : 'blue'} />
          {p.clusterOperators.degraded.length > 0 && (
            <div className="text-xs text-amber-300 mt-1 flex flex-wrap gap-x-2">
              <span>Degraded:</span>
              {p.clusterOperators.degraded.map((name) => (
                <LinkButton key={name} path={`/r/config.openshift.io~v1~clusteroperators/_/${name}`} title={name} onNavigate={onNavigate}>{name}</LinkButton>
              ))}
            </div>
          )}
        </div>
      )}
      {p.clusterOperators === null && <p className="text-xs text-slate-500">ClusterOperators could not be read.</p>}

      {p.pools && p.pools.length > 0 && (
        <div className="space-y-2">
          {p.pools.map((pool) => (
            <div key={pool.name}>
              <div className="flex justify-between text-xs mb-1">
                <span className="flex items-center gap-2 text-slate-300">
                  <LinkButton path={`/r/machineconfiguration.openshift.io~v1~machineconfigpools/_/${pool.name}`} title={pool.name} onNavigate={onNavigate}>{pool.name}</LinkButton>
                  {pool.degraded && <span className="px-1.5 py-0.5 bg-red-900/50 text-red-300 rounded-sm">Degraded</span>}
                  {pool.paused && <span className="px-1.5 py-0.5 bg-amber-900/50 text-amber-300 rounded-sm">Paused</span>}
                </span>
                <span className="font-mono text-slate-400">{pool.updated}/{pool.total} nodes updated</span>
              </div>
              <Bar value={pool.updated} total={pool.total} label={`MachineConfigPool ${pool.name} rollout`} tone={pool.degraded ? 'red' : 'blue'} />
            </div>
          ))}
        </div>
      )}
      {p.pools === null && <p className="text-xs text-slate-500">MachineConfigPools could not be read.</p>}

      {p.etaMinutes != null && (
        <p className="text-xs text-slate-400 flex items-center gap-1.5">
          <Clock className="w-3.5 h-3.5" /> About {p.etaMinutes} min remaining <span className="text-slate-600">(based on the last completed update&apos;s duration)</span>
        </p>
      )}

      {model.blockers.length > 0 && <Blockers model={model} onNavigate={onNavigate} />}
    </section>
  );
}

function Blockers({ model, onNavigate }: { model: UpgradeModel; onNavigate?: UpgradeGraphProps['onNavigate'] }) {
  return (
    <ul aria-label="Update blockers" className="space-y-1.5">
      {model.blockers.map((b, i) => (
        <li key={i} className="flex items-start gap-2 p-2 rounded-sm bg-red-950/20 border border-red-900/30 text-xs">
          {b.type === 'upgradeable' ? <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" /> : <Ban className="w-3.5 h-3.5 text-red-400 shrink-0 mt-0.5" />}
          <div className="min-w-0">
            <span className="text-slate-300">{b.message}</span>
            {b.reason && <span className="text-slate-500 ml-1">({b.reason})</span>}
            {b.link && onNavigate && (
              <button type="button" onClick={() => onNavigate(b.link!, b.message)} className="ml-2 text-blue-400 hover:text-blue-300">Open</button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

function HistoryTimeline({ model }: { model: UpgradeModel }) {
  const entries = model.history.slice(0, 10);
  const durations = entries.map((h) => durationMinutes(h.startedTime, h.completionTime));
  const max = Math.max(1, ...durations.map((d) => d ?? 0));
  const inFlight = model.progress.phase !== 'idle';
  return (
    <section aria-label="Update history" className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <h3 className="text-sm font-medium text-slate-200 mb-3">Update History</h3>
      <ol className="space-y-2">
        {entries.map((h, i) => {
          const d = durations[i];
          const running = i === 0 && h.state === 'Partial' && !h.completionTime && inFlight;
          const tone = h.state === 'Completed' ? 'text-emerald-400' : h.state === 'Partial' ? 'text-amber-400' : 'text-red-400';
          return (
            <li key={`${h.version}-${i}`} className="grid grid-cols-[6rem_6.5rem_1fr_4.5rem] items-center gap-3 text-xs">
              <span className="font-mono text-slate-200 flex items-center gap-1.5">
                {h.state === 'Completed' ? <CheckCircle className="w-3 h-3 text-emerald-500" /> : running ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin" /> : h.state === 'Partial' ? <AlertTriangle className="w-3 h-3 text-amber-500" /> : <XCircle className="w-3 h-3 text-red-500" />}
                {h.version}
              </span>
              <span className={cn(running ? 'text-blue-300' : tone)}>{running ? 'In progress' : h.state}{h.verified === false ? ' · unverified' : ''}</span>
              <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden" aria-hidden>
                {d != null && <div className={cn('h-full rounded-full', h.state === 'Completed' ? 'bg-emerald-600/70' : 'bg-amber-600/70')} style={{ width: `${Math.max(3, (d / max) * 100)}%` }} />}
              </div>
              <span className="text-right text-slate-500 font-mono" title={h.startedTime ? new Date(h.startedTime).toLocaleString() : undefined}>
                {d != null ? `${d} min` : running ? '…' : '—'}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
