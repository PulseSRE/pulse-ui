import React from 'react';
import { useNavigate } from 'react-router-dom';
import { X } from 'lucide-react';
import { gvrToUrl } from '../../engine/gvr';
import { jsonToYaml } from '../../engine/yamlUtils';
import { useUIStore } from '../../store/uiStore';
import type { K8sResource } from '../../engine/renderers';

interface PreviewPanelProps {
  resource: K8sResource;
  gvrKey: string;
  onClose: () => void;
}

export function PreviewPanel({ resource, gvrKey, onClose }: PreviewPanelProps) {
  const navigate = useNavigate();
  const addTab = useUIStore((s) => s.addTab);

  const handleOpenDetail = React.useCallback(() => {
    const gvrUrl = gvrToUrl(gvrKey);
    const ns = resource.metadata.namespace;
    const name = resource.metadata.name;
    const path = ns ? `/r/${gvrUrl}/${ns}/${name}` : `/r/${gvrUrl}/_/${name}`;
    addTab({ title: name, path, pinned: false, closable: true });
    navigate(path);
  }, [gvrKey, resource, addTab, navigate]);

  return (
    <div className="w-80 border-l border-slate-800 bg-slate-900 overflow-auto flex-shrink-0">
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 sticky top-0 bg-slate-900 z-10">
        <span className="text-sm font-semibold text-slate-200 truncate">{resource.metadata.name}</span>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><X className="w-4 h-4" /></button>
      </div>
      <div className="p-3 space-y-3 text-xs">
        <div>
          <span className="text-slate-500">Kind:</span>
          <span className="ml-2 text-slate-200">{resource.kind}</span>
        </div>
        {resource.metadata.namespace && (
          <div>
            <span className="text-slate-500">Namespace:</span>
            <span className="ml-2 text-slate-200">{resource.metadata.namespace}</span>
          </div>
        )}
        <div>
          <span className="text-slate-500">Created:</span>
          <span className="ml-2 text-slate-200">{resource.metadata.creationTimestamp ? new Date(resource.metadata.creationTimestamp).toLocaleString() : '\u2014'}</span>
        </div>
        {resource.metadata.labels && Object.keys(resource.metadata.labels).length > 0 && (
          <div>
            <div className="text-slate-500 mb-1">Labels:</div>
            <div className="flex flex-wrap gap-1">
              {Object.entries(resource.metadata.labels).slice(0, 8).map(([k, v]) => (
                <span key={k} className="px-1.5 py-0.5 bg-slate-800 text-slate-300 rounded text-xs font-mono">{k.split('/').pop()}={v}</span>
              ))}
            </div>
          </div>
        )}
        {resource.spec && (
          <div>
            <div className="text-slate-500 mb-1">Spec:</div>
            <pre className="text-xs text-emerald-400 font-mono bg-slate-950 p-2 rounded overflow-auto max-h-48">{jsonToYaml(resource.spec).slice(0, 500)}</pre>
          </div>
        )}
        <div className="pt-2 border-t border-slate-800">
          <button
            onClick={handleOpenDetail}
            className="w-full px-3 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Open Detail Page &rarr;
          </button>
        </div>
      </div>
    </div>
  );
}
