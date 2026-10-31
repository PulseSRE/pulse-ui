/**
 * Install form for an OLM package: channel, namespace, install mode (from the
 * CSV's installModes), approval strategy. The confirmation says exactly what
 * will be created — including whether the namespace's existing OperatorGroup
 * is reused — before anything is sent.
 */
import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package } from 'lucide-react';
import { k8sList } from '../../engine/query';
import {
  GLOBAL_OPERATOR_NAMESPACES, defaultInstallMode, installOperator, planOperatorGroup, supportedInstallModes,
  type ApprovalStrategy, type InstallMode, type OperatorGroup,
} from '../../engine/olm';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { usePinnedAction } from '../../hooks/usePinnedAction';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { ConfirmDialog } from '../../components/feedback/ConfirmDialog';

export interface InstallablePackage {
  name: string;
  displayName: string;
  source: string;
  sourceNamespace: string;
  defaultChannel: string;
  channels: Array<{ name: string; version?: string; installModes?: InstallMode[] }>;
  suggestedNamespace: string;
}

type Mode = 'OwnNamespace' | 'SingleNamespace' | 'AllNamespaces';

const MODE_LABEL: Record<Mode, string> = {
  AllNamespaces: 'All namespaces on the cluster',
  OwnNamespace: 'Only the install namespace',
  SingleNamespace: 'One other namespace',
};

export function InstallOperatorForm({ pkg, onInstalled }: {
  pkg: InstallablePackage;
  onInstalled: (info: { name: string; ns: string; displayName: string }) => void;
}) {
  const clusterId = useActiveClusterId();
  const [channel, setChannel] = React.useState(pkg.defaultChannel || pkg.channels[0]?.name || '');
  const channelModes = pkg.channels.find((c) => c.name === channel)?.installModes;
  const supported = supportedInstallModes(channelModes);
  const [ns, setNs] = React.useState(pkg.suggestedNamespace);
  const [mode, setMode] = React.useState<Mode | null>(defaultInstallMode(channelModes));
  const [watchNs, setWatchNs] = React.useState('');
  const [approval, setApproval] = React.useState<ApprovalStrategy>('Automatic');
  const action = usePinnedAction<{ ns: string; mode: Mode; channel: string; approval: ApprovalStrategy; watchNs: string }>();
  const { allowed: canSubscribe } = useCanI('create', 'operators.coreos.com', 'subscriptions', ns || undefined);

  React.useEffect(() => {
    // A channel's CSV can support different modes; keep the choice valid.
    if (!mode || !(supported as string[]).includes(mode)) setMode(defaultInstallMode(channelModes));
  }, [channel]); // eslint-disable-line react-hooks/exhaustive-deps

  const validNs = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(ns);
  const { data: existingGroups, error: ogError } = useQuery<OperatorGroup[]>({
    queryKey: ['olm', 'operatorgroups', ns, clusterId],
    queryFn: () => k8sList<OperatorGroup>(`/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`, undefined, clusterId),
    enabled: validNs,
    retry: false,
    staleTime: 15000,
  });

  const effectiveMode: Mode | null = GLOBAL_OPERATOR_NAMESPACES.includes(ns) ? 'AllNamespaces' : mode;
  const plan = validNs && existingGroups && effectiveMode
    ? planOperatorGroup({ packageName: pkg.name, ns, mode: effectiveMode, targetNamespace: watchNs, existing: existingGroups, supportedModes: channelModes })
    : null;

  const planText = !plan ? '' : plan.action === 'reuse'
    ? `Reuses OperatorGroup ${plan.name} already in ${ns} (${plan.mode}).`
    : plan.action === 'create'
      ? `Creates OperatorGroup ${plan.body.metadata.name} in ${ns} (${plan.mode}${plan.body.spec?.targetNamespaces ? `, watching ${plan.body.spec.targetNamespaces.join(', ')}` : ''}).`
      : plan.reason;

  const confirm = () => action.run(`Installing ${pkg.displayName}`, async (t, pinnedCluster) => {
    await installOperator(pinnedCluster, {
      packageName: pkg.name,
      channel: t.channel,
      source: pkg.source,
      sourceNamespace: pkg.sourceNamespace,
      targetNamespace: t.ns,
      installModes: pkg.channels.find((c) => c.name === t.channel)?.installModes,
      mode: t.mode,
      watchNamespace: t.watchNs || undefined,
      approval: t.approval,
    });
    onInstalled({ name: pkg.name, ns: t.ns, displayName: pkg.displayName });
  });

  const target = action.pending?.target;
  return (
    <div className="bg-blue-950/30 rounded-lg border border-blue-800 p-4 space-y-4">
      <h2 className="text-sm font-semibold text-blue-200">Install Operator</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="text-xs text-slate-400 block">
          Channel
          <select value={channel} onChange={(e) => setChannel(e.target.value)}
            className="mt-1 px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-sm text-slate-200 w-full">
            {pkg.channels.map((ch) => <option key={ch.name} value={ch.name}>{ch.name}{ch.version ? ` (v${ch.version})` : ''}</option>)}
          </select>
        </label>

        <label className="text-xs text-slate-400 block">
          Install namespace
          <input type="text" value={ns} onChange={(e) => setNs(e.target.value.trim())}
            className="mt-1 px-3 py-2 text-sm bg-slate-900 border border-slate-600 rounded-sm text-slate-200 w-full font-mono" />
        </label>

        <fieldset className="text-xs text-slate-400">
          <legend className="mb-1">Installation mode</legend>
          {supported.length === 0 && <p className="text-amber-300">This channel's CSV lists no install mode Pulse can set up.</p>}
          {supported.map((m) => (
            <label key={m} className="flex items-center gap-2 py-0.5 text-slate-300">
              <input type="radio" name="install-mode" value={m} checked={effectiveMode === m}
                disabled={GLOBAL_OPERATOR_NAMESPACES.includes(ns) && m !== 'AllNamespaces'}
                onChange={() => setMode(m)} />
              {MODE_LABEL[m]} <span className="text-slate-500 font-mono">({m})</span>
            </label>
          ))}
          {effectiveMode === 'SingleNamespace' && (
            <input aria-label="Namespace to watch" placeholder="namespace to watch" value={watchNs} onChange={(e) => setWatchNs(e.target.value.trim())}
              className="mt-1 px-2 py-1 text-xs bg-slate-900 border border-slate-600 rounded-sm text-slate-200 font-mono" />
          )}
        </fieldset>

        <fieldset className="text-xs text-slate-400">
          <legend className="mb-1">Update approval</legend>
          {(['Automatic', 'Manual'] as const).map((a) => (
            <label key={a} className="flex items-center gap-2 py-0.5 text-slate-300">
              <input type="radio" name="approval" value={a} checked={approval === a} onChange={() => setApproval(a)} />
              {a}
              <span className="text-slate-500">{a === 'Automatic' ? '— OLM installs updates as they appear' : '— each update waits for you to approve its InstallPlan'}</span>
            </label>
          ))}
        </fieldset>
      </div>

      {ogError ? (
        <LoadError title={`OperatorGroups in ${ns} could not be read`} error={ogError} />
      ) : plan && (
        <p className={plan.action === 'refuse' ? 'text-xs text-red-300' : 'text-xs text-slate-400'} role={plan.action === 'refuse' ? 'alert' : undefined}>{planText}</p>
      )}

      <div className="flex items-center gap-3">
        <Button
          onClick={() => effectiveMode && action.open({ ns, mode: effectiveMode, channel, approval, watchNs })}
          disabled={!validNs || !effectiveMode || !plan || plan.action === 'refuse' || !canSubscribe}
          title={canSubscribe ? undefined : `You do not have permission to create Subscriptions in ${ns}`}
        >
          <Package className="w-4 h-4" /> Install
        </Button>
      </div>

      <ConfirmDialog
        open={!!action.pending}
        onClose={action.close}
        onConfirm={confirm}
        title={`Install ${pkg.displayName}?`}
        description={target ? [
          GLOBAL_OPERATOR_NAMESPACES.includes(target.ns) ? '' : `Creates namespace ${target.ns} if it does not exist.`,
          planText,
          `Creates Subscription ${pkg.name} in ${target.ns} on channel ${target.channel} from ${pkg.source}, with ${target.approval} update approval.`,
        ].filter(Boolean).join(' ') : ''}
        confirmLabel="Install"
        variant="warning"
        loading={action.running}
      >
        {action.error && <LoadError className="mt-3" title="The operator was not installed" error={action.error} />}
      </ConfirmDialog>
    </div>
  );
}
