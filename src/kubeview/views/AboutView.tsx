import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Info, Bot, Monitor, Cog, Database, Server, ExternalLink, Copy, Check,
  BookOpen, Package, GitBranch, ShieldCheck, ShieldOff, RefreshCw,
} from 'lucide-react';
import { k8sList } from '../engine/query';
import { agentFetch } from '../engine/safeQuery';
import { useClusterStore } from '../store/clusterStore';
import { Panel } from '../components/primitives/Panel';
import { Badge } from '../components/primitives/Badge';

/**
 * What exactly is running on this cluster, and where it all comes from.
 *
 * Every version on this page is read from the cluster itself — the
 * OpenShiftPulse CR (images, health, config), the operator's CSV, and the
 * agent's own /version endpoint — rather than from anything baked into the
 * bundle, except the console's own build version, which by definition is.
 */

const GITHUB_ORG = 'https://github.com/PulseSRE';
const QUAY = 'https://quay.io/repository/amobrem';

interface PulseCR {
  metadata?: { namespace?: string };
  spec?: {
    agent?: {
      image?: string;
      trustLevel?: number;
      allowWriteOperations?: boolean;
      adminUsers?: string;
      mcp?: { enabled?: boolean };
    };
    ui?: { image?: string; replicas?: number };
    monitoring?: { enabled?: boolean };
    vertexAI?: { projectId?: string; region?: string };
  };
  status?: {
    phase?: string;
    agentHealthy?: boolean;
    agentVersion?: string;
    databaseReady?: boolean;
    uiAvailable?: boolean;
    routeHost?: string;
    upgradeStartedAt?: string;
    lastHealthyAgentImage?: string;
    lastHealthyUIImage?: string;
    lastUpgradeDurationSeconds?: number;
  };
}

interface DeploymentLite {
  metadata?: { name?: string };
  spec?: { replicas?: number };
  status?: { replicas?: number; updatedReplicas?: number; readyReplicas?: number };
}

interface CSV {
  metadata?: { name?: string };
  spec?: { version?: string; displayName?: string };
  status?: { phase?: string };
}

function imageTag(image?: string): string {
  if (!image) return '';
  const idx = image.lastIndexOf(':');
  return idx > 0 ? image.slice(idx + 1) : '';
}

function CopyableImage({ image }: { image?: string }) {
  const [copied, setCopied] = useState(false);
  if (!image) return null;
  return (
    <button
      onClick={() => {
        navigator.clipboard?.writeText(image).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="group flex items-center gap-1.5 text-xs font-mono text-slate-500 hover:text-slate-300 min-w-0"
      title="Copy image reference"
    >
      <span className="truncate">{image}</span>
      {copied ? (
        <Check className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <Copy className="w-3 h-3 opacity-0 group-hover:opacity-100 shrink-0" />
      )}
    </button>
  );
}

function LinkOut({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
    >
      {children}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}

function ComponentRow({
  icon,
  name,
  version,
  healthy,
  image,
  repo,
  detail,
}: {
  icon: React.ReactNode;
  name: string;
  version: string;
  healthy?: boolean;
  image?: string;
  repo?: string; // repo slug under the GitHub org, e.g. 'pulse-agent'
  detail?: string;
}) {
  const tag = imageTag(image);
  return (
    <div className="flex items-start gap-3 py-3 border-b border-slate-800 last:border-0">
      <div className="mt-0.5 text-violet-400">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-slate-100">{name}</span>
          {version && <Badge variant="info">{version}</Badge>}
          {healthy !== undefined && (
            <Badge variant={healthy ? 'success' : 'error'}>{healthy ? 'Healthy' : 'Unhealthy'}</Badge>
          )}
        </div>
        {detail && <div className="text-xs text-slate-500 mt-0.5">{detail}</div>}
        <CopyableImage image={image} />
        {repo && (
          <div className="flex items-center gap-3 mt-1">
            <LinkOut href={`${GITHUB_ORG}/${repo}`}>Source</LinkOut>
            {tag && (
              <LinkOut href={`${GITHUB_ORG}/${repo}/tree/${tag}`}>
                <GitBranch className="w-3 h-3" /> Source at {tag}
              </LinkOut>
            )}
            <LinkOut href={`${GITHUB_ORG}/${repo}/tags`}>Release history</LinkOut>
            {image?.startsWith('quay.io/amobrem/') && (
              <LinkOut href={`${QUAY}/${image.split('/')[2].split(':')[0]}?tab=tags`}>
                <Package className="w-3 h-3" /> Image registry
              </LinkOut>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default function AboutView() {
  const clusterVersion = useClusterStore((s) => s.clusterVersion);

  const { data: cr } = useQuery({
    queryKey: ['about', 'openshiftpulse-cr'],
    queryFn: async () => {
      const items = await k8sList<PulseCR>('/apis/pulse.ai/v1alpha1/openshiftpulses');
      return items[0] ?? null;
    },
    // Poll fast while an upgrade is in flight so the banner tracks the
    // rollout live, lazily otherwise.
    refetchInterval: (query) => (query.state.data?.status?.phase === 'Upgrading' ? 5_000 : 60_000),
  });

  const crNamespace = cr?.metadata?.namespace;
  const upgrading = cr?.status?.phase === 'Upgrading';

  const { data: rollouts } = useQuery({
    queryKey: ['about', 'deployments', crNamespace],
    queryFn: async () => {
      const items = await k8sList<DeploymentLite>(`/apis/apps/v1/namespaces/${crNamespace}/deployments`);
      return items.filter((d) => (d.metadata?.name || '').startsWith('pulse'));
    },
    enabled: Boolean(crNamespace),
    refetchInterval: upgrading ? 5_000 : 60_000,
  });
  const { data: csv } = useQuery({
    queryKey: ['about', 'operator-csv', crNamespace],
    queryFn: async () => {
      const items = await k8sList<CSV>(
        `/apis/operators.coreos.com/v1alpha1/namespaces/${crNamespace}/clusterserviceversions`
      );
      return items.find((c) => (c.metadata?.name || '').startsWith('pulse-operator')) ?? null;
    },
    enabled: Boolean(crNamespace),
    staleTime: 300_000,
  });

  const { data: agentInfo } = useQuery({
    queryKey: ['about', 'agent-version'],
    queryFn: async () => {
      const res = await agentFetch('/api/agent/version');
      if (!res.ok) return null;
      return res.json() as Promise<{ protocol?: number; agent?: string; tools?: number; skills?: number }>;
    },
    staleTime: 60_000,
  });

  const spec = cr?.spec;
  const status = cr?.status;
  const writeOps = Boolean(spec?.agent?.allowWriteOperations);

  // Which components are actually changing, from→to, straight off the CR:
  // the operator stamps lastHealthy*Image with what ran before the change.
  const upgradeMoves: string[] = [];
  if (upgrading) {
    const agentFrom = imageTag(status?.lastHealthyAgentImage);
    const agentTo = imageTag(spec?.agent?.image);
    if (agentTo && agentFrom !== agentTo) upgradeMoves.push(`agent ${agentFrom || '?'} → ${agentTo}`);
    const uiFrom = imageTag(status?.lastHealthyUIImage);
    const uiTo = imageTag(spec?.ui?.image);
    if (uiTo && uiFrom !== uiTo) upgradeMoves.push(`console ${uiFrom || '?'} → ${uiTo}`);
  }
  const upgradeElapsedS = status?.upgradeStartedAt
    ? Math.max(0, Math.floor((Date.now() - Date.parse(status.upgradeStartedAt)) / 1000))
    : null;
  const activeRollouts = (rollouts ?? []).filter((d) => {
    const want = d.spec?.replicas ?? 0;
    const updated = d.status?.updatedReplicas ?? 0;
    const ready = d.status?.readyReplicas ?? 0;
    return want > 0 && (updated < want || ready < want);
  });

  return (
    <div className="p-4 space-y-4 max-w-4xl">
      <div className="flex items-center gap-3">
        <Info className="w-5 h-5 text-sky-400" />
        <div>
          <h1 className="text-lg font-semibold text-slate-100">About OpenShift Pulse</h1>
          <p className="text-xs text-slate-500">
            What is running on this cluster, read live from the cluster itself
            {status?.phase ? <> · phase: <span className="text-slate-300">{status.phase}</span></> : null}
          </p>
        </div>
      </div>

      {upgrading && (
        <div className="rounded-md border border-blue-700/40 bg-blue-500/10 px-4 py-3">
          <div className="flex items-center gap-2 text-sm text-blue-300 font-medium">
            <RefreshCw className="w-4 h-4 animate-spin" />
            Update in progress
            {upgradeMoves.length > 0 && <span className="text-blue-200">— {upgradeMoves.join(', ')}</span>}
          </div>
          <div className="mt-1 text-xs text-blue-300/70">
            {upgradeElapsedS !== null && <>Started {upgradeElapsedS}s ago. </>}
            {status?.lastUpgradeDurationSeconds
              ? `The previous upgrade took ${status.lastUpgradeDurationSeconds}s.`
              : ''}
          </div>
          {activeRollouts.length > 0 && (
            <div className="mt-2 space-y-1">
              {activeRollouts.map((d) => (
                <div key={d.metadata?.name} className="text-xs text-blue-200/80 font-mono">
                  {d.metadata?.name}: {d.status?.updatedReplicas ?? 0}/{d.spec?.replicas ?? 0} updated,{' '}
                  {d.status?.readyReplicas ?? 0} ready
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {!upgrading && status?.phase && status.phase !== 'Running' && (
        <div className="rounded-md border border-amber-700/40 bg-amber-500/10 px-4 py-2.5 text-sm text-amber-300">
          Pulse is <span className="font-medium">{status.phase}</span>
          {activeRollouts.length > 0 &&
            ` — ${activeRollouts.map((d) => `${d.metadata?.name} ${d.status?.readyReplicas ?? 0}/${d.spec?.replicas ?? 0} ready`).join(', ')}`}
        </div>
      )}

      <Panel title="Components" icon={<Server className="w-4 h-4 text-violet-400" />}>
        <ComponentRow
          icon={<Monitor className="w-4 h-4" />}
          name="Console (this UI)"
          version={`v${__APP_VERSION__}`}
          healthy={status?.uiAvailable}
          image={spec?.ui?.image}
          repo="pulse-ui"
          detail={spec?.ui?.replicas ? `${spec.ui.replicas} replicas behind oauth-proxy` : undefined}
        />
        <ComponentRow
          icon={<Bot className="w-4 h-4" />}
          name="SRE Agent"
          version={status?.agentVersion || agentInfo?.agent || ''}
          healthy={status?.agentHealthy}
          image={spec?.agent?.image}
          repo="pulse-agent"
          detail={
            agentInfo
              ? `Protocol v${agentInfo.protocol} · ${agentInfo.tools} tools · ${agentInfo.skills} skills`
              : undefined
          }
        />
        <ComponentRow
          icon={<Cog className="w-4 h-4" />}
          name="Pulse Operator"
          version={csv?.spec?.version ? `v${csv.spec.version}` : ''}
          healthy={csv ? csv.status?.phase === 'Succeeded' : undefined}
          repo="pulse-operator"
          detail={csv?.metadata?.name ? `CSV ${csv.metadata.name} — owns every deployment on this page` : undefined}
        />
        <ComponentRow
          icon={<Database className="w-4 h-4" />}
          name="PostgreSQL"
          version=""
          healthy={status?.databaseReady}
          detail="Memory, fix history, episodes, learned skills — everything the agent knows survives here"
        />
        <ComponentRow
          icon={<Server className="w-4 h-4" />}
          name="OpenShift"
          version={clusterVersion ? `v${clusterVersion}` : ''}
          detail={status?.routeHost ? `Console served at ${status.routeHost}` : undefined}
        />
      </Panel>

      <Panel title="Agent configuration" icon={<Bot className="w-4 h-4 text-violet-400" />}>
        <div className="grid grid-cols-2 gap-3 text-xs">
          <div className="flex items-center gap-2">
            {writeOps ? (
              <ShieldCheck className="w-4 h-4 text-emerald-400" />
            ) : (
              <ShieldOff className="w-4 h-4 text-amber-400" />
            )}
            <span className="text-slate-300">
              Write operations {writeOps ? 'enabled' : 'disabled'}
              <span className="text-slate-500"> — {writeOps ? 'approved fixes execute' : 'diagnose-only'}</span>
            </span>
          </div>
          <div className="text-slate-300">
            Trust level <span className="font-medium">{spec?.agent?.trustLevel ?? '—'}</span>
            <span className="text-slate-500"> · MCP {spec?.agent?.mcp?.enabled ? 'enabled' : 'disabled'}</span>
            <span className="text-slate-500"> · monitoring {spec?.monitoring?.enabled ? 'on' : 'off'}</span>
          </div>
          {spec?.agent?.adminUsers && (
            <div className="text-slate-500">
              Admins: <span className="text-slate-300">{spec.agent.adminUsers}</span>
            </div>
          )}
          {spec?.vertexAI?.projectId && (
            <div className="text-slate-500">
              Model backend: <span className="text-slate-300">Vertex AI · {spec.vertexAI.projectId}</span>
              {spec.vertexAI.region ? ` (${spec.vertexAI.region})` : ''}
            </div>
          )}
        </div>
      </Panel>

      <Panel title="Project links" icon={<BookOpen className="w-4 h-4 text-violet-400" />}>
        <div className="grid grid-cols-2 gap-x-6 gap-y-2">
          <LinkOut href="https://pulsesre.github.io/pulse-ui/">Console documentation</LinkOut>
          <LinkOut href="https://pulsesre.github.io/pulse-agent/">Agent documentation</LinkOut>
          <LinkOut href={`${GITHUB_ORG}/pulse-ui`}>pulse-ui on GitHub</LinkOut>
          <LinkOut href={`${GITHUB_ORG}/pulse-agent`}>pulse-agent on GitHub</LinkOut>
          <LinkOut href={`${GITHUB_ORG}/pulse-operator`}>pulse-operator on GitHub</LinkOut>
          <LinkOut href={`${QUAY}/openshiftpulse?tab=tags`}>UI images on Quay</LinkOut>
          <LinkOut href={`${QUAY}/pulse-agent?tab=tags`}>Agent images on Quay</LinkOut>
          <LinkOut href={`${GITHUB_ORG}/pulse-ui/issues/new`}>Report an issue</LinkOut>
        </div>
      </Panel>
    </div>
  );
}
