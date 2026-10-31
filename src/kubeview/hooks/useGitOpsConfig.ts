/**
 * useGitOpsConfig — reads/writes GitOps repo configuration from a K8s Secret.
 * Token is stored in the Secret, never in localStorage.
 */

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { k8sGet, k8sCreate, k8sPatch } from '../engine/query';
import type { K8sResource } from '../engine/renderers';
import { bitbucketAuthHeader, type GitOpsConfig } from '../engine/gitProvider';
import { LOCAL_CLUSTER_ID } from '../engine/clusterConnection';

const SECRET_PATH = '/api/v1/namespaces/openshiftpulse/secrets/openshiftpulse-gitops-config';
const QUERY_KEY = ['gitops', 'config'];
/** Pulse's GitOps config Secret is in Pulse's namespace on the cluster Pulse runs on. */
const CONFIG_CLUSTER_ID = LOCAL_CLUSTER_ID;

interface UseGitOpsConfigResult {
  config: GitOpsConfig | null;
  isLoading: boolean;
  isConfigured: boolean;
  save: (config: GitOpsConfig) => Promise<void>;
  testConnection: (config: GitOpsConfig) => Promise<{ success: boolean; error?: string }>;
}

function decodeSecretData(data: Record<string, string>): GitOpsConfig | null {
  try {
    return {
      provider: (atob(data.provider || '') || 'github') as GitOpsConfig['provider'],
      repoUrl: atob(data.repoUrl || ''),
      baseBranch: atob(data.baseBranch || '') || 'main',
      token: atob(data.token || ''),
      pathPrefix: data.pathPrefix ? atob(data.pathPrefix) : undefined,
    };
  } catch {
    return null;
  }
}

function encodeSecretData(config: GitOpsConfig): Record<string, string> {
  const data: Record<string, string> = {
    provider: btoa(config.provider),
    repoUrl: btoa(config.repoUrl),
    baseBranch: btoa(config.baseBranch),
    token: btoa(config.token),
  };
  if (config.pathPrefix) data.pathPrefix = btoa(config.pathPrefix);
  return data;
}

export function useGitOpsConfig(): UseGitOpsConfigResult {
  const queryClient = useQueryClient();

  const { data: config = null, isLoading } = useQuery<GitOpsConfig | null>({
    queryKey: [...QUERY_KEY, CONFIG_CLUSTER_ID],
    queryFn: async () => {
      try {
        const secret = await k8sGet<K8sResource & { data?: Record<string, string> }>(SECRET_PATH, CONFIG_CLUSTER_ID);
        if (!secret?.data) return null;
        return decodeSecretData(secret.data);
      } catch {
        return null;
      }
    },
    staleTime: 300000,
  });

  const isConfigured = !!config?.repoUrl && !!config?.token;

  const save = async (newConfig: GitOpsConfig) => {
    const secretData = encodeSecretData(newConfig);

    try {
      // Try to get existing secret first
      await k8sGet<K8sResource>(SECRET_PATH, CONFIG_CLUSTER_ID);

      // Exists — patch it
      await k8sPatch(SECRET_PATH, { data: secretData }, undefined, CONFIG_CLUSTER_ID);
    } catch {
      // Doesn't exist — create it
      await k8sCreate('/api/v1/namespaces/openshiftpulse/secrets', {
        apiVersion: 'v1',
        kind: 'Secret',
        metadata: {
          name: 'openshiftpulse-gitops-config',
          namespace: 'openshiftpulse',
        },
        type: 'Opaque',
        data: secretData,
      }, CONFIG_CLUSTER_ID);
    }

    queryClient.invalidateQueries({ queryKey: QUERY_KEY });
  };

  const testConnection = async (testConfig: GitOpsConfig): Promise<{ success: boolean; error?: string }> => {
    try {
      let testUrl: string;
      const headers: Record<string, string> = {};

      if (testConfig.provider === 'github') {
        const clean = testConfig.repoUrl.replace(/\.git$/, '');
        const parts = clean.split('/');
        const owner = parts[parts.length - 2];
        const repo = parts[parts.length - 1];
        testUrl = `https://api.github.com/repos/${owner}/${repo}`;
        headers.Authorization = `Bearer ${testConfig.token}`;
        headers.Accept = 'application/vnd.github+json';
      } else if (testConfig.provider === 'gitlab') {
        const url = new URL(testConfig.repoUrl.replace(/\.git$/, ''));
        const projectPath = encodeURIComponent(url.pathname.replace(/^\//, ''));
        testUrl = `${url.origin}/api/v4/projects/${projectPath}`;
        headers['PRIVATE-TOKEN'] = testConfig.token;
      } else {
        const clean = testConfig.repoUrl.replace(/\.git$/, '');
        const parts = clean.split('/');
        const owner = parts[parts.length - 2];
        const repo = parts[parts.length - 1];
        testUrl = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`;
        headers.Authorization = bitbucketAuthHeader(testConfig.token);
      }

      const res = await fetch(testUrl, { headers });
      if (res.ok) return { success: true };
      if (res.status === 401 || res.status === 403) return { success: false, error: 'Authentication failed — check your token' };
      if (res.status === 404) return { success: false, error: 'Repository not found — check the URL' };
      return { success: false, error: `Unexpected response: ${res.status}` };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connection failed';
      // CORS/CSP blocks direct browser requests to external APIs
      if (msg.includes('fetch') || msg.includes('network') || msg.includes('Failed')) {
        return {
          success: false,
          error: 'Cannot reach the Git provider from the browser (blocked by Content Security Policy), so the connection was not tested. You can still save the configuration; it is first used when a pull request is created.',
        };
      }
      return { success: false, error: msg };
    }
  };

  return { config, isLoading, isConfigured, save, testConnection };
}
