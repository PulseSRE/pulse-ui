import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Plus, Clipboard, AlertCircle, Upload } from 'lucide-react';
import { useUIStore } from '../../store/uiStore';
import { parseManifest } from '../../engine/manifest';

interface YamlValidation {
  valid: boolean;
  kind?: string;
  apiVersion?: string;
  name?: string;
  errors: string[];
  docCount: number;
}

function validateYaml(text: string): YamlValidation {
  if (!text.trim()) return { valid: false, errors: ['Empty input'], docCount: 0 };
  // Parsed structurally (js-yaml), so a tab, a bad indent or a missing kind
  // is reported per document rather than guessed from line prefixes.
  const { documents, errors } = parseManifest(text);
  const first = documents[0];
  return {
    valid: errors.length === 0 && documents.length > 0,
    kind: first?.kind,
    apiVersion: first?.apiVersion,
    name: first?.name,
    errors,
    docCount: documents.length,
  };
}

export function ImportYamlTab({ onImport }: { onImport: (yaml: string) => void }) {
  const [text, setText] = useState('');
  const addToast = useUIStore((s) => s.addToast);

  const validation = useMemo(() => text.trim() ? validateYaml(text) : null, [text]);

  const handleValidatedImport = (content: string) => {
    const v = validateYaml(content);
    if (v.valid) {
      onImport(content);
    } else if (v.errors.length > 0 && (content.includes('apiVersion') || content.includes('kind'))) {
      addToast({ type: 'warning', title: 'YAML has issues', detail: v.errors[0] });
      onImport(content);
    } else {
      setText(content);
      addToast({ type: 'error', title: 'Invalid YAML', detail: v.errors[0] || 'Does not appear to be a Kubernetes resource' });
    }
  };

  const handlePaste = async () => {
    try {
      const clip = await navigator.clipboard.readText();
      handleValidatedImport(clip);
    } catch {
      addToast({ type: 'error', title: 'Clipboard access denied', detail: 'Paste directly into the text area instead' });
    }
  };

  const handleUpload = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.yaml,.yml,.json';
    input.onchange = async (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const content = await file.text();
      handleValidatedImport(content);
    };
    input.click();
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button onClick={handlePaste} className="flex items-center gap-3 p-6 bg-slate-900 rounded-lg border border-dashed border-slate-700 hover:border-blue-600 transition-colors text-left">
          <Clipboard className="w-6 h-6 text-blue-400" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Paste from Clipboard</div>
            <div className="text-xs text-slate-500 mt-1">Paste a Kubernetes YAML or JSON resource</div>
          </div>
        </button>
        <button onClick={handleUpload} className="flex items-center gap-3 p-6 bg-slate-900 rounded-lg border border-dashed border-slate-700 hover:border-blue-600 transition-colors text-left">
          <Upload className="w-6 h-6 text-purple-400" />
          <div>
            <div className="text-sm font-semibold text-slate-200">Upload File</div>
            <div className="text-xs text-slate-500 mt-1">Upload a .yaml, .yml, or .json file</div>
          </div>
        </button>
      </div>
      <div>
        <label className="text-xs text-slate-400 block mb-1">Or paste YAML here</label>
        <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder="apiVersion: v1&#10;kind: ConfigMap&#10;metadata:&#10;  name: my-config&#10;..." rows={12} className="w-full px-3 py-2 text-sm bg-slate-900 border border-slate-700 rounded-lg text-slate-200 placeholder-slate-600 font-mono resize-none focus:outline-hidden focus:ring-2 focus:ring-blue-500" />

        {validation && (
          <div className={cn('mt-2 p-3 rounded-lg border text-xs', validation.valid ? 'bg-green-950/30 border-green-900' : 'bg-red-950/30 border-red-900')}>
            {validation.valid ? (
              <div className="flex items-center gap-2 text-green-300">
                <span>✓</span>
                <span>
                  Valid {validation.kind && <span className="font-medium">{validation.kind}</span>}
                  {validation.apiVersion && <span className="text-green-500 ml-1">({validation.apiVersion})</span>}
                  {validation.name && <span className="text-green-500 ml-1">"{validation.name}"</span>}
                  {validation.docCount > 1 && <span className="text-green-500 ml-1">and {validation.docCount - 1} more — {validation.docCount} documents</span>}
                </span>
              </div>
            ) : (
              <div className="space-y-1">
                {validation.errors.map((err, i) => (
                  <div key={i} className="flex items-start gap-2 text-red-300">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>{err}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {text.trim() && (
          <div className="flex items-center gap-2 mt-2">
            <button onClick={() => handleValidatedImport(text)} disabled={!validation?.valid && !text.includes('apiVersion')}
              className={cn('flex items-center gap-1.5 px-4 py-2 text-sm rounded-sm transition-colors',
                validation?.valid ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-slate-700 text-slate-400 hover:bg-slate-600 hover:text-slate-200')}>
              <Plus className="w-4 h-4" /> {validation?.valid ? 'Open in Editor' : 'Open Anyway'}
            </button>
            {!validation?.valid && validation?.errors.length ? (
              <span className="text-xs text-amber-400">Has {validation.errors.length} issue{validation.errors.length !== 1 ? 's' : ''} — you can still edit</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
