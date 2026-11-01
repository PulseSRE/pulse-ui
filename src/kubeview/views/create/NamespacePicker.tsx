/**
 * Target namespace for a deploy or install. In all-namespaces mode the user
 * picks one; nothing silently lands in `default`.
 */
import { useQuery } from '@tanstack/react-query';
import { k8sList } from '../../engine/query';
import { useFleetStore } from '../../store/fleetStore';
import { useUIStore } from '../../store/uiStore';
import type { K8sResource } from '../../engine/renderers';

/** The namespace the global selector names, or '' when it is "all namespaces". */
export function useInitialNamespace(): string {
  const selected = useUIStore((s) => s.selectedNamespace);
  return selected && selected !== '*' ? selected : '';
}

export function NamespacePicker({ value, onChange, label = 'Namespace' }: { value: string; onChange: (ns: string) => void; label?: string }) {
  const clusterId = useFleetStore((s) => s.activeClusterId);
  const { data: namespaces = [], error } = useQuery<K8sResource[]>({
    queryKey: ['k8s', 'list', '/api/v1/namespaces', undefined, clusterId],
    queryFn: () => k8sList('/api/v1/namespaces', undefined, clusterId),
    staleTime: 60000,
  });
  const names = namespaces.map((n) => n.metadata?.name).filter((n): n is string => !!n).sort();
  if (value && !names.includes(value)) names.unshift(value);

  return (
    <label className="block text-xs text-slate-400">
      {label} <span className="text-red-400">*</span>
      {error || names.length === 0 ? (
        // Namespaces could not be listed: let the user type one rather than guess.
        <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value.trim())} placeholder="namespace"
          className="mt-1 w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-sm text-slate-200 font-mono" />
      ) : (
        <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
          className="mt-1 w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-sm text-slate-200">
          <option value="">Choose a namespace…</option>
          {names.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      )}
    </label>
  );
}

export const isNamespaceName = (ns: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(ns);
