import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Shield, ShieldAlert, ShieldCheck, ShieldOff, Lock, Key, Users,
  CheckCircle, XCircle, AlertTriangle, ArrowRight, ChevronDown, ChevronRight,
  Globe, Server, Eye, FileText, Network, Bot, HelpCircle, Loader2,
} from 'lucide-react';
import { LoadError } from '../components/primitives/LoadError';
import { useKubeadminSecret } from '../hooks/useKubeadminSecret';
import { errorReason } from '../engine/readResult';
import { cn } from '@/lib/utils';
import { k8sGet, k8sList } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import { useNavigateTab } from '../hooks/useNavigateTab';
import { useK8sListWatch } from '../hooks/useK8sListWatch';
import { Panel } from '../components/primitives/Panel';
import type { K8sResource } from '../engine/renderers';
import type { ClusterRoleBinding, Namespace, Subject } from '../engine/types';
import { useClusterStore } from '../store/clusterStore';
import { MetricGrid } from '../components/primitives/MetricGrid';
import { Card } from '../components/primitives/Card';
import { askPulse } from '../engine/askPulse';
import { clusterAdminSubjects, tooManyClusterAdmins, CLUSTER_ADMIN_LIMIT } from '../engine/clusterAdmins';
import { RevokeBindingButton } from '../components/rbac/RevokeBinding';
import { createTemplateUrl } from '../engine/createTemplates';
import { useActiveClusterId } from '../hooks/useClusterBase';

interface SecurityAuditCheck {
  id: string;
  label: string;
  /** null = could not be checked (the read failed); never counted as a pass. */
  pass: boolean | null;
  /** The read has not answered yet: neither a result nor unknown. */
  pending?: boolean;
  detail: string;
  severity: 'critical' | 'warning' | 'info';
  link?: string;
  linkTitle?: string;
}


export default function SecurityView() {
  const clusterId = useActiveClusterId();
  const go = useNavigateTab();
  const isHyperShift = useClusterStore((s) => s.isHyperShift);
  const apiGroups = useClusterStore((s) => s.apiGroups);
  const hasExternalSecrets = apiGroups.some((g) => g.name === 'external-secrets.io');
  const hasSealedSecrets = apiGroups.some((g) => g.name === 'bitnami.com');

  // Data
  const { data: oauthConfig, isError: oauthError, error: oauthErr, isLoading: oauthLoading } = useQuery({
    queryKey: ['security', 'oauth', clusterId],
    queryFn: () => safeQuery(() => k8sGet<any>('/apis/config.openshift.io/v1/oauths/cluster', clusterId)),
    staleTime: 120000,
  });
  const { data: apiServer, isError: apiServerError, error: apiServerErr, isLoading: apiServerLoading } = useQuery({
    queryKey: ['security', 'apiserver', clusterId],
    queryFn: () => safeQuery(() => k8sGet<any>('/apis/config.openshift.io/v1/apiservers/cluster', clusterId)),
    staleTime: 120000,
  });
  const { data: kubeadmin } = useKubeadminSecret();
  const { data: clusterRoleBindings = [], isLoading: crbLoading, isError: crbError } = useK8sListWatch({ apiPath: '/apis/rbac.authorization.k8s.io/v1/clusterrolebindings' });
  const { data: sccs = [], isError: sccsError, error: sccsErr, isLoading: sccsLoading, refetch: refetchSccs } = useQuery<K8sResource[]>({
    queryKey: ['security', 'sccs', clusterId],
    queryFn: async () => (await safeQuery(() => k8sList<K8sResource>('/apis/security.openshift.io/v1/securitycontextconstraints', undefined, clusterId))) ?? [],
    staleTime: 120000,
  });
  const { data: networkPolicies = [], isError: netpolError, isLoading: netpolLoading } = useK8sListWatch({ apiPath: '/apis/networking.k8s.io/v1/networkpolicies' });
  const { data: namespaces = [], isError: nsError, isLoading: nsLoading } = useK8sListWatch({ apiPath: '/api/v1/namespaces' });
  // A 403 on secrets is "unknown", not 0 certificates.
  const { data: secrets = [], isError: secretsError, isLoading: secretsLoading } = useQuery<K8sResource[]>({
    queryKey: ['security', 'secrets-summary', clusterId],
    queryFn: async () => {
      const s = await k8sList<K8sResource>('/api/v1/secrets', undefined, clusterId);
      return s;
    },
    staleTime: 120000,
  });
  const { data: externalSecrets = [], isError: externalSecretsError, isLoading: externalSecretsLoading } = useQuery<K8sResource[]>({
    queryKey: ['security', 'externalsecrets', clusterId],
    queryFn: async () => {
      // ESO 0.17+ serves ExternalSecret at v1 (v1beta1 is no longer served);
      // ESO installs still on <0.17 only serve v1beta1 — check both.
      const [v1, v1beta1] = await Promise.all([
        safeQuery(() => k8sList<K8sResource>('/apis/external-secrets.io/v1/externalsecrets', undefined, clusterId)),
        safeQuery(() => k8sList<K8sResource>('/apis/external-secrets.io/v1beta1/externalsecrets', undefined, clusterId)),
      ]);
      return [...(v1 ?? []), ...(v1beta1 ?? [])];
    },
    staleTime: 120000,
    enabled: hasExternalSecrets,
  });
  const { data: sealedSecrets = [], isError: sealedSecretsError, isLoading: sealedSecretsLoading } = useQuery<K8sResource[]>({
    queryKey: ['security', 'sealedsecrets', clusterId],
    queryFn: async () => (await safeQuery(() => k8sList<K8sResource>('/apis/bitnami.com/v1alpha1/sealedsecrets', undefined, clusterId))) ?? [],
    staleTime: 120000,
    enabled: hasSealedSecrets,
  });

  // StackRox / ACS detection
  const { data: acsInstalled = false, isError: acsError, isLoading: acsLoading } = useQuery({
    queryKey: ['security', 'acs', clusterId],
    queryFn: async () => {
      const csvs = (await safeQuery(() => k8sList<K8sResource>('/apis/operators.coreos.com/v1alpha1/clusterserviceversions', undefined, clusterId))) ?? [];
      return csvs.some((csv) => csv.metadata?.name?.includes('rhacs') || csv.metadata?.name?.includes('stackrox'));
    },
    staleTime: 300000,
  });

  // Derived
  const identityProviders = oauthConfig?.spec?.identityProviders || [];
  // An unset profile means Intermediate — but only when the APIServer was read.
  const apiServerRead = !apiServerError && apiServer != null;
  const apiServerReason = apiServerError ? errorReason(apiServerErr) : 'APIServer config not found';
  const tlsProfile = apiServerRead ? apiServer?.spec?.tlsSecurityProfile?.type || 'Intermediate' : null;
  const encryptionType = apiServerRead ? apiServer?.spec?.encryption?.type || 'identity' : null;

  // Shared with Identity: one definition of who has cluster-admin and how many is too many.
  const clusterAdmins = useMemo(() => clusterAdminSubjects(clusterRoleBindings as ClusterRoleBinding[]), [clusterRoleBindings]);
  const crbByName = useMemo(() => new Map((clusterRoleBindings as ClusterRoleBinding[]).map((b) => [b.metadata?.name || '', b])), [clusterRoleBindings]);

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

  const tlsSecretCount = secrets.filter((s: any) => s.type === 'kubernetes.io/tls').length;
  const opaqueSecretCount = secrets.filter((s: any) => s.type === 'Opaque').length;

  // Audit checks
  const checks: SecurityAuditCheck[] = useMemo(() => {
    const c: SecurityAuditCheck[] = [];

    // Identity
    c.push({
      id: 'idp',
      label: 'Identity Provider configured',
      pass: oauthError ? null : identityProviders.length > 0,
      detail: oauthError ? `Could not read OAuth config: ${errorReason(oauthErr)}` : identityProviders.length > 0
        ? `${identityProviders.length} provider${identityProviders.length > 1 ? 's' : ''}: ${identityProviders.map((p: any) => `${p.name} (${p.type})`).join(', ')}`
        : 'No identity provider configured — only kubeadmin can log in',
      severity: identityProviders.length > 0 ? 'info' : 'critical',
      link: '/admin?tab=config', linkTitle: 'Cluster Config',
    });

    // kubeadmin is the kube-system/kubeadmin Secret, not a User object.
    c.push({
      id: 'kubeadmin',
      label: 'kubeadmin user removed',
      pass: !kubeadmin || kubeadmin.state === 'unknown' ? null : kubeadmin.state === 'absent',
      detail: !kubeadmin
        ? 'Checking kube-system/kubeadmin…'
        : kubeadmin.state === 'unknown'
          ? `Could not read kube-system/kubeadmin: ${kubeadmin.reason}`
          : kubeadmin.state === 'present'
            ? 'kubeadmin still exists — remove after configuring an identity provider'
            : 'kubeadmin has been removed',
      severity: kubeadmin?.state === 'present' ? 'warning' : 'info',
      link: '/identity?tab=users', linkTitle: 'Identity & Access',
    });

    // TLS (on HyperShift, API server TLS is managed by the hosting provider)
    if (!isHyperShift) {
      c.push({
        id: 'tls',
        label: 'TLS security profile',
        pass: tlsProfile === null ? null : tlsProfile !== 'Old',
        detail: tlsProfile === null
          ? `Unknown — ${apiServerReason}`
          : `TLS profile: ${tlsProfile}${tlsProfile === 'Old' ? ' — allows weak ciphers, upgrade to Intermediate or Modern' : ''}`,
        severity: tlsProfile === 'Old' ? 'critical' : 'info',
      });
    }

    // Encryption (on HyperShift, etcd encryption is managed externally)
    if (!isHyperShift) {
      c.push({
        id: 'encryption',
        label: 'Encryption at rest',
        pass: encryptionType === null ? null : encryptionType !== 'identity',
        detail: encryptionType === null
          ? `Unknown — ${apiServerReason}`
          : encryptionType === 'identity'
          ? 'Secrets are stored unencrypted in etcd — enable aescbc or aesgcm encryption'
          : `Encryption type: ${encryptionType}`,
        severity: encryptionType === 'identity' ? 'warning' : 'info',
      });
    }

    // Cluster-admin (threshold is a module constant, configurable at top of file)
    c.push({
      id: 'clusteradmin',
      label: `Cluster-admin access limited (≤${CLUSTER_ADMIN_LIMIT})`,
      pass: crbError ? null : !tooManyClusterAdmins(clusterAdmins),
      detail: crbError ? 'Could not read ClusterRoleBindings' : clusterAdmins.length === 0
        ? 'No non-system cluster-admin bindings'
        : `${clusterAdmins.length} subject${clusterAdmins.length > 1 ? 's' : ''} with cluster-admin: ${clusterAdmins.map(a => `${a.kind}/${a.name}`).join(', ')}`,
      // A failing check is a warning; `info` made it count as neither critical nor warning.
      severity: tooManyClusterAdmins(clusterAdmins) ? 'warning' : 'info',
      link: '/identity?tab=rbac', linkTitle: 'Identity & Access',
    });

    // Network policies
    c.push({
      id: 'netpol',
      label: 'Network policies in user namespaces',
      pass: netpolError || nsError ? null : unprotectedNamespaces.length === 0,
      detail: netpolError || nsError ? 'Could not read namespaces or network policies' : unprotectedNamespaces.length === 0
        ? `All ${userNamespaces.length} user namespaces have network policies`
        : `${unprotectedNamespaces.length} of ${userNamespaces.length} user namespaces have no network policies`,
      severity: unprotectedNamespaces.length > 0 ? 'warning' : 'info',
      link: '/networking', linkTitle: 'Networking',
    });

    // (No "Privileged SCCs tracked" / "TLS certificates managed" checks: they
    // could only pass. SCCs and certificate counts are shown below instead.)

    // Secrets management
    const hasExternalSecrets = externalSecrets.length > 0;
    const hasSealedSecrets = sealedSecrets.length > 0;
    const hasSecretsMgmt = hasExternalSecrets || hasSealedSecrets;
    c.push({
      id: 'secrets-mgmt',
      label: 'Secrets management',
      pass: hasSecretsMgmt ? true : externalSecretsError || sealedSecretsError ? null : false,
      detail: !hasSecretsMgmt && (externalSecretsError || sealedSecretsError)
        ? 'Could not read ExternalSecrets / SealedSecrets'
        : hasExternalSecrets
        ? `${externalSecrets.length} ExternalSecret${externalSecrets.length !== 1 ? 's' : ''}`
        : hasSealedSecrets
        ? `${sealedSecrets.length} SealedSecret${sealedSecrets.length !== 1 ? 's' : ''}`
        : 'No external secrets operator detected — secrets stored as base64 in etcd',
      severity: hasSecretsMgmt ? 'info' : 'warning',
    });

    // ACS / StackRox
    c.push({
      id: 'acs',
      label: 'Advanced Cluster Security (ACS)',
      pass: acsInstalled ? true : acsError ? null : false,
      detail: !acsInstalled && acsError
        ? 'Could not read ClusterServiceVersions to detect ACS'
        : acsInstalled
        ? 'Red Hat ACS / StackRox is installed — vulnerability scanning and runtime protection active'
        : 'ACS / StackRox not detected — consider installing for vulnerability scanning and compliance',
      severity: acsInstalled ? 'info' : 'warning',
    });

    // While a read has not answered, its check is "Checking…", not a result:
    // an empty default list would otherwise pass or fail it.
    const pending: Record<string, boolean> = {
      idp: oauthLoading,
      kubeadmin: !kubeadmin,
      tls: apiServerLoading,
      encryption: apiServerLoading,
      clusteradmin: crbLoading,
      netpol: netpolLoading || nsLoading,
      'secrets-mgmt': externalSecretsLoading || sealedSecretsLoading,
      acs: acsLoading,
    };
    return c.map((check) => pending[check.id]
      ? { ...check, pass: null, pending: true, detail: 'Checking…', severity: 'info' as const }
      : check);
  }, [oauthLoading, apiServerLoading, crbLoading, netpolLoading, nsLoading, externalSecretsLoading, sealedSecretsLoading, acsLoading, identityProviders, oauthError, oauthErr, kubeadmin, tlsProfile, encryptionType, apiServerReason, crbError, clusterAdmins, netpolError, nsError, unprotectedNamespaces, userNamespaces, externalSecrets, sealedSecrets, externalSecretsError, sealedSecretsError, acsInstalled, acsError, isHyperShift]);

  // Unknown checks are neither passing nor failing; the score says so.
  const passCount = checks.filter(c => c.pass === true).length;
  const unknownCount = checks.filter(c => c.pass === null && !c.pending).length;
  const pendingCount = checks.filter(c => c.pending).length;
  const auditScore = Math.round((passCount / checks.length) * 100);
  const criticalFails = checks.filter(c => c.pass === false && c.severity === 'critical');
  const warningFails = checks.filter(c => c.pass === false && c.severity === 'warning');

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

        {/* AI Security Scanner — opens dock panel */}
        <Card className="px-4 py-3">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-200">Ask the Security Agent</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {[
              'Run a full security audit',
              'Scan pods for security issues',
              'Check RBAC risks',
              'Find unprotected namespaces',
              'Audit secret rotation',
            ].map((prompt) => (
              <button
                key={prompt}
                onClick={() => askPulse(prompt)}
                className="px-2.5 py-1 text-xs rounded-sm bg-slate-800 text-slate-300 hover:bg-indigo-900/40 hover:text-indigo-300 border border-slate-700 hover:border-indigo-700/50 transition-colors"
              >
                {prompt}
              </button>
            ))}
          </div>
        </Card>

        {crbLoading && clusterRoleBindings.length === 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="bg-slate-900 rounded-lg border border-slate-800 p-4 animate-pulse">
                <div className="h-8 bg-slate-800 rounded-sm w-1/3 mx-auto mb-2" />
                <div className="h-3 bg-slate-800 rounded-sm w-2/3 mx-auto" />
              </div>
            ))}
          </div>
        )}

        {/* Score + Summary */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          <div className={cn('bg-slate-900 rounded-lg border p-4 flex flex-col items-center justify-center',
            auditScore === 100 ? 'border-green-800/50' : auditScore >= 75 ? 'border-yellow-800/50' : 'border-red-800/50')}>
            <div className={cn('text-4xl font-bold', auditScore === 100 ? 'text-green-400' : auditScore >= 75 ? 'text-yellow-400' : 'text-red-400')}>
              {passCount}/{checks.length}
            </div>
            <div className="text-xs text-slate-400 mt-1">checks passing</div>
            {unknownCount > 0 && <div className="text-xs text-slate-400 mt-2">{unknownCount} could not be checked</div>}
            {pendingCount > 0 && <div className="text-xs text-slate-500 mt-1">{pendingCount} still checking</div>}
            {criticalFails.length > 0 && <div className="text-xs text-red-400 mt-2">{criticalFails.length} critical</div>}
            {warningFails.length > 0 && <div className="text-xs text-yellow-400">{warningFails.length} warning</div>}
          </div>
          <SummaryCard icon={<Users className="w-4 h-4 text-blue-400" />} label="Cluster Admins" value={crbError || crbLoading ? '—' : String(clusterAdmins.length)}
            sub={crbError ? 'ClusterRoleBindings could not be read' : crbLoading ? 'Loading…' : clusterAdmins.length > 0 ? clusterAdmins.slice(0, 2).map(a => a.name).join(', ') : 'none'} onClick={() => go('/identity?tab=rbac', 'Identity & Access')} />
          <SummaryCard icon={<Network className="w-4 h-4 text-cyan-400" />} label="Network Policies" value={netpolError || netpolLoading ? '—' : String(networkPolicies.length)}
            sub={netpolError ? 'Network policies could not be read' : netpolLoading ? 'Loading…' : `${nsWithNetPol.size} namespaces covered`} onClick={() => go('/networking', 'Networking')} />
          <SummaryCard icon={<Lock className="w-4 h-4 text-amber-400" />} label="TLS Certificates" value={secretsError || secretsLoading ? '—' : String(tlsSecretCount)}
            sub={secretsError ? 'Secrets could not be read' : secretsLoading ? 'Loading…' : `${opaqueSecretCount} opaque secrets`} onClick={() => go('/admin?tab=certificates', 'Certificates')} />
        </div>

        {/* Security Audit */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-indigo-400" />
              Security Audit
            </h2>
            <span className={cn('text-xs font-medium', passCount === checks.length ? 'text-green-400' : 'text-yellow-400')}>
              {passCount}/{checks.length} passed{unknownCount > 0 ? ` · ${unknownCount} unknown` : ''}{pendingCount > 0 ? ` · ${pendingCount} checking` : ''}
            </span>
          </div>
          <div className="divide-y divide-slate-800">
            {checks.map((check) => (
              <div key={check.id} className="px-4 py-3 flex items-start gap-3">
                {check.pending
                  ? <Loader2 className="w-4 h-4 text-slate-500 shrink-0 mt-0.5 animate-spin" aria-label="Checking" />
                  : check.pass === null
                  ? <HelpCircle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" aria-label="Unknown" />
                  : check.pass
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
        </Card>

        {/* Cluster-Admin Subjects */}
        <Card>
          <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <Key className="w-4 h-4 text-red-400" />
              Cluster-Admin Access ({crbError || crbLoading ? '—' : clusterAdmins.length})
            </h2>
            <button onClick={() => go('/identity?tab=rbac', 'Identity & Access')}
              className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1">
              Manage <ArrowRight className="w-3 h-3" />
            </button>
          </div>
          {crbError ? (
            <LoadError className="m-3" title="ClusterRoleBindings could not be loaded" />
          ) : crbLoading ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">Loading…</div>
          ) : clusterAdmins.length === 0 ? (
            <div className="px-4 py-6 text-center text-xs text-slate-500">No non-system cluster-admin bindings found</div>
          ) : (
            <div className="divide-y divide-slate-800">
              {clusterAdmins.map((admin, i) => (
                <div key={i} className="px-4 py-2.5 flex items-center gap-3">
                  <span className={cn('text-xs px-1.5 py-0.5 rounded-sm', admin.kind === 'User' ? 'bg-blue-900/50 text-blue-300' : admin.kind === 'Group' ? 'bg-purple-900/50 text-purple-300' : 'bg-slate-800 text-slate-400')}>
                    {admin.kind}
                  </span>
                  <span className="text-sm text-slate-200 font-mono">{admin.name}</span>
                  <span className="text-xs text-slate-500 ml-auto">via {admin.binding}</span>
                  {crbByName.get(admin.binding) && (
                    <RevokeBindingButton label="Remove binding" binding={{
                      kind: 'ClusterRoleBinding',
                      name: admin.binding,
                      uid: crbByName.get(admin.binding)!.metadata?.uid,
                      roleRef: { kind: 'ClusterRole', name: 'cluster-admin' },
                      subjects: crbByName.get(admin.binding)!.subjects || [],
                    }} />
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>

        {/* SCCs */}
        {sccsError ? (
          <LoadError title="Security Context Constraints could not be loaded" error={sccsErr} onRetry={() => { void refetchSccs(); }} />
        ) : sccsLoading ? null : (
          <SCCPanel sccs={sccs} go={go} />
        )}

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
                  <span key={ns.metadata?.name} className="inline-flex items-center rounded-sm border border-yellow-900/50 bg-yellow-950/30 text-xs">
                    <button onClick={() => go(`/r/v1~namespaces/_/${ns.metadata?.name}`, ns.metadata?.name)}
                      className="px-2.5 py-1.5 text-yellow-300 hover:bg-yellow-900/40 transition-colors">
                      {ns.metadata?.name}
                    </button>
                    <button onClick={() => go(createTemplateUrl('default-deny', ns.metadata?.name || ''), `Default-deny ${ns.metadata?.name}`)}
                      aria-label={`Create default-deny NetworkPolicy in ${ns.metadata?.name}`}
                      className="px-2 py-1.5 border-l border-yellow-900/50 text-blue-300 hover:bg-yellow-900/40">
                      + default-deny
                    </button>
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick links */}
        <MetricGrid>
          <QuickLink icon={<Users className="w-5 h-5 text-blue-400" />} label="Identity & Access" description="RBAC roles, bindings, users, groups" onClick={() => go('/identity', 'Identity & Access')} />
          <QuickLink icon={<Lock className="w-5 h-5 text-amber-400" />} label="Certificates" description="TLS cert inventory and expiry" onClick={() => go('/admin?tab=certificates', 'Certificates')} />
          <QuickLink icon={<Shield className="w-5 h-5 text-orange-400" />} label="Readiness" description="Production readiness checks" onClick={() => go('/readiness', 'Production Readiness')} />
        </MetricGrid>
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
    <Card>
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
    </Card>
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
