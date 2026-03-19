import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  Package, Network, Globe, HardDrive, FileText,
  Lock, Shield, Clock, TrendingUp, Folder, User, ShieldCheck,
  Search, GitBranch, Database,
} from 'lucide-react';
import { snippets, type Snippet } from '../../components/yaml/SnippetEngine';

const SNIPPET_CATEGORIES: Record<string, { category: string; icon: any; color: string; gvr: string }> = {
  deploy: { category: 'Workloads', icon: Package, color: 'text-blue-400', gvr: 'apps/v1/deployments' },
  cj: { category: 'Workloads', icon: Clock, color: 'text-cyan-400', gvr: 'batch/v1/cronjobs' },
  hpa: { category: 'Workloads', icon: TrendingUp, color: 'text-pink-400', gvr: 'autoscaling/v2/horizontalpodautoscalers' },
  svc: { category: 'Networking', icon: Network, color: 'text-green-400', gvr: 'v1/services' },
  ing: { category: 'Networking', icon: Globe, color: 'text-purple-400', gvr: 'networking.k8s.io/v1/ingresses' },
  np: { category: 'Networking', icon: ShieldCheck, color: 'text-red-400', gvr: 'networking.k8s.io/v1/networkpolicies' },
  cm: { category: 'Config & Storage', icon: FileText, color: 'text-yellow-400', gvr: 'v1/configmaps' },
  secret: { category: 'Config & Storage', icon: Lock, color: 'text-red-400', gvr: 'v1/secrets' },
  pvc: { category: 'Storage', icon: HardDrive, color: 'text-orange-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-rwx': { category: 'Storage', icon: HardDrive, color: 'text-orange-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-block': { category: 'Storage', icon: HardDrive, color: 'text-purple-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-snapshot': { category: 'Storage', icon: HardDrive, color: 'text-blue-400', gvr: 'v1/persistentvolumeclaims' },
  'pvc-clone': { category: 'Storage', icon: HardDrive, color: 'text-cyan-400', gvr: 'v1/persistentvolumeclaims' },
  volumesnapshot: { category: 'Storage', icon: HardDrive, color: 'text-green-400', gvr: 'snapshot.storage.k8s.io/v1/volumesnapshots' },
  storageclass: { category: 'Storage', icon: Database, color: 'text-amber-400', gvr: 'storage.k8s.io/v1/storageclasses' },
  ns: { category: 'Access Control', icon: Folder, color: 'text-amber-400', gvr: 'v1/namespaces' },
  sa: { category: 'Access Control', icon: User, color: 'text-teal-400', gvr: 'v1/serviceaccounts' },
  rb: { category: 'Access Control', icon: Shield, color: 'text-indigo-400', gvr: 'rbac.authorization.k8s.io/v1/rolebindings' },
  clusterautoscaler: { category: 'Autoscaling', icon: TrendingUp, color: 'text-green-400', gvr: 'autoscaling.openshift.io/v1/clusterautoscalers' },
  machineautoscaler: { category: 'Autoscaling', icon: TrendingUp, color: 'text-emerald-400', gvr: 'autoscaling.openshift.io/v1beta1/machineautoscalers' },
  'sub-logging': { category: 'Operators', icon: Package, color: 'text-orange-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-loki': { category: 'Operators', icon: Package, color: 'text-purple-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-coo': { category: 'Operators', icon: Package, color: 'text-blue-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-externalsecrets': { category: 'Operators', icon: Lock, color: 'text-red-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-oadp': { category: 'Operators', icon: Package, color: 'text-teal-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-quay': { category: 'Operators', icon: Package, color: 'text-red-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  'sub-gitops': { category: 'Operators', icon: GitBranch, color: 'text-orange-400', gvr: 'operators.coreos.com/v1alpha1/subscriptions' },
  lokistack: { category: 'Logging', icon: HardDrive, color: 'text-purple-400', gvr: 'loki.grafana.com/v1/lokistacks' },
  clusterlogforwarder: { category: 'Logging', icon: FileText, color: 'text-orange-400', gvr: 'observability.openshift.io/v1/clusterlogforwarders' },
};

const CATEGORY_ORDER = ['Workloads', 'Networking', 'Config & Storage', 'Storage', 'Access Control', 'Autoscaling', 'Operators', 'Logging'];

export function TemplatesTab({ onSelectTemplate, onSelectBlank }: {
  onSelectTemplate: (snippet: Snippet, gvr: string) => void;
  onSelectBlank: (gvr: string) => void;
}) {
  const [search, setSearch] = useState('');

  const filteredSnippets = useMemo(() => {
    if (!search.trim()) return snippets;
    const q = search.toLowerCase();
    return snippets.filter(s =>
      s.label.toLowerCase().includes(q) ||
      s.description.toLowerCase().includes(q) ||
      s.prefix.toLowerCase().includes(q) ||
      (SNIPPET_CATEGORIES[s.prefix]?.category || '').toLowerCase().includes(q)
    );
  }, [search]);

  const grouped = useMemo(() => {
    const groups: Record<string, Snippet[]> = {};
    for (const snippet of filteredSnippets) {
      const cat = SNIPPET_CATEGORIES[snippet.prefix]?.category || 'Other';
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(snippet);
    }
    return CATEGORY_ORDER
      .filter(cat => groups[cat]?.length)
      .map(cat => ({ category: cat, snippets: groups[cat] }))
      .concat(
        Object.keys(groups)
          .filter(cat => !CATEGORY_ORDER.includes(cat))
          .map(cat => ({ category: cat, snippets: groups[cat] }))
      );
  }, [filteredSnippets]);

  return (
    <div className="space-y-6">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
        <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search templates... (e.g., deployment, loki, network policy)"
          className="w-full pl-9 pr-3 py-2.5 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      <div className="text-xs text-slate-500">{filteredSnippets.length} of {snippets.length} templates</div>

      {grouped.map(({ category, snippets: catSnippets }) => (
        <div key={category}>
          <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">{category}</h2>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
            {catSnippets.map((snippet) => {
              const meta = SNIPPET_CATEGORIES[snippet.prefix];
              const Icon = meta?.icon || FileText;
              const color = meta?.color || 'text-slate-400';
              const gvr = meta?.gvr || 'v1/pods';
              return (
                <button key={snippet.prefix} onClick={() => onSelectTemplate(snippet, gvr)}
                  className="flex flex-col items-start gap-2 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors text-left">
                  <Icon className={cn('w-5 h-5', color)} />
                  <div>
                    <div className="text-sm font-medium text-slate-200">{snippet.label}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{snippet.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}

      {filteredSnippets.length === 0 && (
        <div className="text-center py-8 text-slate-500 text-sm">No templates match "{search}"</div>
      )}

      <div>
        <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Or start from scratch</h2>
        <button onClick={() => onSelectBlank('v1/pods')}
          className="flex items-center gap-3 p-4 bg-slate-900 rounded-lg border border-slate-800 hover:border-slate-600 transition-colors">
          <FileText className="w-5 h-5 text-slate-400" />
          <div className="text-left">
            <div className="text-sm font-medium text-slate-200">Blank YAML</div>
            <div className="text-xs text-slate-500">Start with an empty editor</div>
          </div>
        </button>
      </div>
    </div>
  );
}
