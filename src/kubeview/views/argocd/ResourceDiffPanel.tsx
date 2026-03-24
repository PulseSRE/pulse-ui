/**
 * ResourceDiffPanel — shows the live YAML state of an out-of-sync ArgoCD-managed resource.
 * Since we cannot easily retrieve the "desired" state from the Git repo without direct repo access,
 * we display the live cluster state with context about the drift.
 */

import React from 'react';
import { Loader2, AlertTriangle } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { k8sGet } from '../../engine/query';
import { jsonToYaml } from '../../engine/yamlUtils';
import { Card } from '../../components/primitives/Card';
import { kindToPlural } from '../../engine/renderers/index';
import type { ArgoManagedResource } from '../../engine/types';
import type { K8sResource } from '../../engine/renderers';

interface ResourceDiffPanelProps {
  resource: ArgoManagedResource;
  appName: string;
  appNamespace: string;
}

export function ResourceDiffPanel({ resource, appName, appNamespace }: ResourceDiffPanelProps) {
  const plural = kindToPlural(resource.kind);
  const apiPath = React.useMemo(() => {
    if (resource.group) {
      return resource.namespace
        ? `/apis/${resource.group}/${resource.version}/namespaces/${resource.namespace}/${plural}/${resource.name}`
        : `/apis/${resource.group}/${resource.version}/${plural}/${resource.name}`;
    }
    return resource.namespace
      ? `/api/${resource.version}/namespaces/${resource.namespace}/${plural}/${resource.name}`
      : `/api/${resource.version}/${plural}/${resource.name}`;
  }, [resource, plural]);

  const { data, isLoading, error } = useQuery<K8sResource>({
    queryKey: ['argocd-diff', apiPath],
    queryFn: () => k8sGet<K8sResource>(apiPath),
  });

  if (isLoading) {
    return (
      <div className="px-12 py-4 flex items-center gap-2 text-slate-400 text-xs">
        <Loader2 className="w-3 h-3 animate-spin" />
        Loading live state...
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-12 py-4 text-xs text-red-400">
        Failed to load resource: {(error as Error).message}
      </div>
    );
  }

  if (!data) return null;

  // Strip managedFields and last-applied-configuration for readability
  const cleaned = { ...data };
  if (cleaned.metadata) {
    const { managedFields, ...metaRest } = cleaned.metadata as Record<string, unknown>;
    const annotations = (metaRest.annotations || {}) as Record<string, string>;
    const { 'kubectl.kubernetes.io/last-applied-configuration': _lac, ...cleanAnnotations } = annotations;
    cleaned.metadata = { ...metaRest, annotations: Object.keys(cleanAnnotations).length > 0 ? cleanAnnotations : undefined } as K8sResource['metadata'];
  }

  const yaml = jsonToYaml(cleaned);

  return (
    <div className="px-12 py-3 bg-slate-950/50 border-t border-slate-800/50">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
        <span className="text-xs text-amber-300 font-medium">
          Live cluster state (out of sync with {appName})
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-2">
        The desired state is defined in the Git repository. Compare this live state with the source in ArgoCD to identify drift.
      </p>
      <pre className="text-xs text-slate-300 font-mono bg-slate-950 p-3 rounded overflow-auto max-h-80 border border-slate-800">
        {yaml}
      </pre>
    </div>
  );
}
