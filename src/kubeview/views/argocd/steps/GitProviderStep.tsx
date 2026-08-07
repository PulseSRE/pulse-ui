import React, { useState, useEffect } from 'react';
import { GitBranch, Eye, EyeOff, ExternalLink, ChevronDown, ChevronUp, Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { useGitOpsConfig } from '../../../hooks/useGitOpsConfig';
import { useGitOpsSetupStore } from '../../../store/gitopsSetupStore';
import { useUIStore } from '../../../store/uiStore';
import { showErrorToast } from '../../../engine/errorToast';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: () => void;
}

const PROVIDER_GUIDANCE = {
  github: {
    tokenUrl: 'https://github.com/settings/tokens?type=beta',
    steps: [
      'Go to GitHub \u2192 Settings \u2192 Developer settings \u2192 Personal access tokens \u2192 Fine-grained tokens',
      'Click "Generate new token"',
      'Select your repository',
      'Under "Repository permissions", grant Contents: Read and write',
      'Click "Generate token" and copy it',
    ],
    placeholder: 'github_pat_... or ghp_...',
    scopes: 'Contents: Read and write',
  },
  gitlab: {
    tokenUrl: 'https://gitlab.com/-/user_settings/personal_access_tokens',
    steps: [
      'Go to GitLab \u2192 Settings \u2192 Access Tokens',
      'Click "Add new token"',
      'Select scope: api',
      'Click "Create personal access token" and copy it',
    ],
    placeholder: 'glpat-...',
    scopes: 'api',
  },
  bitbucket: {
    tokenUrl: 'https://bitbucket.org/account/settings/app-passwords/',
    steps: [
      'Go to Bitbucket \u2192 Personal settings \u2192 App passwords',
      'Click "Create app password"',
      'Select permission: Repositories: Write',
      'Click "Create" and copy the password',
    ],
    placeholder: 'App password',
    scopes: 'Repositories: Write',
  },
};

export function GitProviderStep({ onComplete }: Props) {
  const { config, save, testConnection } = useGitOpsConfig();
  const markComplete = useGitOpsSetupStore((s) => s.markStepComplete);
  const addToast = useUIStore((s) => s.addToast);

  const [provider, setProvider] = useState<'github' | 'gitlab' | 'bitbucket'>(config?.provider || 'github');
  const [repoUrl, setRepoUrl] = useState(config?.repoUrl || '');
  const [baseBranch, setBaseBranch] = useState(config?.baseBranch || 'main');
  const [token, setToken] = useState(config?.token || '');
  const [pathPrefix, setPathPrefix] = useState(config?.pathPrefix || '');
  const [showToken, setShowToken] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);

  useEffect(() => {
    if (config) {
      setProvider(config.provider);
      setRepoUrl(config.repoUrl);
      setBaseBranch(config.baseBranch);
      setToken(config.token);
      setPathPrefix(config.pathPrefix || '');
    }
  }, [config]);

  const guide = PROVIDER_GUIDANCE[provider];

  const handleTest = async () => {
    if (!repoUrl || !token) {
      setTestResult({ success: false, error: 'Repository URL and token are required' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    const result = await testConnection({ provider, repoUrl, baseBranch, token, pathPrefix });
    setTestResult(result);
    setTesting(false);
  };

  const handleSave = async () => {
    if (!repoUrl || !token) {
      addToast({ type: 'error', title: 'Repository URL and token are required' });
      return;
    }
    setSaving(true);
    try {
      await save({ provider, repoUrl, baseBranch, token, pathPrefix });
      addToast({ type: 'success', title: 'Git configuration saved' });
      markComplete('git-config');
      onComplete();
    } catch (err) {
      showErrorToast(err, 'Failed to save git config');
    }
    setSaving(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-100">Configure Git Provider</h3>
        <p className="text-sm text-slate-400 mt-1">
          Connect your Git repository for GitOps. ArgoCD will sync from this repo.
        </p>
      </div>

      {/* Provider buttons */}
      <div className="flex gap-2">
        {(['github', 'gitlab', 'bitbucket'] as const).map((p) => (
          <button
            key={p}
            onClick={() => setProvider(p)}
            className={cn(
              'px-4 py-2 text-sm rounded-lg transition-colors capitalize',
              provider === p ? 'bg-violet-600 text-white' : 'bg-slate-800 text-slate-400 hover:text-slate-200',
            )}
          >
            {p}
          </button>
        ))}
      </div>

      {/* Token guidance (collapsible) */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full flex items-center justify-between p-3 text-sm text-slate-300 hover:bg-slate-800/50 transition-colors"
        >
          <span>How to create a {provider} token (required scope: <code className="text-xs bg-slate-800 px-1 rounded-sm">{guide.scopes}</code>)</span>
          {showGuide ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
        {showGuide && (
          <div className="border-t border-slate-700 p-3 space-y-2 bg-slate-900/50">
            <ol className="space-y-1.5 text-sm text-slate-400 list-decimal list-inside">
              {guide.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
            <a
              href={guide.tokenUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm text-blue-400 hover:text-blue-300 mt-2"
            >
              Open {provider} token page <ExternalLink className="w-3 h-3" />
            </a>
          </div>
        )}
      </div>

      {/* Form fields */}
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">Repository URL</label>
          <input
            type="text"
            value={repoUrl}
            onChange={(e) => setRepoUrl(e.target.value)}
            placeholder={`https://${provider}.com/org/gitops-repo`}
            className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-hidden"
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-slate-400 block mb-1">Base Branch</label>
            <input
              type="text"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-hidden"
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">Path Prefix <span className="text-slate-600">(optional)</span></label>
            <input
              type="text"
              value={pathPrefix}
              onChange={(e) => setPathPrefix(e.target.value)}
              placeholder="clusters/production/"
              className="w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-hidden"
            />
          </div>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Personal Access Token
            <span className="text-slate-600 ml-1">(stored in K8s Secret)</span>
          </label>
          <div className="relative">
            <input
              type={showToken ? 'text' : 'password'}
              autoComplete="off"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={guide.placeholder}
              className="w-full px-3 py-2 pr-10 text-sm bg-slate-800 border border-slate-700 rounded-sm text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-hidden font-mono"
            />
            <button
              onClick={() => setShowToken(!showToken)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
            >
              {showToken ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {testResult && (
        <div className={cn(
          'flex items-center gap-2 text-sm rounded-lg p-3',
          testResult.success
            ? 'text-emerald-400 bg-emerald-950/30 border border-emerald-900'
            : 'text-red-400 bg-red-950/30 border border-red-900',
        )}>
          {testResult.success ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
          {testResult.success ? 'Connection successful — repository is accessible' : testResult.error}
        </div>
      )}

      <div className="flex gap-3">
        <button
          onClick={handleTest}
          disabled={testing || !repoUrl || !token}
          className="px-4 py-3 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
          Test Connection
        </button>
        <button
          onClick={handleSave}
          disabled={saving || !repoUrl || !token}
          className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitBranch className="w-4 h-4" />}
          Save & Continue
        </button>
      </div>
    </div>
  );
}
