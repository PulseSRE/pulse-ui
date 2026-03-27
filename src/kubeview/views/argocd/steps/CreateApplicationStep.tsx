import React, { useState, useMemo } from 'react';
import { Loader2, Code2, FileCode, ToggleLeft, ToggleRight, Layers, AppWindow } from 'lucide-react';
import { useGitOpsConfig } from '../../../hooks/useGitOpsConfig';
import { useArgoCDStore } from '../../../store/argoCDStore';
import { useGitOpsSetupStore } from '../../../store/gitopsSetupStore';
import { k8sCreate } from '../../../engine/query';
import { createGitProvider, type FileCommit } from '../../../engine/gitProvider';
import { showErrorToast } from '../../../engine/errorToast';
import { cn } from '@/lib/utils';

interface Props {
  onComplete: () => void;
}

const NAME_REGEX = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const INPUT_CLASS = 'w-full px-3 py-2 text-sm bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none';

function buildApplicationYAML(opts: {
  name: string;
  namespace: string;
  repoURL: string;
  path: string;
  targetRevision: string;
  destNamespace: string;
  autoSync: boolean;
  createNamespace: boolean;
}): object {
  const spec: Record<string, unknown> = {
    project: 'default',
    source: {
      repoURL: opts.repoURL,
      path: opts.path,
      targetRevision: opts.targetRevision,
    },
    destination: {
      server: 'https://kubernetes.default.svc',
      namespace: opts.destNamespace,
    },
  };

  if (opts.autoSync) {
    spec.syncPolicy = {
      automated: {
        prune: true,
        selfHeal: true,
      },
      syncOptions: opts.createNamespace ? ['CreateNamespace=true'] : [],
    };
  } else if (opts.createNamespace) {
    spec.syncPolicy = {
      syncOptions: ['CreateNamespace=true'],
    };
  }

  return {
    apiVersion: 'argoproj.io/v1alpha1',
    kind: 'Application',
    metadata: {
      name: opts.name,
      namespace: opts.namespace,
    },
    spec,
  };
}

function toYAMLString(obj: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (obj === null || obj === undefined) return 'null';
  if (typeof obj === 'string') return obj.includes(':') || obj.includes('#') ? `"${obj}"` : obj;
  if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    return obj.map((item) => {
      if (typeof item === 'string') return `${pad}- ${toYAMLString(item)}`;
      const inner = toYAMLString(item, indent + 1);
      return `${pad}- ${inner.trimStart()}`;
    }).join('\n');
  }
  if (typeof obj === 'object') {
    const entries = Object.entries(obj as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries
      .map(([key, val]) => {
        if (typeof val === 'object' && val !== null && !Array.isArray(val)) {
          return `${pad}${key}:\n${toYAMLString(val, indent + 1)}`;
        }
        if (Array.isArray(val)) {
          return `${pad}${key}:\n${toYAMLString(val, indent + 1)}`;
        }
        return `${pad}${key}: ${toYAMLString(val)}`;
      })
      .join('\n');
  }
  return String(obj);
}

function buildChildAppYAML(opts: {
  category: string;
  namespace: string;
  clusterName: string;
  repoURL: string;
  targetRevision: string;
  argoNamespace: string;
  autoSync: boolean;
}): { name: string; filePath: string; yaml: object } {
  const name = `${opts.clusterName}-${opts.category}-${opts.namespace}`;
  const filePath = `clusters/${opts.clusterName}/apps/${opts.category}-${opts.namespace}.yaml`;
  const yaml = buildApplicationYAML({
    name,
    namespace: opts.argoNamespace,
    repoURL: opts.repoURL,
    path: `clusters/${opts.clusterName}/${opts.category}/${opts.namespace}`,
    targetRevision: opts.targetRevision,
    destNamespace: opts.namespace,
    autoSync: opts.autoSync,
    createNamespace: true,
  });
  return { name, filePath, yaml };
}

export function CreateApplicationStep({ onComplete }: Props) {
  const { config, isConfigured } = useGitOpsConfig();
  const argoNamespace = useArgoCDStore((s) => s.namespace) || 'openshift-gitops';
  const markComplete = useGitOpsSetupStore((s) => s.markStepComplete);
  const selectedCategories = useGitOpsSetupStore((s) => s.selectedCategories);
  const selectedNamespaces = useGitOpsSetupStore((s) => s.selectedNamespaces);
  const setExportSummary = useGitOpsSetupStore((s) => s.setExportSummary);

  const isAppOfApps = selectedCategories.length > 0;

  const [name, setName] = useState('my-app');
  const [clusterName, setClusterName] = useState('my-cluster');
  const [repoURL, setRepoURL] = useState(config?.repoUrl || '');
  const [path, setPath] = useState('manifests');
  const [targetRevision, setTargetRevision] = useState('HEAD');
  const [destNamespace, setDestNamespace] = useState('default');
  const [autoSync, setAutoSync] = useState(true);
  const [createNamespace, setCreateNamespace] = useState(true);
  const [showYAML, setShowYAML] = useState(false);
  const [creating, setCreating] = useState(false);

  React.useEffect(() => {
    if (config?.repoUrl && !repoURL) {
      setRepoURL(config.repoUrl);
    }
  }, [config]);

  const nameValid = NAME_REGEX.test(isAppOfApps ? clusterName : name);
  const formValid = isAppOfApps
    ? nameValid && repoURL.length > 0 && targetRevision.length > 0
    : nameValid && repoURL.length > 0 && path.length > 0 && targetRevision.length > 0 && destNamespace.length > 0;

  const applicationObj = useMemo(
    () =>
      isAppOfApps
        ? null
        : buildApplicationYAML({
            name,
            namespace: argoNamespace,
            repoURL,
            path,
            targetRevision,
            destNamespace,
            autoSync,
            createNamespace,
          }),
    [isAppOfApps, name, argoNamespace, repoURL, path, targetRevision, destNamespace, autoSync, createNamespace],
  );

  const namespaces = useMemo(
    () => (selectedNamespaces.length > 0 ? selectedNamespaces : ['default']),
    [selectedNamespaces],
  );

  const childApps = useMemo(() => {
    if (!isAppOfApps) return [];
    return selectedCategories.flatMap((category) =>
      namespaces.map((ns) =>
        buildChildAppYAML({
          category,
          namespace: ns,
          clusterName,
          repoURL,
          targetRevision,
          argoNamespace,
          autoSync,
        }),
      ),
    );
  }, [isAppOfApps, selectedCategories, namespaces, clusterName, repoURL, targetRevision, argoNamespace, autoSync]);

  const rootAppObj = useMemo(() => {
    if (!isAppOfApps) return null;
    return buildApplicationYAML({
      name: `${clusterName}-root`,
      namespace: argoNamespace,
      repoURL,
      path: `clusters/${clusterName}/apps`,
      targetRevision,
      destNamespace: argoNamespace,
      autoSync,
      createNamespace: false,
    });
  }, [isAppOfApps, clusterName, argoNamespace, repoURL, targetRevision, autoSync]);

  const yamlPreview = useMemo(() => {
    if (isAppOfApps && rootAppObj) {
      const rootYaml = toYAMLString(rootAppObj);
      const childPreviews = childApps.slice(0, 3).map((c) =>
        `# ${c.filePath}\n${toYAMLString(c.yaml)}`
      );
      const more = childApps.length > 3 ? `\n# ... and ${childApps.length - 3} more child apps` : '';
      return `# Root Application\n${rootYaml}\n\n---\n${childPreviews.join('\n---\n')}${more}`;
    }
    return applicationObj ? toYAMLString(applicationObj) : '';
  }, [isAppOfApps, rootAppObj, childApps, applicationObj]);

  const handleCreate = async () => {
    if (!formValid) return;
    setCreating(true);
    try {
      if (isAppOfApps && rootAppObj) {
        if (!isConfigured || !config) {
          throw new Error('Git provider not configured. Go to Admin → GitOps to set up your repository.');
        }

        const provider = createGitProvider(config);
        const branchName = `pulse/app-of-apps-${clusterName}-${Date.now()}`;

        await provider.createBranch(config.baseBranch, branchName);

        const files: FileCommit[] = childApps.map((c) => ({
          path: c.filePath,
          content: toYAMLString(c.yaml),
        }));
        await provider.commitMultipleFiles(
          branchName,
          files,
          `Add app-of-apps structure for cluster ${clusterName} via OpenShift Pulse`,
        );

        const pr = await provider.createPullRequest(
          `[Pulse] App-of-apps for ${clusterName}`,
          [
            `## App-of-Apps Export`,
            ``,
            `Exported **${childApps.length}** child applications for cluster \`${clusterName}\`.`,
            ``,
            `### Categories`,
            ...selectedCategories.map((c) => `- ${c}`),
            ``,
            `### Namespaces`,
            ...namespaces.map((ns) => `- ${ns}`),
            ``,
            `> Merge this PR, then the root Application will sync all child apps via ArgoCD.`,
          ].join('\n'),
          branchName,
          config.baseBranch,
        );

        await k8sCreate(
          `/apis/argoproj.io/v1alpha1/namespaces/${argoNamespace}/applications`,
          rootAppObj,
        );

        setExportSummary({
          resourceCount: childApps.length,
          categories: [...selectedCategories],
          namespaces: [...namespaces],
          prUrl: pr.url,
          clusterName,
        });
      } else if (applicationObj) {
        await k8sCreate(
          `/apis/argoproj.io/v1alpha1/namespaces/${argoNamespace}/applications`,
          applicationObj,
        );
      }

      await useArgoCDStore.getState().loadApplications();
      markComplete('first-app');
      onComplete();
    } catch (err) {
      showErrorToast(err, 'Failed to create application');
    }
    setCreating(false);
  };

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-slate-100">
          {isAppOfApps ? 'Create App-of-Apps' : 'Create ArgoCD Application'}
        </h3>
        <p className="text-sm text-slate-400 mt-1">
          {isAppOfApps ? (
            <>
              Export <span className="text-violet-300 font-medium">{selectedCategories.length}</span> categories
              across <span className="text-violet-300 font-medium">{namespaces.length}</span> namespace{namespaces.length !== 1 ? 's' : ''} as
              an app-of-apps pattern. A root Application manages child apps per category and namespace.
            </>
          ) : (
            'Define an Application that ArgoCD will sync from your Git repository to the cluster.'
          )}
        </p>
      </div>

      {isAppOfApps && (
        <div className="flex items-start gap-3 p-3 bg-violet-950/30 border border-violet-800/40 rounded-lg">
          <Layers className="w-5 h-5 text-violet-400 mt-0.5 shrink-0" />
          <div className="text-xs text-slate-300 space-y-1">
            <p className="font-medium text-violet-200">App-of-Apps Pattern</p>
            <p>
              {childApps.length} child application{childApps.length !== 1 ? 's' : ''} will be committed to Git.
              A root Application pointing to <code className="text-violet-300">clusters/{clusterName}/apps</code> will
              be created in the cluster.
            </p>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            {isAppOfApps ? 'Cluster Name' : 'Application Name'}
          </label>
          <input
            type="text"
            value={isAppOfApps ? clusterName : name}
            onChange={(e) => {
              const val = e.target.value.toLowerCase();
              isAppOfApps ? setClusterName(val) : setName(val);
            }}
            placeholder={isAppOfApps ? 'my-cluster' : 'my-app'}
            className={cn(
              'w-full px-3 py-2 text-sm bg-slate-800 border rounded text-slate-200 placeholder-slate-600 focus:border-violet-500 outline-none',
              (isAppOfApps ? clusterName : name) && !nameValid ? 'border-red-500' : 'border-slate-700',
            )}
          />
          {(isAppOfApps ? clusterName : name) && !nameValid && (
            <p className="text-xs text-red-400 mt-1">Must be lowercase alphanumeric with hyphens only</p>
          )}
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Git Repository URL</label>
          <input
            type="text"
            value={repoURL}
            onChange={(e) => setRepoURL(e.target.value)}
            placeholder="https://github.com/org/repo"
            className={INPUT_CLASS}
          />
        </div>

        {isAppOfApps ? (
          <>
            <div>
              <label className="text-xs text-slate-400 block mb-1">Target Revision</label>
              <input
                type="text"
                value={targetRevision}
                onChange={(e) => setTargetRevision(e.target.value)}
                placeholder="HEAD"
                className={INPUT_CLASS}
              />
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-2">Child Applications</label>
              <div className="bg-slate-800 border border-slate-700 rounded-lg divide-y divide-slate-700 max-h-40 overflow-y-auto">
                {childApps.map((child) => (
                  <div key={child.name} className="flex items-center gap-2 px-3 py-2 text-xs">
                    <AppWindow className="w-3.5 h-3.5 text-violet-400 shrink-0" />
                    <span className="text-slate-200 font-mono truncate">{child.name}</span>
                    <span className="text-slate-500 ml-auto truncate">{child.filePath}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Path</label>
                <input
                  type="text"
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="manifests"
                  className={INPUT_CLASS}
                />
              </div>
              <div>
                <label className="text-xs text-slate-400 block mb-1">Target Revision</label>
                <input
                  type="text"
                  value={targetRevision}
                  onChange={(e) => setTargetRevision(e.target.value)}
                  placeholder="HEAD"
                  className={INPUT_CLASS}
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-400 block mb-1">Destination Namespace</label>
              <input
                type="text"
                value={destNamespace}
                onChange={(e) => setDestNamespace(e.target.value)}
                placeholder="default"
                className={INPUT_CLASS}
              />
            </div>

            <label className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
              <input
                type="checkbox"
                checked={createNamespace}
                onChange={(e) => setCreateNamespace(e.target.checked)}
                className="rounded border-slate-600 bg-slate-800 text-violet-600 focus:ring-violet-500"
              />
              Create namespace if it doesn't exist
            </label>
          </>
        )}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-200">Auto Sync</p>
            <p className="text-xs text-slate-500">Automatically prune and self-heal resources</p>
          </div>
          <button onClick={() => setAutoSync(!autoSync)} className="text-slate-300 hover:text-slate-100">
            {autoSync ? (
              <ToggleRight className="w-8 h-8 text-violet-400" />
            ) : (
              <ToggleLeft className="w-8 h-8 text-slate-500" />
            )}
          </button>
        </div>
      </div>

      {/* YAML Preview Toggle */}
      <div className="border border-slate-700 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowYAML(!showYAML)}
          className="w-full flex items-center justify-between p-3 text-sm text-slate-300 hover:bg-slate-800/50 transition-colors"
        >
          <span className="flex items-center gap-2">
            <FileCode className="w-4 h-4" />
            Preview YAML
          </span>
          <Code2 className={cn('w-4 h-4 transition-transform', showYAML && 'text-violet-400')} />
        </button>
        {showYAML && (
          <div className="border-t border-slate-700 bg-slate-950 p-4">
            <pre className="text-xs text-slate-300 font-mono whitespace-pre overflow-x-auto leading-relaxed">
              {yamlPreview}
            </pre>
          </div>
        )}
      </div>

      <button
        onClick={handleCreate}
        disabled={creating || !formValid}
        className="px-6 py-3 bg-violet-600 hover:bg-violet-500 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
      >
        {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
        {isAppOfApps ? `Create App-of-Apps (${childApps.length} apps)` : 'Create Application'}
      </button>
    </div>
  );
}
