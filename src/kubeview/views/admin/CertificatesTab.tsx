import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { ShieldCheck, Search, AlertTriangle, CheckCircle, XCircle, Clock, ArrowUpDown, Eye, EyeOff } from 'lucide-react';
import { k8sList } from '../../engine/query';
import { Panel } from '../../components/primitives/Panel';
import { Card } from '../../components/primitives/Card';
import { MetricGrid } from '../../components/primitives/MetricGrid';

// --- Types ---

interface CertInfo {
  name: string;
  namespace: string;
  uid: string;
  commonName: string;
  issuer: string;
  expiresAt: Date | null;
  createdAt: Date | null;
  status: 'critical' | 'warning' | 'healthy' | 'unknown';
  daysLeft: number | null;
  isSystem: boolean;
}

type StatusFilter = 'all' | 'critical' | 'warning' | 'healthy';
type SortField = 'expires' | 'name' | 'namespace' | 'issuer' | 'age';

// --- Certificate parsing helpers ---

function parseCertExpiry(base64Cert: string): { notAfter: Date | null; subject: string; issuer: string } {
  try {
    const pem = atob(base64Cert);
    const binary = Uint8Array.from(pem, c => c.charCodeAt(0));
    const pemText = new TextDecoder().decode(binary);
    const b64Match = pemText.match(/-----BEGIN CERTIFICATE-----\s*([\s\S]*?)\s*-----END CERTIFICATE-----/);
    if (!b64Match) return { notAfter: null, subject: '', issuer: '' };

    const derB64 = b64Match[1].replace(/\s/g, '');
    const der = Uint8Array.from(atob(derB64), c => c.charCodeAt(0));
    const text = new TextDecoder('ascii', { fatal: false }).decode(der);
    const dateMatches = [...text.matchAll(/(\d{6,14})Z/g)];

    if (dateMatches.length >= 2) {
      const raw = dateMatches[1][1];
      let year: number, month: number, day: number, hour: number, min: number, sec: number;
      if (raw.length === 12) {
        year = parseInt(raw.slice(0, 2));
        year += year >= 50 ? 1900 : 2000;
        month = parseInt(raw.slice(2, 4)) - 1;
        day = parseInt(raw.slice(4, 6));
        hour = parseInt(raw.slice(6, 8));
        min = parseInt(raw.slice(8, 10));
        sec = parseInt(raw.slice(10, 12));
      } else if (raw.length === 14) {
        year = parseInt(raw.slice(0, 4));
        month = parseInt(raw.slice(4, 6)) - 1;
        day = parseInt(raw.slice(6, 8));
        hour = parseInt(raw.slice(8, 10));
        min = parseInt(raw.slice(10, 12));
        sec = parseInt(raw.slice(12, 14));
      } else {
        return { notAfter: null, subject: '', issuer: '' };
      }
      return { notAfter: new Date(Date.UTC(year, month, day, hour, min, sec)), subject: '', issuer: '' };
    }
    return { notAfter: null, subject: '', issuer: '' };
  } catch {
    return { notAfter: null, subject: '', issuer: '' };
  }
}

function detectIssuer(secret: any): string {
  const annotations = secret.metadata?.annotations || {};
  if (annotations['cert-manager.io/issuer-name']) return 'cert-manager';
  if (Object.keys(annotations).some((k: string) => k.startsWith('service.beta.openshift.io/') || k.startsWith('service.alpha.openshift.io/'))) return 'service-ca';
  if ((secret.metadata?.namespace || '').startsWith('openshift-')) return 'platform';
  return 'manual';
}

import { isSystemNamespace } from '../../engine/namespace';

function extractCertInfo(secret: any): CertInfo {
  const annotations = secret.metadata?.annotations || {};
  const name = secret.metadata?.name || '';
  const namespace = secret.metadata?.namespace || '';
  const createdAt = secret.metadata?.creationTimestamp ? new Date(secret.metadata.creationTimestamp) : null;

  let expiresAt: Date | null = null;
  let commonName = '';
  const issuer = detectIssuer(secret);

  // Strategy 1: cert-manager annotations
  if (annotations['cert-manager.io/certificate-expiry']) {
    expiresAt = new Date(annotations['cert-manager.io/certificate-expiry']);
  }
  if (annotations['cert-manager.io/common-name']) {
    commonName = annotations['cert-manager.io/common-name'];
  }

  // Strategy 2: OpenShift service-ca annotations
  if (!expiresAt && annotations['service.beta.openshift.io/expiry']) {
    const val = annotations['service.beta.openshift.io/expiry'];
    expiresAt = isNaN(Number(val)) ? new Date(val) : new Date(Number(val) * 1000);
  }
  if (!expiresAt && annotations['service.alpha.openshift.io/expiry']) {
    const val = annotations['service.alpha.openshift.io/expiry'];
    expiresAt = isNaN(Number(val)) ? new Date(val) : new Date(Number(val) * 1000);
  }

  // Strategy 3: Parse X.509 from tls.crt
  if (!expiresAt && secret.data?.['tls.crt']) {
    const parsed = parseCertExpiry(secret.data['tls.crt']);
    if (parsed.notAfter) expiresAt = parsed.notAfter;
    if (parsed.subject && !commonName) commonName = parsed.subject;
  }

  // Validate parsed date
  if (expiresAt && isNaN(expiresAt.getTime())) expiresAt = null;

  const now = Date.now();
  const daysLeft = expiresAt ? Math.floor((expiresAt.getTime() - now) / (1000 * 60 * 60 * 24)) : null;

  let status: CertInfo['status'] = 'unknown';
  if (daysLeft !== null) {
    if (daysLeft < 0) status = 'critical';
    else if (daysLeft < 7) status = 'critical';
    else if (daysLeft < 30) status = 'warning';
    else status = 'healthy';
  }

  return {
    name, namespace, uid: secret.metadata?.uid || name,
    commonName: commonName || '\u2014',
    issuer, expiresAt, createdAt,
    status, daysLeft,
    isSystem: isSystemNamespace(namespace),
  };
}

function formatRelative(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days < 0) return `expired ${Math.abs(days)}d ago`;
  if (days === 0) return 'today';
  if (days === 1) return 'in 1 day';
  return `in ${days} days`;
}

function formatDate(d: Date | null): string {
  if (!d) return '\u2014';
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

// --- Component ---

export function CertificatesTab({ go }: { go: (path: string, title: string) => void }) {
  const [search, setSearch] = React.useState('');
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>('all');
  const [sortField, setSortField] = React.useState<SortField>('expires');
  const [sortAsc, setSortAsc] = React.useState(true);
  const [showSystem, setShowSystem] = React.useState(false);

  const { data: secrets = [], isLoading, error } = useQuery<any[]>({
    queryKey: ['k8s', 'list', '/api/v1/secrets?fieldSelector=type=kubernetes.io/tls'],
    queryFn: () => k8sList('/api/v1/secrets?fieldSelector=type=kubernetes.io/tls'),
    staleTime: 60000,
  });

  const certs = React.useMemo(() => secrets.map(extractCertInfo), [secrets]);

  const filtered = React.useMemo(() => {
    let list = certs;
    if (!showSystem) list = list.filter(c => !c.isSystem);
    if (statusFilter !== 'all') list = list.filter(c => c.status === statusFilter);
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(c =>
        c.name.toLowerCase().includes(q) ||
        c.namespace.toLowerCase().includes(q) ||
        c.issuer.toLowerCase().includes(q) ||
        c.commonName.toLowerCase().includes(q)
      );
    }
    return list;
  }, [certs, showSystem, statusFilter, search]);

  const sorted = React.useMemo(() => {
    const arr = [...filtered];
    const dir = sortAsc ? 1 : -1;
    arr.sort((a, b) => {
      switch (sortField) {
        case 'expires': {
          const aV = a.expiresAt?.getTime() ?? Infinity;
          const bV = b.expiresAt?.getTime() ?? Infinity;
          return (aV - bV) * dir;
        }
        case 'name': return a.name.localeCompare(b.name) * dir;
        case 'namespace': return a.namespace.localeCompare(b.namespace) * dir;
        case 'issuer': return a.issuer.localeCompare(b.issuer) * dir;
        case 'age': {
          const aV = a.createdAt?.getTime() ?? 0;
          const bV = b.createdAt?.getTime() ?? 0;
          return (aV - bV) * dir;
        }
        default: return 0;
      }
    });
    return arr;
  }, [filtered, sortField, sortAsc]);

  // Summary counts
  const counts = React.useMemo(() => {
    const base = showSystem ? certs : certs.filter(c => !c.isSystem);
    return {
      total: base.length,
      critical: base.filter(c => c.status === 'critical').length,
      warning: base.filter(c => c.status === 'warning').length,
      healthy: base.filter(c => c.status === 'healthy' || c.status === 'unknown').length,
    };
  }, [certs, showSystem]);

  // Issuer breakdown
  const issuerCounts = React.useMemo(() => {
    const base = showSystem ? certs : certs.filter(c => !c.isSystem);
    const map: Record<string, number> = {};
    for (const c of base) map[c.issuer] = (map[c.issuer] || 0) + 1;
    return map;
  }, [certs, showSystem]);

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortAsc(!sortAsc);
    else { setSortField(field); setSortAsc(true); }
  };

  const SortHeader = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button onClick={() => handleSort(field)} className="flex items-center gap-1 text-left hover:text-slate-200 transition-colors">
      {children}
      {sortField === field && <ArrowUpDown className="w-3 h-3 text-blue-400" />}
    </button>
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full" />
        <span className="ml-3 text-sm text-slate-400">Loading TLS certificates...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <XCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
        <div className="text-sm text-red-400 mb-1">Failed to load certificates</div>
        <p className="text-xs text-slate-500">{(error as Error).message}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <MetricGrid>
        <Card className="p-3">
          <div className="text-xs text-slate-400 mb-1">Total Certificates</div>
          <div className="text-xl font-bold text-slate-100">{counts.total}</div>
          <div className="text-xs text-slate-500 mt-0.5">
            {Object.entries(issuerCounts).map(([k, v]) => `${v} ${k}`).join(', ') || 'none'}
          </div>
        </Card>
        <button onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
          className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors',
            counts.critical > 0 ? 'border-red-800 hover:border-red-600' : 'border-slate-800',
            statusFilter === 'critical' && 'ring-1 ring-red-500')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Critical (&lt; 7d)</span>
            {counts.critical > 0 && <XCircle className="w-3.5 h-3.5 text-red-500" />}
          </div>
          <div className={cn('text-xl font-bold', counts.critical > 0 ? 'text-red-400' : 'text-slate-100')}>{counts.critical}</div>
          <div className="text-xs text-slate-500 mt-0.5">expired or expiring soon</div>
        </button>
        <button onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
          className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors',
            counts.warning > 0 ? 'border-yellow-800 hover:border-yellow-600' : 'border-slate-800',
            statusFilter === 'warning' && 'ring-1 ring-yellow-500')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Warning (&lt; 30d)</span>
            {counts.warning > 0 && <AlertTriangle className="w-3.5 h-3.5 text-yellow-500" />}
          </div>
          <div className={cn('text-xl font-bold', counts.warning > 0 ? 'text-yellow-400' : 'text-slate-100')}>{counts.warning}</div>
          <div className="text-xs text-slate-500 mt-0.5">needs attention</div>
        </button>
        <button onClick={() => setStatusFilter(statusFilter === 'healthy' ? 'all' : 'healthy')}
          className={cn('bg-slate-900 rounded-lg border p-3 text-left transition-colors',
            'border-slate-800 hover:border-green-800',
            statusFilter === 'healthy' && 'ring-1 ring-green-500')}>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-slate-400">Healthy (&gt; 30d)</span>
            <CheckCircle className="w-3.5 h-3.5 text-green-500" />
          </div>
          <div className="text-xl font-bold text-green-400">{counts.healthy}</div>
          <div className="text-xs text-slate-500 mt-0.5">valid or unknown expiry</div>
        </button>
      </MetricGrid>

      {/* Search, filters, toggle */}
      <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
          <input
            type="text" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, namespace, issuer..."
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-slate-900 border border-slate-800 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:border-blue-600"
          />
        </div>
        <div className="flex items-center gap-2">
          {statusFilter !== 'all' && (
            <button onClick={() => setStatusFilter('all')}
              className="text-xs px-2 py-1 bg-slate-800 text-slate-300 rounded-sm hover:bg-slate-700 transition-colors">
              Clear filter
            </button>
          )}
          <button onClick={() => setShowSystem(!showSystem)}
            className={cn('flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md transition-colors',
              showSystem ? 'bg-blue-900/40 text-blue-300 border border-blue-800' : 'bg-slate-900 text-slate-400 border border-slate-800 hover:text-slate-200')}>
            {showSystem ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
            System certs ({certs.filter(c => c.isSystem).length})
          </button>
        </div>
      </div>

      {/* Certificate table */}
      <Panel title={`TLS Certificates (${sorted.length})`} icon={<ShieldCheck className="w-4 h-4 text-blue-400" />}>
        {sorted.length === 0 ? (
          <div className="text-center py-8">
            <ShieldCheck className="w-8 h-8 text-slate-600 mx-auto mb-2" />
            <div className="text-sm text-slate-500">No certificates match the current filters</div>
            <p className="text-xs text-slate-600 mt-1">Try adjusting your search or showing system certificates.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-slate-500 border-b border-slate-800">
                  <th className="py-2 pl-2 pr-1 w-6"></th>
                  <th className="py-2 px-2 text-left font-normal"><SortHeader field="name">Name</SortHeader></th>
                  <th className="py-2 px-2 text-left font-normal"><SortHeader field="namespace">Namespace</SortHeader></th>
                  <th className="py-2 px-2 text-left font-normal">Common Name</th>
                  <th className="py-2 px-2 text-left font-normal"><SortHeader field="issuer">Issuer</SortHeader></th>
                  <th className="py-2 px-2 text-left font-normal"><SortHeader field="expires">Expires</SortHeader></th>
                  <th className="py-2 px-2 text-left font-normal"><SortHeader field="age">Age</SortHeader></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50">
                {sorted.map(cert => (
                  <tr key={cert.uid} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2 pl-2 pr-1">
                      <StatusDot status={cert.status} />
                    </td>
                    <td className="py-2 px-2">
                      <button onClick={() => go(`/r/v1~secrets/${cert.namespace}/${cert.name}`, cert.name)}
                        className="text-blue-400 hover:text-blue-300 hover:underline transition-colors font-medium truncate max-w-[200px] block">
                        {cert.name}
                      </button>
                    </td>
                    <td className="py-2 px-2">
                      <span className="text-slate-400 truncate max-w-[120px] block">{cert.namespace}</span>
                    </td>
                    <td className="py-2 px-2">
                      <span className="text-slate-300 truncate max-w-[180px] block font-mono">{cert.commonName}</span>
                    </td>
                    <td className="py-2 px-2">
                      <IssuerBadge issuer={cert.issuer} />
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex flex-col">
                        <span className={cn('font-medium', statusColor(cert.status))}>
                          {formatRelative(cert.daysLeft)}
                        </span>
                        <span className="text-slate-600 text-xs">{formatDate(cert.expiresAt)}</span>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <span className="text-slate-500">{formatDate(cert.createdAt)}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

// --- Small subcomponents ---

function StatusDot({ status }: { status: CertInfo['status'] }) {
  const cls = status === 'critical' ? 'bg-red-500' :
    status === 'warning' ? 'bg-yellow-500' :
    status === 'healthy' ? 'bg-green-500' : 'bg-slate-600';
  return <span className={cn('inline-block w-2.5 h-2.5 rounded-full', cls)} />;
}

function IssuerBadge({ issuer }: { issuer: string }) {
  const styles: Record<string, string> = {
    'cert-manager': 'bg-purple-950/50 text-purple-300 border-purple-800/50',
    'service-ca': 'bg-blue-950/50 text-blue-300 border-blue-800/50',
    'platform': 'bg-cyan-950/50 text-cyan-300 border-cyan-800/50',
    'manual': 'bg-slate-800 text-slate-400 border-slate-700',
  };
  return (
    <span className={cn('inline-block px-1.5 py-0.5 rounded-sm text-xs border', styles[issuer] || styles.manual)}>
      {issuer}
    </span>
  );
}

function statusColor(status: CertInfo['status']): string {
  switch (status) {
    case 'critical': return 'text-red-400';
    case 'warning': return 'text-yellow-400';
    case 'healthy': return 'text-green-400';
    default: return 'text-slate-400';
  }
}
