/**
 * Identity & Access › Sign-in: the cluster's identity providers
 * (config.openshift.io/v1 OAuth `cluster`), moved here from Admin › Cluster
 * Config so the IdP check and its fix are on one page.
 *
 * Every save is conditional on the resourceVersion the editor read: the
 * merge patch carries `metadata.resourceVersion`, so if someone else changed
 * the providers since, the server answers 409 and nothing is overwritten
 * (it used to merge-patch the whole list from cached data). Each change is
 * confirmed with the exact provider list before and after, dry-run first.
 *
 * HTPasswd users are added in the browser: the password is bcrypt-hashed
 * here and only the hash is written to the provider's Secret.
 */
import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, UserPlus, Shield } from 'lucide-react';
import { k8sCreate, k8sGet, k8sPatch } from '../../engine/query';
import { MERGE_PATCH } from '../../engine/workloadActions';
import { useActiveClusterId } from '../../hooks/useClusterBase';
import { useCanI } from '../../hooks/useCanI';
import { useActionDialog } from '../../components/ActionDialog';
import { Card } from '../../components/primitives/Card';
import { Button } from '../../components/primitives/Button';
import { LoadError } from '../../components/primitives/LoadError';
import { PulseError } from '../../engine/errors';
import {
  HTPASSWD_KEY, fromBase64, hashPassword, parseHtpasswd, toBase64, upsertHtpasswd, validateHtpasswdUser,
} from '../../engine/htpasswd';

export const OAUTH_PATH = '/apis/config.openshift.io/v1/oauths/cluster';
const CONFIG_NS = 'openshift-config';
const secretPath = (name: string) => `/api/v1/namespaces/${CONFIG_NS}/secrets/${encodeURIComponent(name)}`;
const inputCls = 'w-full px-2 py-1.5 text-xs bg-slate-900 border border-slate-700 rounded-sm text-slate-200';
const DNS1123 = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

export interface IdentityProvider { name: string; type: string; mappingMethod?: string; htpasswd?: { fileData?: { name?: string } }; [k: string]: unknown }
interface OAuthConfig { metadata: { resourceVersion?: string }; spec?: { identityProviders?: IdentityProvider[]; tokenConfig?: { accessTokenMaxAgeSeconds?: number } } }

/** The conditional merge patch that sets the provider list. */
export function providersPatch(resourceVersion: string | undefined, providers: IdentityProvider[]) {
  return { metadata: { resourceVersion }, spec: { identityProviders: providers } };
}

function withDryRun(path: string) { return `${path}?dryRun=All`; }

function ProviderDiff({ before, after }: { before: IdentityProvider[]; after: IdentityProvider[] }) {
  return (
    <div className="mt-3 space-y-1 text-xs">
      <div className="text-slate-400">Providers now: <span className="font-mono text-slate-300">{before.map((p) => p.name).join(', ') || '(none)'}</span></div>
      <div className="text-slate-400">After: <span className="font-mono text-slate-300">{after.map((p) => p.name).join(', ') || '(none)'}</span></div>
    </div>
  );
}

function SignInHealth() {
  const clusterId = useActiveClusterId();
  const q = useQuery({
    queryKey: ['signin', 'auth-operator', clusterId],
    queryFn: () => k8sGet<{ status?: { conditions?: Array<{ type: string; status: string; message?: string }> } }>('/apis/config.openshift.io/v1/clusteroperators/authentication', clusterId),
    refetchInterval: 15000,
  });
  if (q.isLoading) return <p className="text-xs text-slate-500">Checking the authentication operator…</p>;
  if (q.isError) return <p className="text-xs text-slate-400" data-testid="signin-health">Sign-in health: could not check ({q.error instanceof Error ? q.error.message : 'unknown error'}).</p>;
  const cond = (t: string) => q.data?.status?.conditions?.find((c) => c.type === t);
  const progressing = cond('Progressing')?.status === 'True';
  const degraded = cond('Degraded')?.status === 'True';
  const available = cond('Available')?.status === 'True';
  return (
    <p className="text-xs" data-testid="signin-health">
      <span className="text-slate-400">Authentication operator: </span>
      <span className={degraded ? 'text-red-300' : progressing ? 'text-amber-300' : available ? 'text-emerald-300' : 'text-slate-300'}>
        {degraded ? 'Degraded' : progressing ? 'Rolling out' : available ? 'Available' : 'Not available'}
      </span>
      {(degraded || progressing) && <span className="text-slate-500"> — {(degraded ? cond('Degraded') : cond('Progressing'))?.message}</span>}
    </p>
  );
}

/** Add or reset one user in an HTPasswd provider's Secret. */
function HtpasswdUserForm({ secretName, onDone }: { secretName: string; onDone: () => void }) {
  const clusterId = useActiveClusterId();
  const [user, setUser] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [readError, setReadError] = React.useState<unknown>(null);
  const [reading, setReading] = React.useState(false);
  const { open, dialog } = useActionDialog();
  const { allowed: canGet } = useCanI('get', '', 'secrets', CONFIG_NS);
  const { allowed: canPatch } = useCanI('patch', '', 'secrets', CONFIG_NS);
  const userErr = user ? validateHtpasswdUser(user) : null;

  const review = async () => {
    setReadError(null); setReading(true);
    try {
      const secret = await k8sGet<{ metadata: { resourceVersion?: string }; data?: Record<string, string> }>(secretPath(secretName), clusterId);
      const current = secret.data?.[HTPASSWD_KEY] ? fromBase64(secret.data[HTPASSWD_KEY]) : '';
      const existing = parseHtpasswd(current);
      const replaced = existing.some((e) => e.user === user);
      const rv = secret.metadata.resourceVersion;
      const pw = password;
      open({
        title: replaced ? `Reset the password of ${user}?` : `Add ${user} to ${secretName}?`,
        description: replaced
          ? `Replaces ${user}'s bcrypt hash in Secret ${CONFIG_NS}/${secretName}. Their current password stops working; existing sessions continue until they expire.`
          : `Adds ${user} to Secret ${CONFIG_NS}/${secretName} (${existing.length} → ${existing.length + 1} users). They can sign in once the authentication operator picks up the change, usually within a minute.`,
        confirmLabel: replaced ? 'Reset password' : 'Add user',
        what: 'Updating the htpasswd Secret',
        body: (
          <p className="mt-3 text-xs text-slate-400">
            The password is hashed in this browser with bcrypt (cost 10); only the hash is sent. Merge patch on <code className="font-mono text-slate-300">data.{HTPASSWD_KEY}</code>, conditional on the version just read (dry run first); other users are unchanged. Undo: {replaced ? 'reset the password again' : `remove the ${user} line from the Secret`}.
          </p>
        ),
        run: async (cid) => {
          const hash = await hashPassword(pw);
          const next = upsertHtpasswd(current, user, hash);
          const body = { metadata: { resourceVersion: rv }, data: { [HTPASSWD_KEY]: toBase64(next.text) } };
          await k8sPatch(withDryRun(secretPath(secretName)), body, MERGE_PATCH, cid);
          return k8sPatch(secretPath(secretName), body, MERGE_PATCH, cid);
        },
        success: replaced ? `Password reset for ${user}` : `${user} added`,
        onDone: () => { setUser(''); setPassword(''); onDone(); },
      });
    } catch (e) {
      setReadError(e);
    } finally {
      setReading(false);
    }
  };

  return (
    <form className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2 items-end" onSubmit={(e) => { e.preventDefault(); if (!userErr && user && password) void review(); }}>
      <label className="text-xs text-slate-400">Username
        <input aria-label={`Username for ${secretName}`} className={inputCls} value={user} onChange={(e) => setUser(e.target.value.trim())} autoComplete="off" />
        {userErr && <span className="text-red-400">{userErr}</span>}
      </label>
      <label className="text-xs text-slate-400">Password
        <input aria-label={`Password for ${secretName}`} type="password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
      </label>
      <Button size="sm" type="submit" disabled={!user || !password || !!userErr || !canGet || !canPatch} loading={reading}
        title={!canGet || !canPatch ? `You do not have permission to read and change Secrets in ${CONFIG_NS}` : undefined}>
        <UserPlus className="w-3.5 h-3.5" /> Review
      </Button>
      {(!canGet || !canPatch) && <p className="md:col-span-3 text-xs text-slate-500">You do not have permission to read and change Secrets in {CONFIG_NS}.</p>}
      {readError ? <LoadError className="md:col-span-3" title={`Secret ${CONFIG_NS}/${secretName} could not be read`} error={readError} /> : null}
      {dialog}
    </form>
  );
}

type NewType = 'HTPasswd' | 'LDAP' | 'GitHub' | 'Google' | 'OpenID';

function AddProviderForm({ data, onDone }: { data: OAuthConfig; onDone: () => void }) {
  const providers = data.spec?.identityProviders ?? [];
  const [type, setType] = React.useState<NewType>('HTPasswd');
  const [name, setName] = React.useState('');
  const [secretName, setSecretName] = React.useState('');
  const [createSecret, setCreateSecret] = React.useState(true);
  const [firstUser, setFirstUser] = React.useState('');
  const [firstPassword, setFirstPassword] = React.useState('');
  const [clientID, setClientID] = React.useState('');
  const [issuer, setIssuer] = React.useState('');
  const [ldapUrl, setLdapUrl] = React.useState('');
  const [orgs, setOrgs] = React.useState('');
  const { open, dialog } = useActionDialog();
  const { allowed: canCreateSecret } = useCanI('create', '', 'secrets', CONFIG_NS);

  const problems: string[] = [];
  if (!name.trim()) problems.push('Provider name is required');
  if (providers.some((p) => p.name === name.trim())) problems.push(`A provider named ${name.trim()} already exists`);
  if (type === 'HTPasswd') {
    if (!secretName.trim() || !DNS1123.test(secretName.trim())) problems.push('Secret name: lowercase letters, digits, "-" and "."');
    if (createSecret) {
      const err = validateHtpasswdUser(firstUser);
      if (err) problems.push(`First user: ${err}`);
      if (!firstPassword) problems.push('First user: a password is required');
      if (!canCreateSecret) problems.push(`You do not have permission to create Secrets in ${CONFIG_NS}`);
    }
  } else if (type === 'LDAP') {
    if (!ldapUrl.trim()) problems.push('LDAP URL is required');
  } else {
    if (!clientID.trim() || !secretName.trim()) problems.push('Client ID and client Secret name are required');
    if (type === 'OpenID' && !issuer.trim()) problems.push('Issuer URL is required');
  }

  const build = (): IdentityProvider => {
    const p: IdentityProvider = { name: name.trim(), mappingMethod: 'claim', type };
    if (type === 'HTPasswd') p.htpasswd = { fileData: { name: secretName.trim() } };
    else if (type === 'LDAP') p.ldap = { url: ldapUrl.trim(), insecure: ldapUrl.trim().startsWith('ldap://'), attributes: { id: ['dn'], email: ['mail'], name: ['cn'], preferredUsername: ['uid'] } };
    else if (type === 'GitHub') p.github = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() }, organizations: orgs.trim() ? orgs.split(',').map((s) => s.trim()).filter(Boolean) : [] };
    else if (type === 'Google') p.google = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() } };
    else p.openID = { clientID: clientID.trim(), clientSecret: { name: secretName.trim() }, issuer: issuer.trim(), claims: { email: ['email'], name: ['name'], preferredUsername: ['preferred_username'] } };
    return p;
  };

  const review = () => {
    const provider = build();
    const after = [...providers, provider];
    const rv = data.metadata.resourceVersion;
    const withSecret = type === 'HTPasswd' && createSecret;
    const user = firstUser; const pw = firstPassword; const sName = secretName.trim();
    open({
      title: `Add identity provider ${provider.name}?`,
      description: `${withSecret ? `Creates Secret ${CONFIG_NS}/${sName} with user ${user}, then adds` : 'Adds'} the ${type} provider to OAuth cluster. The authentication operator rolls out new oauth-openshift pods; sign-in can be briefly unavailable while it does.`,
      confirmLabel: 'Add provider',
      what: 'Adding the identity provider',
      body: (
        <>
          <ProviderDiff before={providers} after={after} />
          <pre className="mt-2 max-h-40 overflow-auto rounded bg-slate-950 p-2 text-[11px] text-slate-300">{JSON.stringify(provider, null, 2)}</pre>
          <p className="mt-2 text-xs text-slate-400">
            Merge patch of <code className="font-mono">spec.identityProviders</code> conditional on resourceVersion {rv ?? '(unknown)'} — refused if the providers changed since this page read them. Dry run first.
            {withSecret && ' The password is hashed in this browser with bcrypt; only the hash is sent.'} Undo: remove the provider{withSecret ? ' and delete the Secret' : ''}.
          </p>
        </>
      ),
      run: async (cid) => {
        if (withSecret) {
          const hash = await hashPassword(pw);
          const secret = { apiVersion: 'v1', kind: 'Secret', metadata: { name: sName, namespace: CONFIG_NS }, type: 'Opaque', data: { [HTPASSWD_KEY]: toBase64(upsertHtpasswd('', user, hash).text) } };
          await k8sCreate(withDryRun(`/api/v1/namespaces/${CONFIG_NS}/secrets`), secret, cid);
          await k8sPatch(withDryRun(OAUTH_PATH), providersPatch(rv, after), MERGE_PATCH, cid);
          await k8sCreate(`/api/v1/namespaces/${CONFIG_NS}/secrets`, secret, cid);
          try {
            return await k8sPatch(OAUTH_PATH, providersPatch(rv, after), MERGE_PATCH, cid);
          } catch (e) {
            throw new Error(`Secret ${sName} was created, but the provider was not added: ${e instanceof PulseError ? e.message : String(e)}`);
          }
        }
        await k8sPatch(withDryRun(OAUTH_PATH), providersPatch(rv, after), MERGE_PATCH, cid);
        return k8sPatch(OAUTH_PATH, providersPatch(rv, after), MERGE_PATCH, cid);
      },
      success: `Identity provider ${provider.name} added`,
      successDetail: 'The authentication operator is rolling out the change.',
      onDone,
    });
  };

  return (
    <div className="p-4 rounded-sm bg-slate-800/50 border border-slate-700 space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        <label className="text-xs text-slate-400">Provider name<input aria-label="Provider name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></label>
        <label className="text-xs text-slate-400">Type
          <select aria-label="Provider type" className={inputCls} value={type} onChange={(e) => setType(e.target.value as NewType)}>
            {(['HTPasswd', 'LDAP', 'GitHub', 'Google', 'OpenID'] as const).map((t) => <option key={t}>{t}</option>)}
          </select>
        </label>
        {type === 'HTPasswd' && (<>
          <label className="text-xs text-slate-400">Secret in {CONFIG_NS}<input aria-label="HTPasswd Secret name" className={inputCls} value={secretName} onChange={(e) => setSecretName(e.target.value.trim())} placeholder="htpass-secret" /></label>
          <label className="text-xs text-slate-400 flex items-center gap-2 mt-5"><input type="checkbox" checked={createSecret} onChange={(e) => setCreateSecret(e.target.checked)} /> Create the Secret with a first user</label>
          {createSecret && (<>
            <label className="text-xs text-slate-400">First user<input aria-label="First user" className={inputCls} value={firstUser} onChange={(e) => setFirstUser(e.target.value.trim())} autoComplete="off" /></label>
            <label className="text-xs text-slate-400">Password<input aria-label="First user password" type="password" className={inputCls} value={firstPassword} onChange={(e) => setFirstPassword(e.target.value)} autoComplete="new-password" /></label>
          </>)}
        </>)}
        {type === 'LDAP' && <label className="text-xs text-slate-400 md:col-span-2">LDAP URL<input aria-label="LDAP URL" className={inputCls} value={ldapUrl} onChange={(e) => setLdapUrl(e.target.value)} placeholder="ldaps://ldap.example.com/ou=users,dc=example,dc=com?uid" /></label>}
        {(type === 'GitHub' || type === 'Google' || type === 'OpenID') && (<>
          <label className="text-xs text-slate-400">Client ID<input aria-label="Client ID" className={inputCls} value={clientID} onChange={(e) => setClientID(e.target.value)} /></label>
          <label className="text-xs text-slate-400">Client Secret name (in {CONFIG_NS})<input aria-label="Client Secret name" className={inputCls} value={secretName} onChange={(e) => setSecretName(e.target.value.trim())} /></label>
        </>)}
        {type === 'GitHub' && <label className="text-xs text-slate-400 md:col-span-2">Organizations (comma-separated, optional)<input aria-label="Organizations" className={inputCls} value={orgs} onChange={(e) => setOrgs(e.target.value)} /></label>}
        {type === 'OpenID' && <label className="text-xs text-slate-400 md:col-span-2">Issuer URL<input aria-label="Issuer URL" className={inputCls} value={issuer} onChange={(e) => setIssuer(e.target.value)} /></label>}
      </div>
      {type === 'HTPasswd' && !createSecret && <p className="text-xs text-slate-500">The Secret must already exist in {CONFIG_NS} with an <code className="font-mono">htpasswd</code> key.</p>}
      {problems.length > 0 && (name || secretName || firstUser) && <ul className="text-xs text-amber-300 list-disc ml-4">{problems.map((p) => <li key={p}>{p}</li>)}</ul>}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={review} disabled={problems.length > 0}><Plus className="w-3 h-3" /> Review</Button>
        <Button size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
      </div>
      {dialog}
    </div>
  );
}

export function IdentityProvidersPanel() {
  const clusterId = useActiveClusterId();
  const queryClient = useQueryClient();
  const q = useQuery({ queryKey: ['signin', 'oauth', clusterId], queryFn: () => k8sGet<OAuthConfig>(OAUTH_PATH, clusterId) });
  const { allowed: canPatch, isLoading: permLoading } = useCanI('patch', 'config.openshift.io', 'oauths');
  const [adding, setAdding] = React.useState(false);
  const [userFormFor, setUserFormFor] = React.useState<string | null>(null);
  const { open, dialog } = useActionDialog();
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['signin'] });
    // Other readers of the OAuth config (Admin overview, Identity audit).
    queryClient.invalidateQueries({ queryKey: ['admin', 'oauth'] });
    queryClient.invalidateQueries({ queryKey: ['users', 'oauth'] });
  };

  if (q.isLoading) return <Card className="p-4"><p className="text-xs text-slate-500">Loading identity providers…</p></Card>;
  if (q.isError) return <LoadError title="The OAuth configuration could not be read — identity providers are unknown" error={q.error} onRetry={() => void q.refetch()} />;
  const data = q.data!;
  const providers = data.spec?.identityProviders ?? [];
  const denied = !permLoading && !canPatch;

  const remove = (p: IdentityProvider) => {
    const after = providers.filter((x) => x.name !== p.name);
    const rv = data.metadata.resourceVersion;
    open({
      title: `Remove identity provider ${p.name}?`,
      description: `Users who sign in through ${p.name} can no longer sign in. Their User and Identity objects and existing sessions are not deleted. The authentication operator rolls out new oauth-openshift pods.`,
      confirmLabel: 'Remove provider',
      variant: 'danger',
      what: 'Removing the identity provider',
      body: (
        <>
          <ProviderDiff before={providers} after={after} />
          <p className="mt-2 text-xs text-slate-400">Merge patch of <code className="font-mono">spec.identityProviders</code> conditional on resourceVersion {rv ?? '(unknown)'} (dry run first). Undo: add the provider back with the same settings{p.type === 'HTPasswd' ? '; its Secret is not deleted' : ''}.</p>
        </>
      ),
      run: async (cid) => {
        await k8sPatch(withDryRun(OAUTH_PATH), providersPatch(rv, after), MERGE_PATCH, cid);
        return k8sPatch(OAUTH_PATH, providersPatch(rv, after), MERGE_PATCH, cid);
      },
      success: `Identity provider ${p.name} removed`,
      onDone: refresh,
    });
  };

  return (
    <Card>
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-slate-100 flex items-center gap-2"><Shield className="w-4 h-4 text-teal-400" /> Identity providers</h2>
        <span className="text-xs text-slate-500">Token max age: {data.spec?.tokenConfig?.accessTokenMaxAgeSeconds ? `${data.spec.tokenConfig.accessTokenMaxAgeSeconds / 3600}h` : 'default (24h)'}</span>
      </div>
      <div className="p-4 space-y-3">
        <SignInHealth />
        {denied && <p className="text-xs text-slate-500">You do not have permission to change the OAuth configuration; the providers are read-only here.</p>}
        {providers.length === 0 ? (
          <p className="text-sm text-slate-400">No identity providers configured — only kubeadmin can sign in.</p>
        ) : providers.map((p) => (
          <div key={p.name} className="p-3 rounded-sm bg-slate-800/50 border border-slate-700">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-slate-200">{p.name}</div>
                <div className="text-xs text-slate-500">{p.type} · mapping: {p.mappingMethod || 'claim'}{p.htpasswd?.fileData?.name ? ` · Secret ${CONFIG_NS}/${p.htpasswd.fileData.name}` : ''}</div>
              </div>
              <div className="flex items-center gap-1">
                {p.type === 'HTPasswd' && p.htpasswd?.fileData?.name && (
                  <Button size="sm" variant="ghost" onClick={() => setUserFormFor(userFormFor === p.name ? null : p.name)}><UserPlus className="w-3.5 h-3.5" /> Add or reset user</Button>
                )}
                <Button size="sm" variant="ghost" disabled={denied} onClick={() => remove(p)} aria-label={`Remove provider ${p.name}`}><Trash2 className="w-3.5 h-3.5" /></Button>
              </div>
            </div>
            {userFormFor === p.name && p.htpasswd?.fileData?.name && <HtpasswdUserForm secretName={p.htpasswd.fileData.name} onDone={refresh} />}
          </div>
        ))}
        {adding ? <AddProviderForm data={data} onDone={() => { setAdding(false); refresh(); }} /> : (
          <Button size="sm" variant="secondary" disabled={denied} onClick={() => setAdding(true)}><Plus className="w-3 h-3" /> Add identity provider</Button>
        )}
      </div>
      {dialog}
    </Card>
  );
}

export function SignInTab() {
  return (
    <div className="space-y-4">
      <IdentityProvidersPanel />
    </div>
  );
}
