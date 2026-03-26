/**
 * GitOpsConfig — configuration panel for Git provider, repo, and token.
 * Accessible from the Admin view or ArgoCD view settings.
 */

import React, { useState } from 'react';
import { GitBranch, CheckCircle, XCircle, Loader2, Eye, EyeOff, ExternalLink, AlertTriangle, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGitOpsConfig } from '../hooks/useGitOpsConfig';
import { useArgoCD } from '../hooks/useArgoCD';
import { useUIStore } from '../store/uiStore';
import { useNavigateTab } from '../hooks/useNavigateTab';
import type { GitOpsConfig as GitOpsConfigType } from '../engine/gitProvider';
import { Card } from './primitives/Card';
import { Panel } from './primitives/Panel';

export function GitOpsConfig() {
  const { config, isLoading, isConfigured, save, testConnection } = useGitOpsConfig();
  const { available: argoCDAvailable, detecting: argoCDDetecting } = useArgoCD();
  const addToast = useUIStore((s) => s.addToast);
  const go = useNavigateTab();

  const [form, setForm] = useState<GitOpsConfigType>({
    provider: config?.provider || 'github',
    repoUrl: config?.repoUrl || '',
    baseBranch: config?.baseBranch || 'main',
    token: config?.token || '',
    pathPrefix: config?.pathPrefix || '',
  });
  const [showToken, setShowToken] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  // Sync form with loaded config
  React.useEffect(() => {
    if (config) {
      setForm({
        provider: config.provider,
        repoUrl: config.repoUrl,
        baseBranch: config.baseBranch,
        token: config.token,
        pathPrefix: config.pathPrefix || '',
      });
    }
  }, [config]);

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await testConnection(form);
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    if (!form.repoUrl || !form.token) {
      addToast({ type: 'error', title: 'Missing fields', detail: 'Repository URL and token are required' });
      return;
    }
    setSaving(true);
    try {
      await save(form);
      addToast({ type: 'success', title: 'GitOps config saved' });
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to save', detail: err instanceof Error ? err.message : 'Unknown error' });
    }
    setSaving(false);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ArgoCD prerequisite banner */}
      {!argoCDDetecting && !argoCDAvailable && (
        <div className="rounded-lg border border-amber-800/40 bg-amber-900/20 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1">
              <h3 className="text-sm font-semibold text-amber-300">ArgoCD is not installed</h3>
              <p className="text-xs text-slate-400 mt-1">
                The OpenShift GitOps operator must be installed before configuring GitOps integration.
                This will deploy ArgoCD in the <code className="text-xs bg-slate-800 px-1 py-0.5 rounded font-mono">openshift-gitops</code> namespace
                and enable application sync, drift detection, and auto-PR on save.
              </p>
              <p className="text-xs text-slate-500 mt-2">
                You can still configure your Git repository below — the settings will be saved and applied
                once ArgoCD is installed.
              </p>
              <button
                onClick={() => go('/create/v1~pods?tab=operators&q=openshift+gitops', 'Operator Catalog')}
                className="mt-3 flex items-center gap-1.5 text-xs font-medium text-amber-400 hover:text-amber-300 transition-colors"
              >
                Open Operator Catalog <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      )}

      <Panel title="GitOps Repository" icon={<GitBranch className="w-4 h-4 text-violet-400" />}>
        <div className="space-y-4">
          {/* Provider */}
          <div>
            <label htmlFor="gitops-provider" className="text-xs text-slate-400 block mb-1">Git Provider</label>
            <div id="gitops-provider" className="flex gap-2" role="group" aria-label="Git Provider">
              {(['github', 'gitlab', 'bitbucket'] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setForm({ ...form, provider: p })}
                  className={cn(
                    'px-3 py-1.5 text-xs rounded transition-colors capitalize',
                    form.provider === p ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200'
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          </div>

          {/* Repo URL */}
          <div>
            <label htmlFor="gitops-repo-url" className="text-xs text-slate-400 block mb-1">Repository URL</label>
            <input
              id="gitops-repo-url"
              type="text"
              value={form.repoUrl}
              onChange={(e) => setForm({ ...form, repoUrl: e.target.value })}
              placeholder={`https://${form.provider}.com/org/gitops-repo`}
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none"
            />
          </div>

          {/* Base Branch */}
          <div>
            <label htmlFor="gitops-branch" className="text-xs text-slate-400 block mb-1">Base Branch</label>
            <input
              id="gitops-branch"
              type="text"
              value={form.baseBranch}
              onChange={(e) => setForm({ ...form, baseBranch: e.target.value })}
              placeholder="main"
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none"
            />
          </div>

          {/* Token */}
          <div>
            <label htmlFor="gitops-token" className="text-xs text-slate-400 block mb-1">
              Personal Access Token
              <span className="text-slate-600 ml-1">(stored in K8s Secret, not localStorage)</span>
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  id="gitops-token"
                  type={showToken ? 'text' : 'password'}
                  autoComplete="off"
                  value={form.token}
                  onChange={(e) => setForm({ ...form, token: e.target.value })}
                  placeholder={form.provider === 'github' ? 'ghp_...' : form.provider === 'gitlab' ? 'glpat-...' : 'App password'}
                  className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none font-mono pr-10"
                />
                <button
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                >
                  {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <p className="text-xs text-slate-600 mt-1">
              Required scopes: GitHub <code>repo</code>, GitLab <code>api</code>, Bitbucket <code>repository:write</code>
            </p>
          </div>

          {/* Path Prefix */}
          <div>
            <label htmlFor="gitops-path-prefix" className="text-xs text-slate-400 block mb-1">
              Path Prefix <span className="text-slate-600">(optional, for monorepos)</span>
            </label>
            <input
              id="gitops-path-prefix"
              type="text"
              value={form.pathPrefix}
              onChange={(e) => setForm({ ...form, pathPrefix: e.target.value })}
              placeholder="clusters/production/"
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none"
            />
          </div>

          {/* Test result */}
          {testResult && (
            <div className={cn('flex items-center gap-2 p-2 rounded text-sm',
              testResult.success ? 'bg-emerald-950/30 text-emerald-300' : 'bg-red-950/30 text-red-300'
            )}>
              {testResult.success ? <CheckCircle className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
              {testResult.success ? 'Connection successful' : testResult.error}
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center gap-3 pt-2">
            <button
              onClick={handleSave}
              disabled={saving || !form.repoUrl || !form.token}
              className="px-4 py-2 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <GitBranch className="w-3.5 h-3.5" />}
              Save Configuration
            </button>
            <span className="text-xs text-slate-500">
              The Pulse Agent will verify the connection when creating PRs
            </span>
          </div>

          {isConfigured && (
            <div className="text-xs text-slate-600 pt-1">
              Currently configured: {config?.provider} · {config?.repoUrl?.split('/').slice(-2).join('/')} · {config?.baseBranch}
            </div>
          )}
        </div>
      </Panel>
    </div>
  );
}
