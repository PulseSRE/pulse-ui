import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Shield, Globe, Image, Network, Cpu, Lock, ChevronDown, ChevronRight,
  Save, Loader2, Plus, Trash2, AlertTriangle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sGet, k8sPatch } from '../engine/query';
import { useUIStore } from '../store/uiStore';
import { ConfirmDialog } from './feedback/ConfirmDialog';

const CONFIG_BASE = '/apis/config.openshift.io/v1';
// CRDs use merge-patch, not strategic-merge-patch
const MERGE_PATCH = 'application/merge-patch+json';

interface ConfigSection {
  id: string;
  title: string;
  icon: React.ReactNode;
  apiPath: string;
  description: string;
}

const CONFIG_SECTIONS: ConfigSection[] = [
  { id: 'oauth', title: 'OAuth', icon: <Shield className="w-4 h-4 text-teal-500" />, apiPath: `${CONFIG_BASE}/oauths/cluster`, description: 'Identity providers and authentication' },
  { id: 'proxy', title: 'Proxy', icon: <Globe className="w-4 h-4 text-blue-500" />, apiPath: `${CONFIG_BASE}/proxies/cluster`, description: 'Cluster-wide proxy settings' },
  { id: 'image', title: 'Image', icon: <Image className="w-4 h-4 text-purple-500" />, apiPath: `${CONFIG_BASE}/images/cluster`, description: 'Allowed registries and image policies' },
  { id: 'ingress', title: 'Ingress', icon: <Network className="w-4 h-4 text-orange-500" />, apiPath: `${CONFIG_BASE}/ingresses/cluster`, description: 'Default ingress domain and settings' },
  { id: 'scheduler', title: 'Scheduler', icon: <Cpu className="w-4 h-4 text-green-500" />, apiPath: `${CONFIG_BASE}/schedulers/cluster`, description: 'Pod scheduling profiles and policies' },
  { id: 'apiserver', title: 'API Server', icon: <Lock className="w-4 h-4 text-red-500" />, apiPath: `${CONFIG_BASE}/apiservers/cluster`, description: 'TLS, audit policy, encryption' },
];

export default function ClusterConfig() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  return (
    <div className="space-y-2">
      {CONFIG_SECTIONS.map((section) => (
        <ConfigSectionPanel
          key={section.id}
          section={section}
          expanded={expandedSection === section.id}
          onToggle={() => setExpandedSection(expandedSection === section.id ? null : section.id)}
        />
      ))}
    </div>
  );
}

function ConfigSectionPanel({ section, expanded, onToggle }: {
  section: ConfigSection;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['admin', 'config', section.id],
    queryFn: () => k8sGet<any>(section.apiPath).catch(() => null),
    staleTime: 60000,
    enabled: expanded,
  });

  return (
    <div className="bg-slate-900 rounded-lg border border-slate-800">
      <button onClick={onToggle} className="w-full px-4 py-3 flex items-center gap-3 hover:bg-slate-800/50 transition-colors">
        {section.icon}
        <div className="flex-1 text-left">
          <div className="text-sm font-medium text-slate-200">{section.title}</div>
          <div className="text-xs text-slate-500">{section.description}</div>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 text-slate-500" /> : <ChevronRight className="w-4 h-4 text-slate-500" />}
      </button>
      {expanded && (
        <div className="border-t border-slate-800 p-4">
          {isLoading && <div className="text-sm text-slate-500 text-center py-4">Loading...</div>}
          {error && <div className="text-sm text-red-400 text-center py-4">Failed to load configuration</div>}
          {data && !isLoading && (
            <ConfigEditor section={section} data={data} />
          )}
        </div>
      )}
    </div>
  );
}

function ConfigEditor({ section, data }: { section: ConfigSection; data: any }) {
  switch (section.id) {
    case 'oauth': return <OAuthEditor data={data} apiPath={section.apiPath} />;
    case 'proxy': return <ProxyEditor data={data} apiPath={section.apiPath} />;
    case 'image': return <ImageEditor data={data} apiPath={section.apiPath} />;
    case 'ingress': return <IngressEditor data={data} apiPath={section.apiPath} />;
    case 'scheduler': return <SchedulerEditor data={data} apiPath={section.apiPath} />;
    case 'apiserver': return <APIServerEditor data={data} apiPath={section.apiPath} />;
    default: return null;
  }
}

// ===== OAuth =====
function OAuthEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const providers = data.spec?.identityProviders || [];
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newType, setNewType] = useState('HTPasswd');
  const [newName, setNewName] = useState('');
  // Type-specific fields
  const [secretName, setSecretName] = useState('');
  const [clientID, setClientID] = useState('');
  const [issuer, setIssuer] = useState('');
  const [ldapUrl, setLdapUrl] = useState('');
  const [orgs, setOrgs] = useState('');
  const [pendingRemove, setPendingRemove] = useState<string | null>(null);

  const handleRemoveProvider = (name: string) => {
    setPendingRemove(name);
  };

  const executeRemoveProvider = async () => {
    if (!pendingRemove) return;
    const name = pendingRemove;
    setPendingRemove(null);
    setSaving(true);
    try {
      const updated = providers.filter((p: any) => p.name !== name);
      await k8sPatch(apiPath, { spec: { identityProviders: updated } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'Identity provider removed', detail: name });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'oauth'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update OAuth', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  const handleAddProvider = async () => {
    if (!newName.trim()) { addToast({ type: 'error', title: 'Provider name is required' }); return; }

    const provider: any = { name: newName.trim(), mappingMethod: 'claim', type: newType };

    if (newType === 'HTPasswd') {
      if (!secretName.trim()) { addToast({ type: 'error', title: 'Secret name is required', detail: 'Create a Secret with htpasswd data first, then enter its name here' }); return; }
      provider.htpasswd = { fileData: { name: secretName.trim() } };
    } else if (newType === 'LDAP') {
      if (!ldapUrl.trim()) { addToast({ type: 'error', title: 'LDAP URL is required' }); return; }
      provider.ldap = { url: ldapUrl.trim(), insecure: ldapUrl.startsWith('ldap://'), attributes: { id: ['dn'], email: ['mail'], name: ['cn'], preferredUsername: ['uid'] } };
    } else if (newType === 'GitHub') {
      if (!clientID.trim() || !secretName.trim()) { addToast({ type: 'error', title: 'Client ID and Secret name are required' }); return; }
      provider.github = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() }, organizations: orgs.trim() ? orgs.split(',').map(s => s.trim()) : [] };
    } else if (newType === 'Google') {
      if (!clientID.trim() || !secretName.trim()) { addToast({ type: 'error', title: 'Client ID and Secret name are required' }); return; }
      provider.google = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() } };
    } else if (newType === 'OpenID') {
      if (!clientID.trim() || !secretName.trim() || !issuer.trim()) { addToast({ type: 'error', title: 'Client ID, Secret name, and Issuer URL are required' }); return; }
      provider.openID = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() }, issuer: issuer.trim(), claims: { email: ['email'], name: ['name'], preferredUsername: ['preferred_username'] } };
    }

    setSaving(true);
    try {
      await k8sPatch(apiPath, { spec: { identityProviders: [...providers, provider] } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'Identity provider added', detail: `${newName} (${newType})` });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'oauth'] });
      resetForm();
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to add provider', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  const resetForm = () => {
    setAdding(false);
    setNewName('');
    setSecretName('');
    setClientID('');
    setIssuer('');
    setLdapUrl('');
    setOrgs('');
  };

  return (
    <div className="space-y-3">
      <div className="text-xs text-slate-400 mb-2">Token max age: {data.spec?.tokenConfig?.accessTokenMaxAgeSeconds ? `${data.spec.tokenConfig.accessTokenMaxAgeSeconds / 3600}h` : 'default (24h)'}</div>
      {providers.length === 0 ? (
        <div className="text-sm text-slate-500 py-2">No identity providers configured</div>
      ) : (
        providers.map((p: any, i: number) => (
          <div key={i} className="flex items-center justify-between p-3 rounded bg-slate-800/50 border border-slate-700">
            <div>
              <div className="text-sm font-medium text-slate-200">{p.name}</div>
              <div className="text-xs text-slate-500">{p.type} · mapping: {p.mappingMethod || 'claim'}</div>
            </div>
            <button onClick={() => handleRemoveProvider(p.name)} disabled={saving} className="p-1 text-slate-500 hover:text-red-400 disabled:opacity-50" title="Remove">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))
      )}
      {adding ? (
        <div className="p-4 rounded bg-slate-800/50 border border-blue-800 space-y-3">
          <div className="flex gap-2">
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Provider name" className="flex-1 px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500" autoFocus />
            <select value={newType} onChange={(e) => { setNewType(e.target.value); setSecretName(''); setClientID(''); setIssuer(''); setLdapUrl(''); setOrgs(''); }} className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200">
              <option>HTPasswd</option>
              <option>LDAP</option>
              <option>GitHub</option>
              <option>Google</option>
              <option>OpenID</option>
            </select>
          </div>

          {/* Type-specific fields */}
          {newType === 'HTPasswd' && (
            <FieldRow label="HTPasswd Secret name" value={secretName} onChange={setSecretName} placeholder="htpass-secret (must exist in openshift-config)" />
          )}
          {newType === 'LDAP' && (
            <FieldRow label="LDAP URL" value={ldapUrl} onChange={setLdapUrl} placeholder="ldap://ldap.example.com/ou=users,dc=example,dc=com?uid" />
          )}
          {(newType === 'GitHub' || newType === 'Google' || newType === 'OpenID') && (
            <>
              <FieldRow label="Client ID" value={clientID} onChange={setClientID} placeholder="OAuth client ID from provider" />
              <FieldRow label="Client Secret name" value={secretName} onChange={setSecretName} placeholder="Secret name in openshift-config namespace" />
            </>
          )}
          {newType === 'GitHub' && (
            <FieldRow label="Organizations (comma-separated, optional)" value={orgs} onChange={setOrgs} placeholder="my-org, other-org" />
          )}
          {newType === 'OpenID' && (
            <FieldRow label="Issuer URL" value={issuer} onChange={setIssuer} placeholder="https://accounts.google.com" />
          )}

          <div className="flex items-center gap-2 pt-1">
            <button onClick={handleAddProvider} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add Provider
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Cancel</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setAdding(true)} className="flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300">
          <Plus className="w-3 h-3" /> Add identity provider
        </button>
      )}
      <ConfirmDialog
        open={!!pendingRemove}
        onClose={() => setPendingRemove(null)}
        onConfirm={executeRemoveProvider}
        title={`Remove identity provider "${pendingRemove}"?`}
        description="Users authenticating through this provider will lose access. This change takes effect immediately."
        confirmLabel="Remove"
        variant="danger"
        loading={saving}
      />
    </div>
  );
}

// ===== Proxy =====
function ProxyEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const spec = data.spec || {};
  const [httpProxy, setHttpProxy] = useState(spec.httpProxy || '');
  const [httpsProxy, setHttpsProxy] = useState(spec.httpsProxy || '');
  const [noProxy, setNoProxy] = useState(spec.noProxy || '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const handleSave = async () => {
    setSaving(true);
    try {
      await k8sPatch(apiPath, { spec: { httpProxy, httpsProxy, noProxy } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'Proxy settings updated' });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'proxy'] });
      setDirty(false);
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update proxy', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <FieldRow label="HTTP Proxy" value={httpProxy} onChange={(v) => { setHttpProxy(v); setDirty(true); }} placeholder="http://proxy.example.com:3128" />
      <FieldRow label="HTTPS Proxy" value={httpsProxy} onChange={(v) => { setHttpsProxy(v); setDirty(true); }} placeholder="http://proxy.example.com:3128" />
      <FieldRow label="No Proxy" value={noProxy} onChange={(v) => { setNoProxy(v); setDirty(true); }} placeholder=".cluster.local,169.254.169.254,10.0.0.0/8" multiline />
      {spec.trustedCA?.name && (
        <div className="text-xs text-slate-500">Trusted CA ConfigMap: <span className="text-slate-300 font-mono">{spec.trustedCA.name}</span></div>
      )}
      {dirty && (
        <SaveBar saving={saving} onSave={handleSave} onReset={() => { setHttpProxy(spec.httpProxy || ''); setHttpsProxy(spec.httpsProxy || ''); setNoProxy(spec.noProxy || ''); setDirty(false); }} warning="Changes will affect all cluster components" />
      )}
    </div>
  );
}

// ===== Image =====
function ImageEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const spec = data.spec || {};
  const registrySources = spec.registrySources || {};
  const allowedRegistries: string[] = registrySources.allowedRegistries || [];
  const blockedRegistries: string[] = registrySources.blockedRegistries || [];
  const insecureRegistries: string[] = registrySources.insecureRegistries || [];
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [newReg, setNewReg] = useState('');
  const [regType, setRegType] = useState<'allowed' | 'blocked' | 'insecure'>('allowed');
  const [saving, setSaving] = useState(false);

  const handleAddRegistry = async () => {
    if (!newReg.trim()) return;
    setSaving(true);
    try {
      const key = regType === 'allowed' ? 'allowedRegistries' : regType === 'blocked' ? 'blockedRegistries' : 'insecureRegistries';
      const current = regType === 'allowed' ? allowedRegistries : regType === 'blocked' ? blockedRegistries : insecureRegistries;
      const updated = [...current, newReg.trim()];
      await k8sPatch(apiPath, { spec: { registrySources: { [key]: updated } } }, MERGE_PATCH);
      addToast({ type: 'success', title: `Registry added to ${regType} list`, detail: newReg });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'image'] });
      setNewReg('');
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update image config', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  const handleRemoveRegistry = async (type: 'allowed' | 'blocked' | 'insecure', registry: string) => {
    setSaving(true);
    try {
      const key = type === 'allowed' ? 'allowedRegistries' : type === 'blocked' ? 'blockedRegistries' : 'insecureRegistries';
      const current = type === 'allowed' ? allowedRegistries : type === 'blocked' ? blockedRegistries : insecureRegistries;
      const updated = current.filter(r => r !== registry);
      await k8sPatch(apiPath, { spec: { registrySources: { [key]: updated.length > 0 ? updated : null } } }, MERGE_PATCH);
      addToast({ type: 'success', title: `Registry removed from ${type} list` });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'image'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update image config', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      {allowedRegistries.length > 0 && (
        <RegistryList label="Allowed Registries" items={allowedRegistries} color="green" description="Only these registries can be used" onRemove={(r) => handleRemoveRegistry('allowed', r)} disabled={saving} />
      )}
      {blockedRegistries.length > 0 && (
        <RegistryList label="Blocked Registries" items={blockedRegistries} color="red" description="These registries are denied" onRemove={(r) => handleRemoveRegistry('blocked', r)} disabled={saving} />
      )}
      {insecureRegistries.length > 0 && (
        <RegistryList label="Insecure Registries" items={insecureRegistries} color="yellow" description="HTTP allowed (no TLS)" onRemove={(r) => handleRemoveRegistry('insecure', r)} disabled={saving} />
      )}
      {allowedRegistries.length === 0 && blockedRegistries.length === 0 && insecureRegistries.length === 0 && (
        <div className="text-sm text-slate-500 py-2">No registry restrictions configured — all registries are allowed</div>
      )}
      {spec.additionalTrustedCA?.name && (
        <div className="text-xs text-slate-500">Additional trusted CAs: <span className="text-slate-300 font-mono">{spec.additionalTrustedCA.name}</span></div>
      )}
      <div className="flex items-center gap-2 pt-1">
        <input type="text" value={newReg} onChange={(e) => setNewReg(e.target.value)} placeholder="registry.example.com" className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 w-64 focus:outline-none focus:ring-1 focus:ring-blue-500" onKeyDown={(e) => e.key === 'Enter' && handleAddRegistry()} />
        <select value={regType} onChange={(e) => setRegType(e.target.value as any)} className="px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200">
          <option value="allowed">Allowed</option>
          <option value="blocked">Blocked</option>
          <option value="insecure">Insecure</option>
        </select>
        <button onClick={handleAddRegistry} disabled={saving || !newReg.trim()} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
        </button>
      </div>
    </div>
  );
}

function RegistryList({ label, items, color, description, onRemove, disabled }: {
  label: string; items: string[]; color: 'green' | 'red' | 'yellow'; description: string;
  onRemove: (registry: string) => void; disabled: boolean;
}) {
  const bgColor = { green: 'bg-green-900/30 border-green-800', red: 'bg-red-900/30 border-red-800', yellow: 'bg-yellow-900/30 border-yellow-800' }[color];
  const textColor = { green: 'text-green-300', red: 'text-red-300', yellow: 'text-yellow-300' }[color];
  return (
    <div>
      <div className="text-xs text-slate-400 mb-1">{label} <span className="text-slate-600">— {description}</span></div>
      <div className="flex flex-wrap gap-1.5">
        {items.map((r, i) => (
          <span key={i} className={cn('px-2 py-1 text-xs rounded border font-mono flex items-center gap-1.5', bgColor, textColor)}>
            {r}
            <button onClick={() => onRemove(r)} disabled={disabled} className="hover:text-white disabled:opacity-50" title="Remove">
              <Trash2 className="w-3 h-3" />
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ===== Ingress =====
function IngressEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const spec = data.spec || {};
  const [domain, setDomain] = useState(spec.domain || '');
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const componentRoutes = spec.componentRoutes || [];

  const handleSave = async () => {
    setSaving(true);
    try {
      await k8sPatch(apiPath, { spec: { domain } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'Ingress domain updated', detail: domain });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'ingress'] });
      setDirty(false);
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update ingress', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      <FieldRow label="Default Domain" value={domain} onChange={(v) => { setDomain(v); setDirty(true); }} placeholder="apps.cluster.example.com" />
      {data.status?.defaultPlacement && (
        <div className="text-xs text-slate-500">Placement: <span className="text-slate-300">{data.status.defaultPlacement}</span></div>
      )}
      {componentRoutes.length > 0 && (
        <div>
          <div className="text-xs text-slate-400 mb-1">Component Routes</div>
          {componentRoutes.map((r: any, i: number) => (
            <div key={i} className="text-xs text-slate-300 font-mono py-0.5">{r.namespace}/{r.name}: {r.hostname}</div>
          ))}
        </div>
      )}
      {dirty && (
        <SaveBar saving={saving} onSave={handleSave} onReset={() => { setDomain(spec.domain || ''); setDirty(false); }} />
      )}
    </div>
  );
}

// ===== Scheduler =====
function SchedulerEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const spec = data.spec || {};
  const profile = spec.profile || 'LowNodeUtilization';
  const [selectedProfile, setSelectedProfile] = useState(profile);
  const [saving, setSaving] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const profiles = [
    { value: 'LowNodeUtilization', label: 'Low Node Utilization', description: 'Spreads pods across nodes for balanced resource usage (default)' },
    { value: 'HighNodeUtilization', label: 'High Node Utilization', description: 'Packs pods onto fewer nodes to maximize utilization and save costs' },
    { value: 'NoScoring', label: 'No Scoring', description: 'Fastest scheduling — skips scoring, uses first feasible node' },
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      await k8sPatch(apiPath, { spec: { profile: selectedProfile } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'Scheduler profile updated', detail: selectedProfile });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'scheduler'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update scheduler', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-3">
      {profiles.map((p) => (
        <label key={p.value} className={cn('flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors',
          selectedProfile === p.value ? 'bg-blue-950/30 border-blue-800' : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
        )}>
          <input type="radio" name="scheduler-profile" value={p.value} checked={selectedProfile === p.value} onChange={() => setSelectedProfile(p.value)} className="mt-0.5" />
          <div>
            <div className="text-sm font-medium text-slate-200">{p.label}</div>
            <div className="text-xs text-slate-500">{p.description}</div>
          </div>
        </label>
      ))}
      {selectedProfile !== profile && (
        <SaveBar saving={saving} onSave={handleSave} onReset={() => setSelectedProfile(profile)} />
      )}
      {spec.defaultNodeSelector && (
        <div className="text-xs text-slate-500 pt-1">Default node selector: <span className="text-slate-300 font-mono">{spec.defaultNodeSelector}</span></div>
      )}
    </div>
  );
}

// ===== API Server =====
function APIServerEditor({ data, apiPath }: { data: any; apiPath: string }) {
  const spec = data.spec || {};
  const tlsProfile = spec.tlsSecurityProfile?.type || 'Intermediate';
  const [selectedTls, setSelectedTls] = useState(tlsProfile);
  const [saving, setSaving] = useState(false);
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();

  const tlsProfiles = [
    { value: 'Old', label: 'Old', description: 'TLS 1.0+, widest compatibility, least secure' },
    { value: 'Intermediate', label: 'Intermediate', description: 'TLS 1.2+, balanced security and compatibility (recommended)' },
    { value: 'Modern', label: 'Modern', description: 'TLS 1.3 only, highest security, limited client support' },
  ];

  const handleSave = async () => {
    setSaving(true);
    try {
      await k8sPatch(apiPath, { spec: { tlsSecurityProfile: { type: selectedTls } } }, MERGE_PATCH);
      addToast({ type: 'success', title: 'TLS profile updated', detail: selectedTls });
      queryClient.invalidateQueries({ queryKey: ['admin', 'config', 'apiserver'] });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to update API server', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-slate-400 mb-2">TLS Security Profile</div>
        <div className="space-y-2">
          {tlsProfiles.map((p) => (
            <label key={p.value} className={cn('flex items-start gap-3 p-3 rounded border cursor-pointer transition-colors',
              selectedTls === p.value ? 'bg-blue-950/30 border-blue-800' : 'bg-slate-800/30 border-slate-700 hover:border-slate-600'
            )}>
              <input type="radio" name="tls-profile" value={p.value} checked={selectedTls === p.value} onChange={() => setSelectedTls(p.value)} className="mt-0.5" />
              <div>
                <div className="text-sm font-medium text-slate-200">{p.label}</div>
                <div className="text-xs text-slate-500">{p.description}</div>
              </div>
            </label>
          ))}
        </div>
        {selectedTls !== tlsProfile && (
          <div className="pt-2">
            <SaveBar saving={saving} onSave={handleSave} onReset={() => setSelectedTls(tlsProfile)} warning="API server will restart" />
          </div>
        )}
      </div>
      {spec.audit?.profile && (
        <div className="text-xs text-slate-500">Audit profile: <span className="text-slate-300">{spec.audit.profile}</span></div>
      )}
      {spec.encryption?.type && (
        <div className="text-xs text-slate-500">Encryption: <span className="text-slate-300">{spec.encryption.type}</span></div>
      )}
      {spec.clientCA?.name && (
        <div className="text-xs text-slate-500">Client CA: <span className="text-slate-300 font-mono">{spec.clientCA.name}</span></div>
      )}
    </div>
  );
}

// ===== Shared =====
function FieldRow({ label, value, onChange, placeholder, multiline }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-400 block mb-1">{label}</label>
      {multiline ? (
        <textarea value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={3} className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-blue-500" />
      ) : (
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full px-2 py-1.5 text-sm bg-slate-900 border border-slate-600 rounded text-slate-200 placeholder-slate-500 font-mono focus:outline-none focus:ring-1 focus:ring-blue-500" />
      )}
    </div>
  );
}

function SaveBar({ saving, onSave, onReset, warning }: {
  saving: boolean; onSave: () => void; onReset: () => void; warning?: string;
}) {
  return (
    <div className="flex items-center gap-2 pt-1">
      <button onClick={onSave} disabled={saving} className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50">
        {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
      </button>
      <button onClick={onReset} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Reset</button>
      {warning && <span className="text-xs text-yellow-400 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {warning}</span>}
    </div>
  );
}
