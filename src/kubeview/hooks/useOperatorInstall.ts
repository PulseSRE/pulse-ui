/**
 * Reusable hook for installing an OLM operator and tracking its progress.
 * Extracted from OperatorCatalogView — used by both that view and the GitOps wizard.
 */

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { k8sCreate, k8sGet } from '../engine/query';
import { safeQuery } from '../engine/safeQuery';
import { useActiveClusterId } from './useClusterBase';
import { assertActiveCluster } from '../engine/pendingCluster';

export type InstallPhase = 'idle' | 'creating' | 'pending' | 'installing' | 'succeeded' | 'failed';

interface UseOperatorInstallResult {
  install: (opts: {
    packageName: string;
    channel: string;
    source: string;
    sourceNamespace: string;
    targetNamespace: string;
    displayName?: string;
  }) => Promise<void>;
  phase: InstallPhase;
  error: string | null;
  csvName: string | null;
  reset: () => void;
}

export function useOperatorInstall(): UseOperatorInstallResult {
  const clusterId = useActiveClusterId();
  const queryClient = useQueryClient();
  const [phase, setPhase] = useState<InstallPhase>('idle');
  const [error, setError] = useState<string | null>(null);
  // The install remembers the cluster it was started on; progress is polled there.
  const [installing, setInstalling] = useState<{ name: string; ns: string; clusterId: string } | null>(null);
  const pollClusterId = installing?.clusterId ?? clusterId;

  // Poll subscription status
  const { data: sub } = useQuery({
    queryKey: ['operator-install-sub', installing?.name, installing?.ns, pollClusterId],
    queryFn: () =>
      installing
        ? safeQuery(() => k8sGet<any>(
            `/apis/operators.coreos.com/v1alpha1/namespaces/${installing.ns}/subscriptions/${installing.name}`, pollClusterId,
          ))
        : null,
    enabled: !!installing && phase !== 'idle' && phase !== 'succeeded' && phase !== 'failed',
    refetchInterval: 3000,
  });

  // Poll CSV status
  const csvName = sub?.status?.installedCSV || null;
  const { data: csv } = useQuery({
    queryKey: ['operator-install-csv', csvName, installing?.ns, pollClusterId],
    queryFn: () =>
      csvName && installing
        ? safeQuery(() => k8sGet<any>(
            `/apis/operators.coreos.com/v1alpha1/namespaces/${installing.ns}/clusterserviceversions/${csvName}`, pollClusterId,
          ))
        : null,
    enabled: !!csvName && !!installing,
    refetchInterval: 3000,
  });

  // Derive phase from subscription + CSV status
  useEffect(() => {
    if (!installing || phase === 'idle') return;
    if (!sub) {
      setPhase('creating');
      return;
    }
    if (!sub.status?.installedCSV) {
      setPhase('pending');
      return;
    }
    if (!csv) {
      setPhase('installing');
      return;
    }
    const csvPhase = csv.status?.phase;
    if (csvPhase === 'Succeeded') {
      setPhase('succeeded');
    } else if (csvPhase === 'Failed') {
      setPhase('failed');
      setError(csv.status?.message || 'CSV install failed');
    } else {
      setPhase('installing');
    }
  }, [installing, sub, csv, phase]);

  const install = useCallback(
    async (opts: {
      packageName: string;
      channel: string;
      source: string;
      sourceNamespace: string;
      targetNamespace: string;
    }) => {
      setPhase('creating');
      setError(null);

      try {
        assertActiveCluster(clusterId, 'Installing this operator');
        const ns = opts.targetNamespace;

        // Create namespace (best effort)
        if (ns !== 'openshift-operators') {
          try {
            await k8sCreate('/api/v1/namespaces', {
              apiVersion: 'v1',
              kind: 'Namespace',
              metadata: { name: ns },
            }, clusterId);
          } catch {
            // May already exist
          }
        }

        // Create OperatorGroup if needed
        if (ns !== 'openshift-operators' && ns !== 'openshift-operators-redhat') {
          try {
            await k8sCreate(
              `/apis/operators.coreos.com/v1/namespaces/${ns}/operatorgroups`,
              {
                apiVersion: 'operators.coreos.com/v1',
                kind: 'OperatorGroup',
                metadata: { name: `${opts.packageName}-group`, namespace: ns },
                spec: { targetNamespaces: [ns] },
              },
              clusterId,
            );
          } catch {
            // May already exist
          }
        }

        // Create Subscription
        await k8sCreate(
          `/apis/operators.coreos.com/v1alpha1/namespaces/${ns}/subscriptions`,
          {
            apiVersion: 'operators.coreos.com/v1alpha1',
            kind: 'Subscription',
            metadata: { name: opts.packageName, namespace: ns },
            spec: {
              channel: opts.channel,
              name: opts.packageName,
              source: opts.source,
              sourceNamespace: opts.sourceNamespace,
              installPlanApproval: 'Automatic',
            },
          },
          clusterId,
        );

        setInstalling({ name: opts.packageName, ns, clusterId });
        setPhase('pending');
      } catch (e) {
        setPhase('failed');
        setError(e instanceof Error ? e.message : 'Install failed');
      }
    },
    [clusterId],
  );

  const reset = useCallback(() => {
    setPhase('idle');
    setError(null);
    setInstalling(null);
  }, []);

  return { install, phase, error, csvName, reset };
}
