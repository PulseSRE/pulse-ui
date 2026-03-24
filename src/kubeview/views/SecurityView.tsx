import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff, Lock, Key, Users,
  CheckCircle, XCircle, AlertTriangle, ArrowRight, ChevronDown, ChevronRight,
  Globe, Server, Eye, FileText, Network,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet, k8sList } from '../engine/query';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { Panel } from '../components/primitives/Panel';
import type { K8sResource } from '../engine/renderers';
import type { ClusterRoleBinding, Namespace, Subject } from '../engine/types';

interface AuditCheck {
  id: string;
  label: string;
  pass: boolean;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  link?: string;
  linkTitle?: string;
}

export default function SecurityView() {
  const go = useNavigateTab();

  // Data
  const { data: oauthConfig } = useQuery({
    queryKey: ['security', 'oauth'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/oauths/cluster').catch(() => null),
    staleTime: 120000,
  });
  const { data: apiServer } = useQuery({
    queryKey: ['security', 'apiserver'],
    queryFn: () => k8sGet<any>('/apis/config.openshift.io/v1/apiservers/cluster').catch(() => null),
    staleTime: 120000,
  });
  const { data: users = [] } = useQuery<K8sResource[]>({
    queryKey: ['security', 'users'],
    queryFn: () => k8sList<K8sResource>('/apis/user.openshift.io/v1/users').catch(() => []),
    staleTime: 60000,
  });
  const { data: clusterRoleBindings = [] } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings' });
  const { data: sccs = [] } = useQuery<K8sResource[]>({
    queryKey: ['security', 'sccs'],
    queryFn: () => k8sList<K8sResource>('/apis/security.openshift.io/v1/securitycontextconstraints').catch(() => []),
    staleTime: 120000,
  });
  const { data: networkPolicies = [] } = useK8sListWatch({ apiPath: '/apis/networking.k8s.io/v1/networkpolicies' });
  const { data: namespaces = [] } = useK8sListWatch({ apiPath: '/api/v1/namespaces' });
  const { data: secrets = [] } = useQuery<K8sResource[]>({
    queryKey: ['security', 'secrets-summary'],
    queryFn: async () => {
      const s = await k8sList<K8sResource>('/api/v1/secrets');
      return s;
    },
    staleTime: 120000,
  });
  const { data: externalSecrets = [] } = useQuery<K8sResource[]>({
    queryKey: ['security', 'externalsecrets'],
    queryFn: () => k8sList<K8sResource>('/apis/external-secrets.io/v1beta1/externalsecrets').catch(() => []),
    staleTime: 120000,
  });
  const { data: sealedSecrets = [] } = useQuery<K8sResource[]>({
    queryKey: ['security', 'sealedsecrets'],
    queryFn: () => k8sList<K8sResource>('/apis/bitnami.com/v1alpha1/sealedsecrets').catch(() => []),
    staleTime: 120000,
  });

  // Derived
  const identityProviders = oauthConfig?.spec?.identityProviders || [];
  const tlsProfile = apiServer?.spec?.tlsSecurityProfile?.type || 'Intermediate';
  const encryptionType = apiServer?.spec?.encryption?.type || 'identity';
  const kubeadminExists = users.some((u) => u.metadata?.name === 'kube:admin' || u.metadata?.name === 'kubeadmin');

  const clusterAdmins = useMemo(() => {
    const subjects: Array<{ name: string; kind: string; binding: string }> = [];
    for (const b of clusterRoleBindings as ClusterRoleBinding[]) {
      if (b.roleRef?.name !== 'cluster-admin') continue;
      const bn = b.metadata?.name || '';
      if (bn.startsWith('system:') || bn.startsWith('openshift-')) continue;
      for (const s of b.subjects || []) {
        if (s.name?.startsWith('system:')) continue;
        subjects.push({ name: s.name, kind: s.kind, binding: bn });
      }
    }
    return subjects;
  }, [clusterRoleBindings]);

  const userNamespaces = useMemo(() =>
    namespaces.filter((ns) => {
      const name = ns.metadata?.name || '';
      return !name.startsWith('openshift-') && !name.startsWith('kube-') && name !== 'default' && name !== 'openshift';
    }),
  [namespaces]);

  const nsWithNetPol = useMemo(() => {
    const s = new Set(networkPolicies.map(np => np.metadata?.namespace));
    return s;
  }, [networkPolicies]);

  const unprotectedNamespaces = useMemo(() =>
    userNamespaces.filter((ns) => !nsWithNetPol.has(ns.metadata?.name)),
  [userNamespaces, nsWithNetPol]);

  const privilegedSCCs = useMemo(() =>
    sccs.filter(s => (s as any).allowPrivilegedContainer === true || s.metadata?.name === 'privileged'),
  [sccs]);

  const tlsSecretCount = secrets.filter((s: any) => s.type === 'kubernetes.io/tls').length;
  const opaqueSecretCount = secrets.filter((s: any) => s.type === 'Opaque').length;

  // Audit checks
  const checks: AuditCheck[] = useMemo(() => {
    const c: AuditCheck[] = [];

    // Identity
    c.push({
      id: 'idp',
      label: 'Identity Provider configured',
      pass: identityProviders.length > 0,
      detail: identityProviders.length > 0
        ? `${identityProviders.length} provider${identityProviders.length > 1 ? 's' : ''}: ${identityProviders.map((p: any) => `${p.name} (${p.type})`).join(', ')}`
        : 'No identity provider configured — only kubeadmin can log in',
      severity: identityProviders.length > 0 ? 'info' : 'critical',
      link: '/admin?tab=config', linkTitle: 'Cluster Config',
    });

    c.push({
      id: 'kubeadmin',
      label: 'kubeadmin user removed',
      pass: !kubeadminExists,
      detail: kubeadminExists
        ? 'kubeadmin still exists — remove after configuring an identity provider'
        : 'kubeadmin has been removed',
      severity: kubeadminExists ? 'warning' : 'info',
      link: '/users', linkTitle: 'Users',
    });

    // TLS
    c.push({
      id: 'tls',
      label: 'TLS security profile',
      pass: tlsProfile !== 'Old',
      detail: `TLS profile: ${tlsProfile}${tlsProfile === 'Old' ? ' — allows weak ciphers, upgrade to Intermediate or Modern' : ''}`,
      severity: tlsProfile === 'Old' ? 'critical' : 'info',
    });

    // Encryption
    c.push({
      id: 'encryption',
      label: 'Encryption at rest',
      pass: encryptionType !== 'identity',
      detail: encryptionType === 'identity'
        ? 'Secrets are stored unencrypted in etcd — enable aescbc or aesgcm encryption'
        : `Encryption type: ${encryptionType}`,
      severity: encryptionType === 'identity' ? 'warning' : 'info',
    });

    // Cluster-admin
    c.push({
      id: 'clusteradmin',
      label: 'Cluster-admin access limited',
      pass: clusterAdmins.length <= 3,
      detail: clusterAdmins.length === 0
        ? 'No non-system cluster-admin bindings'
        : `${clusterAdmins.length} subject${clusterAdmins.length > 1 ? 's' : ''} with cluster-admin: ${clusterAdmins.map(a => `${a.kind}/${a.name}`).join(', ')}`,
      severity: clusterAdmins.length > 5 ? 'warning' : 'info',
      link: '/access-control', linkTitle: 'Access Control',
    });

    // Network policies
    c.push({
      id: 'netpol',
      label: 'Network policies in user namespaces',
      pass: unprotectedNamespaces.length === 0,
      detail: unprotectedNamespaces.length === 0
        ? `All ${userNamespaces.length} user namespaces have network policies`
        : `${unprotectedNamespaces.length} of ${userNamespaces.length} user namespaces have no network policies`,
      severity: unprotectedNamespaces.length > 0 ? 'warning' : 'info',
      link: '/networking', linkTitle: 'Networking',
    });

    // SCCs
    c.push({
      id: 'scc',
      label: 'Privileged SCCs tracked',
      pass: true,
      detail: `${sccs.length} SCCs total, ${privilegedSCCs.length} allow privileged containers`,
      severity: 'info',
    });

    // Certificates
    c.push({
      id: 'certs',
      label: 'TLS certificates managed',
      pass: tlsSecretCount > 0,
      detail: `${tlsSecretCount} TLS certificates, ${opaqueSecretCount} opaque secrets`,
      severity: 'info',
      link: '/admin?tab=certificates', linkTitle: 'Certificates',
    });

    // Secrets management
    const hasExternalSecrets = externalSecrets.length > 0;
    const hasSealedSecrets = sealedSecrets.length > 0;
    const hasSecretsMgmt = hasExternalSecrets || hasSealedSecrets;
    c.push({
      id: 'secrets-mgmt',
      label: 'Secrets management',
      pass: hasSecretsMgmt,
      detail: hasExternalSecrets
        ? `${externalSecrets.length} ExternalSecret${externalSecrets.length !== 1 ? 's' : ''}`
        : hasSealedSecrets
        ? `${sealedSecrets.length} SealedSecret${sealedSecrets.length !== 1 ? 's' : ''}`
        : 'No external secrets operator detected — secrets stored as base64 in etcd',
      severity: hasSecretsMgmt ? 'info' : 'warning',
    });

    return c;
  }, [identityProviders, kubeadminExists, tlsProfile, encryptionType, clusterAdmins, unprotectedNamespaces, userNamespaces, sccs, privilegedSCCs, tlsSecretCount, opaqueSecretCount, externalSecrets, sealedSecrets]);

  const passCount = checks.filter(c => c.pass).length;
  const auditScore = Math.round((passCount / checks.length) * 100);
  const criticalFails = checks.filter(c => !c.pass && c.severity === 'critical');
  const warningFails = checks.filter(c => !c.pass && c.severity === 'warning');

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-5xl mx-auto space-y-6">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
            <Shield className="w-6 h-6 text-indigo-500" />
            Security
          </h1>
          <p className="text-sm text-slate-400 mt-1">Security posture, audit checks, access control, and policy overview</p>
        </div>

        {/* Score + Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className={cn('bg-slate-900 rounded-lg border p-4 flex flex-col items-center justify-center',
            auditScore === 100 ? 'border-green-800/50' : auditScore >= 75 ? 'border-yellow-800/50' : 'border-red-800/50')}>
            <div className={cn('text-4xl font-bold', auditScore === 100 ? 'text-green-400' : auditScore >= 75 ? 'text-yellow-400' : 'text-red-400')}>
              {passCount}/{checks.length}
            </div>
            <div className="text-xs text-slate-400 mt-1">checks passing</div>
            {criticalFails.length > 0 && <div className="text-xs text-red-400 mt-2">{criticalFails.length} critical</div>}
            {warningFails.length > 0 && <div className="text-xs text-yellow-400">{warningFails.length} warning</div>}
          </div>
          <SummaryCard icon={<Users className="w-4 h-4 text-blue-400" />} label="Cluster Admins" value={String(clusterAdmins.length)}
            sub={clusterAdmins.length > 0 ? clusterAdmins.slice(0, 2).map(a => a.name).join(', ') : 'none'} onClick={() => go('/access-control', 'Access Control')} />
          <SummaryCard icon={<Network className="w-4 h-4 text-cyan-400" />} label="Network Policies" value={String(networkPolicies.length)}
            sub={`${nsWithNetPol.size} namespaces covered`} onClick={() => go('/networking', 'Networking')} />
          <SummaryCard icon={<Lock className="w-4 h-4 text-amber-400" />} label="TLS Certificates" value={String(tlsSecretCount)}
            sub={`${opaqueSecretCount} opaque secrets`} onClick={() => go('/admin?tab=certificates', 'Certificates')} />
        </div>

        {/* Security Audit */}
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Security Audit
            </h2>
            <span className={cn('text-xs font-medium', passCount === checks.length ? 'text-green-400' : 'text-yellow-400')}>
              {passCount}/{checks.length} passed
            </span>
          </div>
          <div className="divide-y divide-slate-800">
            {checks.map((check) => (
              <div key={check.id} className="px-4 py-3 flex items-start gap-3">
                {check.pass
                  ? <CheckCircle className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                  : check.severity === 'critical'
                  ? <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                  : <AlertTriangle className="w-4 h-4 text-yellow-500 shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-slate-200">{check.label}</div>
                  <div className="text-xs text-slate-400 mt-0.5">{check.detail}</div>
                </div>
                {check.link && (
                  <button onClick={() => go(check.link!, check.linkTitle || '')}
                    className="text-xs text-blue-400 hover:text-blue-300 shrink-0 flex items-center gap-1">
                    View <ArrowRight className="w-3 h-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Cluster-Admin Subjects */}
        <div className="bg-slate-900 rounded-lg border border-slate-800">
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-red-400" />
              Cluster-Admin Access ({clusterAdmins.length})
            </h2>
            <button onClick={() => go('/access-control', 'Access Control')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {clusterAdmins.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">No non-system cluster-admin bindings found</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {clusterAdmins.map((admin, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded', admin.kind === 'User' ? 'bg-blue-900/50 text-blue-300' : admin.kind === 'Group' ? 'bg-purple-900/50 text-purple-300' : 'bg-slate-800 text-slate-400')}>
                    {admin.kind}
                  </span>
                  <span className="text-sm text-slate-200 font-mono">{admin.name}</span>
                  <span className="text-xs text-slate-500 ml-auto">via {admin.binding}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* SCCs */}
        <SCCPanel sccs={sccs} go={go} />

        {/* Unprotected Namespaces */}
        {unprotectedNamespaces.length > 0 && (
          <div className="bg-slate-900 rounded-lg border border-yellow-900/30">
            <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
                <ShieldOff className="w-4 h-4 text-yellow-400" />
                Namespaces Without Network Policies ({unprotectedNamespaces.length})
              </h2>
              <button onClick={() => go('/networking', 'Networking')}
                className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
                Networking <ArrowRight className="w-3 h-3" />
              </button>
            </div>
            <div className="px-4 py-3">
              <p className="text-xs text-slate-500 mb-3">These user namespaces have no NetworkPolicy — all pod-to-pod traffic is allowed by default.</p>
              <div className="flex flex-wrap gap-2">
                {unprotectedNamespaces.map((ns) => (
                  <button key={ns.metadata?.name} onClick={() => go(`/r/v1~namespaces/_/${ns.metadata?.name}`, ns.metadata?.name)}
                    className="text-xs px-2.5 py-1.5 bg-yellow-950/30 border border-yellow-900/50 text-yellow-300 rounded hover:bg-yellow-900/40 transition-colors">
                    {ns.metadata?.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick links */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <QuickLink icon={<Users className="w-5 h-5 text-blue-400" />} label="Access Control" description="RBAC roles and bindings" onClick={() => go('/access-control', 'Access Control')} />
          <QuickLink icon={<Users className="w-5 h-5 text-teal-400" />} label="User Management" description="Users, groups, impersonation" onClick={() => go('/users', 'Users')} />
          <QuickLink icon={<Lock className="w-5 h-5 text-amber-400" />} label="Certificates" description="TLS cert inventory and expiry" onClick={() => go('/admin?tab=certificates', 'Certificates')} />
          <QuickLink icon={<Shield className="w-5 h-5 text-orange-400" />} label="Readiness" description="Production readiness checks" onClick={() => go('/admin?tab=readiness', 'Readiness')} />
        </div>
      </div>
    </div>
  );
}

function SummaryCard({ icon, label, value, sub, onClick }: { icon: React.ReactNode; label: string; value: string; sub: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="bg-slate-900 rounded-lg border border-slate-800 p-4 text-left hover:border-slate-600 transition-colors">
      <div className="flex items-center gap-2 text-xs text-slate-400 font-medium uppercase tracking-wider mb-1">{icon}{label}</div>
      <div className="text-2xl font-bold text-slate-100">{value}</div>
      <div className="text-xs text-slate-500 mt-0.5 truncate">{sub}</div>
    </button>
  );
}

function SCCPanel({ sccs, go }: { sccs: K8sResource[]; go: (path: string, title: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const privileged = sccs.filter(s => (s as any).allowPrivilegedContainer === true);
  const hostNetwork = sccs.filter(s => (s as any).allowHostNetwork === true);
  const hostPID = sccs.filter(s => (s as any).allowHostPID === true);

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <button onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 border-b border-slate-800 flex items-center justify-between hover:bg-slate-800/30 transition-colors">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-orange-400" />
          Security Context Constraints ({sccs.length})
        </h2>
        <div className="flex items-center gap-3">
          <span className="text-xs text-slate-500">
            {privileged.length} privileged, {hostNetwork.length} hostNetwork, {hostPID.length} hostPID
          </span>
          {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
        </div>
      </button>
      {expanded && (
        <div className="overflow-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-slate-800 text-slate-500">
                <th className="px-4 py-2 text-left font-normal">Name</th>
                <th className="px-4 py-2 text-center font-normal">Privileged</th>
                <th className="px-4 py-2 text-center font-normal">Host Network</th>
                <th className="px-4 py-2 text-center font-normal">Host PID</th>
                <th className="px-4 py-2 text-center font-normal">Host Ports</th>
                <th className="px-4 py-2 text-left font-normal">Run As User</th>
                <th className="px-4 py-2 text-left font-normal">Volumes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/50">
              {sccs.map((scc: any) => (
                <tr key={scc.metadata?.name} className="hover:bg-slate-800/30">
                  <td className="px-4 py-2">
                    <button onClick={() => go(`/r/security.openshift.io~v1~securitycontextconstraints/_/${scc.metadata.name}`, scc.metadata.name)}
                      className="text-blue-400 hover:text-blue-300 font-medium">{scc.metadata.name}</button>
                  </td>
                  <td className="px-4 py-2 text-center">{scc.allowPrivilegedContainer ? <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" />}</td>
                  <td className="px-4 py-2 text-center">{scc.allowHostNetwork ? <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" />}</td>
                  <td className="px-4 py-2 text-center">{scc.allowHostPID ? <XCircle className="w-3.5 h-3.5 text-red-400 mx-auto" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" />}</td>
                  <td className="px-4 py-2 text-center">{scc.allowHostPorts ? <XCircle className="w-3.5 h-3.5 text-yellow-400 mx-auto" /> : <CheckCircle className="w-3.5 h-3.5 text-green-500 mx-auto" />}</td>
                  <td className="px-4 py-2 text-slate-400">{scc.runAsUser?.type || '—'}</td>
                  <td className="px-4 py-2 text-slate-500 truncate max-w-32">{(scc.volumes || []).join(', ') || '*'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function QuickLink({ icon, label, description, onClick }: { icon: React.ReactNode; label: string; description: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-3 p-3 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors text-left">
      {icon}
      <div>
        <div className="text-sm font-medium text-slate-200">{label}</div>
        <div className="text-xs text-slate-500">{description}</div>
      </div>
    </button>
  );
}
