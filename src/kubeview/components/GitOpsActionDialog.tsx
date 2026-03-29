/**
 * GitOpsActionDialog — three-option dialog shown when saving ArgoCD-managed resources.
 * Options: Apply Now + Create PR, Create PR Only, Apply Only.
 */

import React, { useState } from 'react';
import { GitBranch, Zap, AlertTriangle, Loader2, CheckCircle, ExternalLink } from 'lucide-react';
import { createGitProvider } from '../engine/gitProvider';
import { useGitOpsConfig } from '../hooks/useGitOpsConfig';
import type { ArgoSyncInfo } from '../engine/types';

interface GitOpsActionDialogProps {
  open: boolean;
  resourceKind: string;
  resourceName: string;
  resourceNamespace?: string;
  yamlContent: string;
  syncInfo: ArgoSyncInfo;
  onApply: () => Promise<void>;
  onClose: () => void;
}

type Action = 'apply-and-pr' | 'pr-only' | 'apply-only';
type Status = 'idle' | 'applying' | 'creating-pr' | 'done' | 'error';

export function GitOpsActionDialog({
  open, resourceKind, resourceName, resourceNamespace,
  yamlContent, syncInfo, onApply, onClose,
}: GitOpsActionDialogProps) {
  const { config, isConfigured } = useGitOpsConfig();
  const [status, setStatus] = useState<Status>('idle');
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const safeName = resourceName.replace(/[^a-z0-9-]/gi, '-').toLowerCase();
  const branchName = `pulse/${resourceKind.toLowerCase()}-${safeName}-${Date.now()}`;
  const filePath = syncInfo.path
    ? `${syncInfo.path}/${resourceKind.toLowerCase()}-${resourceName}.yaml`
    : `${resourceKind.toLowerCase()}-${resourceName}.yaml`;

  const handleAction = async (action: Action) => {
    setStatus(action === 'pr-only' ? 'creating-pr' : 'applying');
    setError(null);
    setPrUrl(null);

    try {
      // Step 1: Apply to cluster (unless PR only)
      if (action !== 'pr-only') {
        await onApply();
      }

      // Step 2: Create PR (unless apply only)
      if (action !== 'apply-only' && config && isConfigured) {
        setStatus('creating-pr');
        const provider = createGitProvider(config);

        await provider.createBranch(config.baseBranch, branchName);

        // Check if file exists
        const existing = await provider.getFileContent(branchName, filePath);

        await provider.createOrUpdateFile(
          branchName,
          filePath,
          yamlContent,
          `Update ${resourceKind}/${resourceName}${resourceNamespace ? ` in ${resourceNamespace}` : ''} via OpenShift Pulse`,
          existing?.sha,
        );

        const pr = await provider.createPullRequest(
          `[Pulse] Update ${resourceKind}/${resourceName}`,
          [
            `## Changes`,
            ``,
            `Updated \`${resourceKind}/${resourceName}\`${resourceNamespace ? ` in namespace \`${resourceNamespace}\`` : ''} via OpenShift Pulse.`,
            ``,
            action === 'apply-and-pr'
              ? `> **Note:** This change has already been applied to the cluster. Merge this PR to bring Git in sync.`
              : `> This change has **not** been applied to the cluster yet. ArgoCD will sync after merge.`,
            ``,
            `### Source`,
            `- ArgoCD Application: \`${syncInfo.appName}\``,
            `- Repository path: \`${filePath}\``,
          ].join('\n'),
          branchName,
          config.baseBranch,
        );

        setPrUrl(pr.url);
      }

      setStatus('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm" onClick={status === 'idle' || status === 'done' || status === 'error' ? onClose : undefined} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="gitops-dialog-heading"
        className="relative bg-slate-900 border border-slate-700 rounded-xl shadow-2xl w-full max-w-lg p-6 z-50"
        onKeyDown={(e) => {
          if (e.key === 'Escape' && (status === 'idle' || status === 'done' || status === 'error')) {
            onClose();
          }
        }}
        tabIndex={-1}
      >
        {/* Header */}
        <div className="flex items-center gap-2 mb-4">
          <GitBranch className="w-5 h-5 text-violet-400" />
          <h2 id="gitops-dialog-heading" className="text-lg font-semibold text-slate-100">GitOps Save</h2>
        </div>

        <p className="text-sm text-slate-400 mb-1">
          <span className="text-slate-200 font-medium">{resourceKind}/{resourceName}</span> is managed by ArgoCD application <span className="text-violet-300">{syncInfo.appName}</span>.
        </p>
        <p className="text-xs text-slate-500 mb-5">Choose how to save your changes:</p>

        {status === 'idle' && (
          <div className="space-y-3">
            {/* Apply + PR */}
            <button
              onClick={() => handleAction('apply-and-pr')}
              disabled={!isConfigured}
              className="w-full text-left p-4 rounded-lg border border-violet-800/50 bg-violet-950/20 hover:bg-violet-950/40 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-2 mb-1">
                <Zap className="w-4 h-4 text-violet-400" />
                <span className="text-sm font-medium text-violet-200">Apply Now + Create PR</span>
                <span className="text-xs px-1.5 py-0.5 bg-violet-900/50 text-violet-300 rounded ml-auto">Recommended</span>
              </div>
              <p className="text-xs text-slate-400">
                Apply the change immediately and create a PR to sync Git. Cluster will be out-of-sync until PR is merged.
              </p>
            </button>

            {/* PR Only */}
            <button
              onClick={() => handleAction('pr-only')}
              disabled={!isConfigured}
              className="w-full text-left p-4 rounded-lg border border-slate-700 hover:border-slate-600 hover:bg-slate-800/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <div className="flex items-center gap-2 mb-1">
                <GitBranch className="w-4 h-4 text-blue-400" />
                <span className="text-sm font-medium text-slate-200">Create PR Only</span>
              </div>
              <p className="text-xs text-slate-400">
                Create a PR without applying to the cluster. ArgoCD will sync after the PR is merged.
              </p>
            </button>

            {/* Apply Only */}
            <button
              onClick={() => handleAction('apply-only')}
              className="w-full text-left p-4 rounded-lg border border-slate-700 hover:border-amber-800 hover:bg-amber-950/10 transition-colors"
            >
              <div className="flex items-center gap-2 mb-1">
                <AlertTriangle className="w-4 h-4 text-amber-400" />
                <span className="text-sm font-medium text-slate-200">Apply Only</span>
              </div>
              <p className="text-xs text-amber-400/70">
                Apply directly without updating Git. This will cause drift until manually reconciled.
              </p>
            </button>

            {!isConfigured && (
              <p className="text-xs text-amber-400 mt-2">
                Git provider not configured. Go to Admin → GitOps to set up your repository.
              </p>
            )}
          </div>
        )}

        {/* Progress */}
        {(status === 'applying' || status === 'creating-pr') && (
          <div className="flex items-center gap-3 py-8 justify-center">
            <Loader2 className="w-5 h-5 text-violet-400 animate-spin" />
            <span className="text-sm text-slate-300">
              {status === 'applying' ? 'Applying to cluster...' : 'Creating pull request...'}
            </span>
          </div>
        )}

        {/* Done */}
        {status === 'done' && (
          <div className="py-6 text-center space-y-3">
            <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
            <p className="text-sm text-emerald-300">Changes saved successfully</p>
            {prUrl && (
              <a
                href={prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-4 py-2 bg-violet-600 hover:bg-violet-500 text-white text-sm rounded transition-colors"
              >
                <ExternalLink className="w-3.5 h-3.5" /> View Pull Request
              </a>
            )}
            <div>
              <button onClick={onClose} className="text-xs text-slate-400 hover:text-slate-200 mt-2">Close</button>
            </div>
          </div>
        )}

        {/* Error */}
        {status === 'error' && (
          <div className="py-6 text-center space-y-3">
            <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
            <p className="text-sm text-red-300">{error}</p>
            <div className="flex gap-2 justify-center">
              <button onClick={() => setStatus('idle')} className="px-3 py-1.5 text-xs bg-slate-800 text-slate-300 rounded hover:bg-slate-700">Try Again</button>
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200">Close</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
