/**
 * ComplianceView — fleet-wide compliance dashboard.
 * Shows security posture, certificate expiry, RBAC baseline, and configuration drift
 * across all connected clusters.
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, RefreshCw, Loader2, CheckCircle, XCircle,
  Lock, Users, AlertTriangle,
  GitCompare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Card, CardHeader, CardBody } from '../../components/primitives/Card';
import { getAllConnections } from '../../engine/clusterConnection';
import { readK8s, listK8s, type ReadResult } from '../../engine/readResult';
import { DEFAULT_SCHEDULER_PROFILE } from '../../engine/snapshot';
import { LoadError } from '../../components/primitives/LoadError';

const UNAVAILABLE = 'unavailable';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SecurityCheck {
  name: string;
  description: string;
  results: Record<string, CheckResult>; // clusterId -> pass/fail/unknown
}

/** A failed read is `unknown` with its reason, never a pass or a fail. */
type CheckResult = { state: 'pass' | 'fail' } | { state: 'unknown'; reason: string };

interface CertEntry {
  clusterId: string;
  clusterName: string;
  certName: string;
  namespace: string;
  daysUntilExpiry: number;
}

interface ClusterAdminBinding {
  clusterId: string;
  clusterName: string;
  bindingName: string;
  subjects: string[];
}

interface DriftField {
  field: string;
  values: Record<string, string>; // clusterId -> value
  majority: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pass = (ok: boolean): CheckResult => ({ state: ok ? 'pass' : 'fail' });
const unknown = (reason: string): CheckResult => ({ state: 'unknown', reason });

function parseCertExpiry(secret: any): Date | null {
  // TLS secrets have tls.crt in base64 — we check annotations for expiry
  const annotations = secret.metadata?.annotations || {};
  // Common annotations from cert-manager or service-ca
  for (const key of Object.keys(annotations)) {
    if (key.toLowerCase().includes('expiry') || key.toLowerCase().includes('not-after') || key.toLowerCase().includes('notafter')) {
      const d = new Date(annotations[key]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

function daysUntil(date: Date): number {
  return Math.floor((date.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function expiryColor(days: number): string {
  if (days < 7) return 'text-red-400 bg-red-950/40';
  if (days < 30) return 'text-amber-400 bg-amber-950/40';
  return 'text-emerald-400 bg-emerald-950/20';
}

function majorityValue(values: Record<string, string>): string {
  const counts = new Map<string, number>();
  for (const v of Object.values(values)) {
    counts.set(v, (counts.get(v) || 0) + 1);
  }
  let best = '';
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function ComplianceView() {
  const clusters = getAllConnections().filter(c => c.status === 'connected');

  const [loading, setLoading] = useState(false);
  const [securityChecks, setSecurityChecks] = useState<SecurityCheck[]>([]);
  const [certificates, setCertificates] = useState<CertEntry[]>([]);
  const [clusterAdminBindings, setClusterAdminBindings] = useState<ClusterAdminBinding[]>([]);
  const [driftFields, setDriftFields] = useState<DriftField[]>([]);
  const [scanErrors, setScanErrors] = useState<string[]>([]);
  const [scanned, setScanned] = useState(false);

  // ------ Security Matrix ------
  const runSecurityChecks = useCallback(async () => {
    const checks: SecurityCheck[] = [
      { name: 'TLS Profile', description: 'API server TLS profile is not Old (unset means Intermediate)', results: {} },
      { name: 'Encryption at Rest', description: 'etcd encryption enabled (aescbc or aesgcm)', results: {} },
      { name: 'Identity Provider', description: 'At least one identity provider configured', results: {} },
      { name: 'kubeadmin Removed', description: 'kubeadmin secret deleted from kube-system', results: {} },
      { name: 'Network Policies', description: 'At least one NetworkPolicy exists', results: {} },
      { name: 'ACS Installed', description: 'StackRox / ACS operator namespace present', results: {} },
    ];

    await Promise.all(clusters.map(async (cluster) => {
      // TLS Profile + Encryption: only a successful read can pass or fail.
      const apiServer = await readK8s<any>('/apis/config.openshift.io/v1/apiservers/cluster', cluster.id);
      if (apiServer.state === 'ok') {
        const tlsType = apiServer.data?.spec?.tlsSecurityProfile?.type || 'Intermediate';
        checks[0].results[cluster.id] = pass(tlsType !== 'Old');
        checks[1].results[cluster.id] = pass((apiServer.data?.spec?.encryption?.type || 'identity') !== 'identity');
      } else {
        const reason = apiServer.state === 'error' ? apiServer.reason : 'APIServer config not found';
        checks[0].results[cluster.id] = unknown(reason);
        checks[1].results[cluster.id] = unknown(reason);
      }

      // Identity Provider
      const oauth = await readK8s<any>('/apis/config.openshift.io/v1/oauths/cluster', cluster.id);
      checks[2].results[cluster.id] = oauth.state === 'ok'
        ? pass((oauth.data?.spec?.identityProviders || []).length > 0)
        : oauth.state === 'absent' ? pass(false) : unknown(oauth.reason);

      // kubeadmin Removed: only a 404 proves it is gone.
      const kubeadmin = await readK8s<any>('/api/v1/namespaces/kube-system/secrets/kubeadmin', cluster.id);
      checks[3].results[cluster.id] = kubeadmin.state === 'error' ? unknown(kubeadmin.reason) : pass(kubeadmin.state === 'absent');

      // Network Policies
      const netpols = await listK8s<any>('/apis/networking.k8s.io/v1/networkpolicies', cluster.id);
      checks[4].results[cluster.id] = netpols.state === 'error' ? unknown(netpols.reason) : pass(netpols.state === 'ok' && netpols.data.length > 0);

      // ACS Installed
      const [acsNs, rhacs] = await Promise.all([
        readK8s<any>('/api/v1/namespaces/stackrox', cluster.id),
        readK8s<any>('/api/v1/namespaces/rhacs-operator', cluster.id),
      ]);
      if (acsNs.state === 'ok' || rhacs.state === 'ok') checks[5].results[cluster.id] = pass(true);
      else if (acsNs.state === 'absent' && rhacs.state === 'absent') checks[5].results[cluster.id] = pass(false);
      else checks[5].results[cluster.id] = unknown(acsNs.state === 'error' ? acsNs.reason : rhacs.state === 'error' ? rhacs.reason : 'Request failed');
    }));

    setSecurityChecks(checks);
  }, [clusters]);

  // ------ Certificate Expiry ------
  const runCertScan = useCallback(async (errors: string[]) => {
    const entries: CertEntry[] = [];

    await Promise.all(clusters.map(async (cluster) => {
      const secrets = await listK8s<any>('/api/v1/secrets', cluster.id);
      if (secrets.state === 'error') {
        errors.push(`${cluster.name}: certificates — ${secrets.reason}`);
        return;
      }
      const tlsSecrets = (secrets.state === 'ok' ? secrets.data : []).filter((s: any) => s.type === 'kubernetes.io/tls');

      for (const secret of tlsSecrets) {
        const expiry = parseCertExpiry(secret);
        if (expiry) {
          entries.push({
            clusterId: cluster.id,
            clusterName: cluster.name,
            certName: secret.metadata.name,
            namespace: secret.metadata.namespace || '',
            daysUntilExpiry: daysUntil(expiry),
          });
        }
      }
    }));

    entries.sort((a, b) => a.daysUntilExpiry - b.daysUntilExpiry);
    setCertificates(entries);
  }, [clusters]);

  // ------ RBAC Baseline ------
  const runRBACComparison = useCallback(async (errors: string[]) => {
    const bindings: ClusterAdminBinding[] = [];

    await Promise.all(clusters.map(async (cluster) => {
      const crbs = await listK8s<any>('/apis/rbac.authorization.k8s.io/v1/clusterrolebindings', cluster.id);
      if (crbs.state === 'error') {
        errors.push(`${cluster.name}: cluster role bindings — ${crbs.reason}`);
        return;
      }
      const adminCrbs = (crbs.state === 'ok' ? crbs.data : []).filter((crb: any) => crb.roleRef?.name === 'cluster-admin');

      for (const crb of adminCrbs) {
        const subjects = (crb.subjects || []).map((s: any) => `${s.kind}/${s.name}`);
        bindings.push({
          clusterId: cluster.id,
          clusterName: cluster.name,
          bindingName: crb.metadata.name,
          subjects,
        });
      }
    }));

    setClusterAdminBindings(bindings);
  }, [clusters]);

  // ------ Configuration Drift ------
  const runDriftDetection = useCallback(async () => {
    const fields: DriftField[] = [];

    // Unset fields mean the platform default — but only when the read worked.
    const configPaths = [
      { path: '/apis/config.openshift.io/v1/clusterversions/version', field: 'Cluster Version', extract: (d: any) => d?.status?.desired?.version || d?.status?.history?.[0]?.version || 'unknown' },
      { path: '/apis/config.openshift.io/v1/oauths/cluster', field: 'OAuth Config', extract: (d: any) => (d?.spec?.identityProviders || []).map((p: any) => p.type).sort().join(', ') || 'none' },
      { path: '/apis/config.openshift.io/v1/apiservers/cluster', field: 'TLS Profile', extract: (d: any) => d?.spec?.tlsSecurityProfile?.type || 'Intermediate' },
      { path: '/apis/config.openshift.io/v1/apiservers/cluster', field: 'Encryption Type', extract: (d: any) => d?.spec?.encryption?.type || 'identity' },
      { path: '/apis/config.openshift.io/v1/ingresses/cluster', field: 'Ingress Domain', extract: (d: any) => d?.spec?.domain || 'unknown' },
      { path: '/apis/config.openshift.io/v1/schedulers/cluster', field: 'Scheduler Profile', extract: (d: any) => d?.spec?.profile || `${DEFAULT_SCHEDULER_PROFILE} (default)` },
    ];

    // Fetch all config resources — group by path to avoid duplicate fetches
    const pathCache: Record<string, Record<string, ReadResult<any>>> = {};

    for (const cp of configPaths) {
      if (!pathCache[cp.path]) {
        pathCache[cp.path] = {};
        await Promise.all(clusters.map(async (cluster) => {
          pathCache[cp.path][cluster.id] = await readK8s<any>(cp.path, cluster.id);
        }));
      }

      const values: Record<string, string> = {};
      const readable: Record<string, string> = {};
      for (const cluster of clusters) {
        const r = pathCache[cp.path][cluster.id];
        if (r.state === 'error') {
          values[cluster.id] = UNAVAILABLE;
        } else {
          values[cluster.id] = cp.extract(r.state === 'ok' ? r.data : null);
          readable[cluster.id] = values[cluster.id];
        }
      }

      fields.push({
        field: cp.field,
        values,
        majority: majorityValue(readable),
      });
    }

    setDriftFields(fields);
  }, [clusters]);

  // ------ Scan All ------
  const runFullScan = useCallback(async () => {
    setLoading(true);
    try {
      const errors: string[] = [];
      await Promise.all([
        runSecurityChecks(),
        runCertScan(errors),
        runRBACComparison(errors),
        runDriftDetection(),
      ]);
      setScanErrors(errors);
      setScanned(true);
    } finally {
      setLoading(false);
    }
  }, [runSecurityChecks, runCertScan, runRBACComparison, runDriftDetection]);

  // Auto-scan on mount if clusters available
  useEffect(() => {
    if (clusters.length > 0 && !scanned) {
      runFullScan();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ------ RBAC summary for comparison ------
  const clusterAdminCounts = React.useMemo(() => {
    const counts: Record<string, { clusterName: string; count: number; subjects: string[] }> = {};
    for (const b of clusterAdminBindings) {
      if (!counts[b.clusterId]) {
        counts[b.clusterId] = { clusterName: b.clusterName, count: 0, subjects: [] };
      }
      counts[b.clusterId].count++;
      counts[b.clusterId].subjects.push(...b.subjects);
    }
    return counts;
  }, [clusterAdminBindings]);

  const avgAdmins = React.useMemo(() => {
    const vals = Object.values(clusterAdminCounts);
    if (vals.length === 0) return 0;
    return Math.round(vals.reduce((s, v) => s + v.count, 0) / vals.length);
  }, [clusterAdminCounts]);

  // ------ Render ------

  if (clusters.length === 0) {
    return (
      <div className="h-full flex items-center justify-center bg-slate-950 p-6">
        <Card className="max-w-md p-6 text-center">
          <Shield className="w-10 h-10 text-slate-600 mx-auto mb-3" />
          <h2 className="text-lg font-semibold text-slate-200 mb-2">No Clusters Connected</h2>
          <p className="text-sm text-slate-400">Connect clusters in the Fleet view to see compliance data.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto bg-slate-950 p-6">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-slate-100 flex items-center gap-2">
              <Shield className="w-6 h-6 text-blue-500" /> Fleet Compliance
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Security posture across {clusters.length} cluster{clusters.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button
            onClick={runFullScan}
            disabled={loading}
            className="px-3 py-1.5 text-xs text-slate-400 rounded-sm hover:bg-slate-800 hover:text-slate-200 flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {loading ? 'Scanning...' : 'Re-scan'}
          </button>
        </div>

        {scanErrors.length > 0 && (
          <LoadError
            title="Some compliance data could not be read; those clusters are left out below"
            error={scanErrors.join(' · ')}
            onRetry={runFullScan}
          />
        )}

        {/* Security Matrix */}
        <Card>
          <CardHeader
            title="Security Matrix"
            icon={<Shield className="h-4 w-4" />}
          />
          <CardBody className="p-0">
            {loading && securityChecks.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                <span className="ml-2 text-sm text-slate-500">Running security checks...</span>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400">
                    <th className="px-4 py-2 text-left font-medium">Check</th>
                    {clusters.map(c => (
                      <th key={c.id} className="px-4 py-2 text-center font-medium">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {securityChecks.map((check) => (
                    <tr key={check.name} className="border-b border-slate-800">
                      <td className="px-4 py-2">
                        <div className="font-medium text-slate-300">{check.name}</div>
                        <div className="text-xs text-slate-500">{check.description}</div>
                      </td>
                      {clusters.map(c => {
                        const result = check.results[c.id];
                        return (
                          <td key={c.id} className="px-4 py-2 text-center">
                            {result === undefined ? (
                              <span className="text-slate-600">--</span>
                            ) : result.state === 'unknown' ? (
                              <span className="text-xs text-slate-400" title={result.reason}>
                                -- <span className="block text-[11px] text-slate-500">{result.reason}</span>
                              </span>
                            ) : result.state === 'pass' ? (
                              <CheckCircle className="w-5 h-5 text-emerald-400 inline-block" aria-label="Compliant" />
                            ) : (
                              <XCircle className="w-5 h-5 text-red-400 inline-block" aria-label="Non-compliant" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* Certificate Expiry Heat Map */}
        <Card>
          <CardHeader
            title="Certificate Expiry"
            icon={<Lock className="h-4 w-4" />}
          />
          <CardBody className="p-0">
            {loading && certificates.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                <span className="ml-2 text-sm text-slate-500">Scanning certificates...</span>
              </div>
            ) : certificates.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No certificate expiry data found. Certificates with expiry annotations will appear here.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400">
                    <th className="px-4 py-2 text-left font-medium">Cluster</th>
                    <th className="px-4 py-2 text-left font-medium">Certificate</th>
                    <th className="px-4 py-2 text-left font-medium">Namespace</th>
                    <th className="px-4 py-2 text-right font-medium">Days Until Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {certificates.map((cert, i) => (
                    <tr key={`${cert.clusterId}-${cert.namespace}-${cert.certName}-${i}`} className={cn('border-b border-slate-800', expiryColor(cert.daysUntilExpiry))}>
                      <td className="px-4 py-2 text-slate-300">{cert.clusterName}</td>
                      <td className="px-4 py-2 font-mono text-slate-300">{cert.certName}</td>
                      <td className="px-4 py-2 text-slate-400">{cert.namespace}</td>
                      <td className="px-4 py-2 text-right font-mono font-semibold">
                        {cert.daysUntilExpiry < 0 ? 'EXPIRED' : `${cert.daysUntilExpiry}d`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>

        {/* RBAC Baseline Comparison */}
        <Card>
          <CardHeader
            title="RBAC Baseline Comparison"
            icon={<Users className="h-4 w-4" />}
          />
          <CardBody>
            {loading && clusterAdminBindings.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                <span className="ml-2 text-sm text-slate-500">Comparing RBAC...</span>
              </div>
            ) : Object.keys(clusterAdminCounts).length === 0 ? (
              <p className="text-sm text-slate-500 text-center py-4">No cluster-admin bindings found across clusters.</p>
            ) : (
              <div className="space-y-4">
                {/* Summary */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {Object.entries(clusterAdminCounts).map(([clusterId, info]) => {
                    const diverges = Math.abs(info.count - avgAdmins) > 1;
                    return (
                      <div
                        key={clusterId}
                        className={cn(
                          'rounded-sm border p-3',
                          diverges ? 'border-amber-800/50 bg-amber-950/20' : 'border-slate-800 bg-slate-900/50'
                        )}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-slate-200">{info.clusterName}</span>
                          <span className={cn('text-lg font-bold tabular-nums', diverges ? 'text-amber-400' : 'text-slate-300')}>
                            {info.count}
                          </span>
                        </div>
                        <div className="text-xs text-slate-500">cluster-admin bindings</div>
                        {diverges && (
                          <div className="flex items-center gap-1 mt-2 text-xs text-amber-400">
                            <AlertTriangle className="w-3 h-3" />
                            {info.count > avgAdmins
                              ? `${info.count - avgAdmins} more than average (${avgAdmins})`
                              : `${avgAdmins - info.count} fewer than average (${avgAdmins})`}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                {/* Detail table */}
                <details className="text-sm">
                  <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-300 transition-colors">
                    Show all cluster-admin subjects
                  </summary>
                  <table className="w-full mt-2 text-sm">
                    <thead>
                      <tr className="border-b border-slate-700 text-xs text-slate-400">
                        <th className="px-3 py-1.5 text-left font-medium">Cluster</th>
                        <th className="px-3 py-1.5 text-left font-medium">Binding</th>
                        <th className="px-3 py-1.5 text-left font-medium">Subjects</th>
                      </tr>
                    </thead>
                    <tbody>
                      {clusterAdminBindings.map((b, i) => (
                        <tr key={`${b.clusterId}-${b.bindingName}-${i}`} className="border-b border-slate-800">
                          <td className="px-3 py-1.5 text-slate-300">{b.clusterName}</td>
                          <td className="px-3 py-1.5 font-mono text-slate-400">{b.bindingName}</td>
                          <td className="px-3 py-1.5 text-slate-400">{b.subjects.join(', ')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </details>
              </div>
            )}
          </CardBody>
        </Card>

        {/* Configuration Drift Detection */}
        <Card>
          <CardHeader
            title="Configuration Drift Detection"
            icon={<GitCompare className="h-4 w-4" />}
          />
          <CardBody className="p-0">
            {loading && driftFields.length === 0 ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 animate-spin text-slate-500" />
                <span className="ml-2 text-sm text-slate-500">Detecting drift...</span>
              </div>
            ) : driftFields.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-slate-500">
                No configuration data to compare.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-700 text-xs text-slate-400">
                    <th className="px-4 py-2 text-left font-medium">Configuration</th>
                    {clusters.map(c => (
                      <th key={c.id} className="px-4 py-2 text-center font-medium">{c.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {driftFields.map((df) => (
                    <tr key={df.field} className="border-b border-slate-800">
                      <td className="px-4 py-2 font-medium text-slate-300">{df.field}</td>
                      {clusters.map(c => {
                        const val = df.values[c.id] || '--';
                        const isDrift = val !== UNAVAILABLE && val !== df.majority;
                        return (
                          <td
                            key={c.id}
                            className={cn(
                              'px-4 py-2 text-center font-mono text-sm',
                              isDrift ? 'text-amber-400 bg-amber-950/30' : val === UNAVAILABLE ? 'text-slate-500 italic' : 'text-slate-400'
                            )}
                          >
                            {val}
                            {isDrift && (
                              <span className="ml-1 text-xs text-amber-500" title="Differs from majority">(drift)</span>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
