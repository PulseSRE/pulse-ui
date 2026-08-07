import React, { useState, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import {
  ShieldCheck, ShieldAlert, Loader2, ChevronDown, ChevronRight,
  AlertTriangle, CheckCircle, XCircle, RefreshCw, Sparkles, X,
} from 'lucide-react';
import { K8S_BASE as BASE } from '../../engine/gvr';
import { useUIStore } from '../../store/uiStore';
import { resourceToYaml } from '../../engine/yamlUtils';

export interface DryRunPanelProps {
  yaml: string;
  apiPath: string;
  method: 'POST' | 'PUT';
  onClose: () => void;
}

interface DryRunResult {
  status: 'idle' | 'loading' | 'success' | 'error';
  serverYaml: string | null;
  errors: string[];
  warnings: string[];
  defaultsApplied: DiffEntry[];
}

interface DiffEntry {
  path: string;
  type: 'added' | 'modified';
  value: string;
}

function getImpersonationHeaders(): Record<string, string> {
  const { impersonateUser, impersonateGroups } = useUIStore.getState();
  if (!impersonateUser) return {};
  const headers: Record<string, string> = { 'Impersonate-User': impersonateUser };
  if (impersonateGroups.length > 0) {
    headers['Impersonate-Group'] = impersonateGroups.join(',');
  }
  return headers;
}

function computeYamlDiffs(inputYaml: string, serverYaml: string): DiffEntry[] {
  const inputLines = inputYaml.split('\n');
  const serverLines = serverYaml.split('\n');
  const diffs: DiffEntry[] = [];

  const inputSet = new Set(inputLines.map(l => l.trimEnd()));

  for (const line of serverLines) {
    const trimmed = line.trimEnd();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (!inputSet.has(trimmed)) {
      const keyMatch = trimmed.match(/^\s*([\w.-]+):\s*(.*)/);
      if (keyMatch) {
        const existsInInput = inputLines.some(il => {
          const m = il.match(/^\s*([\w.-]+):/);
          return m && m[1] === keyMatch[1] && il.match(/^\s*/)?.[0]?.length === trimmed.match(/^\s*/)?.[0]?.length;
        });
        diffs.push({
          path: keyMatch[1],
          type: existsInInput ? 'modified' : 'added',
          value: keyMatch[2] || '(object)',
        });
      }
    }
  }

  return diffs;
}

export function DryRunPanel({ yaml, apiPath, method, onClose }: DryRunPanelProps) {
  const [result, setResult] = useState<DryRunResult>({
    status: 'idle',
    serverYaml: null,
    errors: [],
    warnings: [],
    defaultsApplied: [],
  });
  const [showDiff, setShowDiff] = useState(false);
  const [showFullYaml, setShowFullYaml] = useState(false);

  const runDryRun = useCallback(async () => {
    setResult({ status: 'loading', serverYaml: null, errors: [], warnings: [], defaultsApplied: [] });

    try {
      const url = `${BASE}${apiPath}?dryRun=All`;
      const res = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/yaml',
          ...getImpersonationHeaders(),
        },
        body: yaml,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ message: res.statusText }));
        const message = body.message || `${res.status}: ${res.statusText}`;
        const errors = [message];

        // Extract field-level errors from K8s validation
        const fieldErrors: string[] = [];
        if (body.details?.causes) {
          for (const cause of body.details.causes) {
            fieldErrors.push(`${cause.field || 'unknown'}: ${cause.message}`);
          }
        }

        setResult({
          status: 'error',
          serverYaml: null,
          errors: fieldErrors.length > 0 ? fieldErrors : errors,
          warnings: [],
          defaultsApplied: [],
        });
        return;
      }

      const serverObj = await res.json();
      const serverYamlStr = resourceToYaml(serverObj);

      // Check for warnings in response headers
      const warnings: string[] = [];
      const warningHeader = res.headers.get('Warning');
      if (warningHeader) {
        warnings.push(...warningHeader.split(',').map(w => w.trim()));
      }

      // Compute what the server added/changed
      const defaultsApplied = computeYamlDiffs(yaml, serverYamlStr);

      setResult({
        status: 'success',
        serverYaml: serverYamlStr,
        errors: [],
        warnings,
        defaultsApplied,
      });
    } catch (err) {
      setResult({
        status: 'error',
        serverYaml: null,
        errors: [err instanceof Error ? err.message : 'Dry-run request failed'],
        warnings: [],
        defaultsApplied: [],
      });
    }
  }, [yaml, apiPath, method]);

  // Auto-run on mount
  React.useEffect(() => {
    runDryRun();
  }, []);

  const serverLinesDiff = useMemo(() => {
    if (!result.serverYaml) return [];
    const inputLines = yaml.split('\n');
    const serverLines = result.serverYaml.split('\n');
    const inputSet = new Set(inputLines.map(l => l.trimEnd()));

    return serverLines.map(line => ({
      line,
      isNew: !inputSet.has(line.trimEnd()) && line.trim() !== '',
    }));
  }, [yaml, result.serverYaml]);

  return (
    <div className="border-t border-slate-700 bg-slate-900 max-h-[50vh] overflow-auto">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-slate-800/50 border-b border-slate-700 sticky top-0 z-10">
        <div className="flex items-center gap-2">
          {result.status === 'loading' && (
            <>
              <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
              <span className="text-sm font-medium text-slate-200">Validating...</span>
            </>
          )}
          {result.status === 'success' && (
            <>
              <ShieldCheck className="w-4 h-4 text-green-400" />
              <span className="text-sm font-medium text-green-300">Valid — ready to apply</span>
              {result.defaultsApplied.length > 0 && (
                <span className="text-xs text-slate-400 ml-1">
                  ({result.defaultsApplied.length} server default{result.defaultsApplied.length !== 1 ? 's' : ''} will be applied)
                </span>
              )}
            </>
          )}
          {result.status === 'error' && (
            <>
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span className="text-sm font-medium text-red-300">
                Validation failed — {result.errors.length} error{result.errors.length !== 1 ? 's' : ''}
              </span>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {result.status !== 'loading' && (
            <button onClick={runDryRun} className="flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded-sm hover:bg-slate-700 transition-colors">
              <RefreshCw className="w-3 h-3" /> Re-validate
            </button>
          )}
          <button onClick={onClose} className="text-slate-400 hover:text-slate-200 p-1 rounded-sm hover:bg-slate-700">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Errors */}
      {result.errors.length > 0 && (
        <div className="px-4 py-3 space-y-2">
          {result.errors.map((err, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span className="text-red-300 font-mono text-xs">{err}</span>
            </div>
          ))}
        </div>
      )}

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="px-4 py-2 border-b border-slate-800">
          {result.warnings.map((warn, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
              <span className="text-amber-300 text-xs">{warn}</span>
            </div>
          ))}
        </div>
      )}

      {/* Server defaults */}
      {result.status === 'success' && result.defaultsApplied.length > 0 && (
        <div className="px-4 py-3">
          <button
            onClick={() => setShowDiff(!showDiff)}
            className="flex items-center gap-2 text-xs font-medium text-slate-300 hover:text-slate-100 transition-colors mb-2"
          >
            {showDiff ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <Sparkles className="w-3.5 h-3.5 text-purple-400" />
            Server-applied defaults ({result.defaultsApplied.length})
          </button>
          {showDiff && (
            <div className="space-y-1 ml-5">
              {result.defaultsApplied.slice(0, 30).map((d, i) => (
                <div key={i} className="flex items-center gap-2 text-xs font-mono">
                  <span className={cn(
                    'w-1.5 h-1.5 rounded-full shrink-0',
                    d.type === 'added' ? 'bg-green-500' : 'bg-blue-500'
                  )} />
                  <span className="text-slate-400">{d.path}:</span>
                  <span className={cn(
                    d.type === 'added' ? 'text-green-400' : 'text-blue-400'
                  )}>
                    {d.value.length > 60 ? d.value.slice(0, 60) + '...' : d.value}
                  </span>
                </div>
              ))}
              {result.defaultsApplied.length > 30 && (
                <span className="text-xs text-slate-500">... and {result.defaultsApplied.length - 30} more</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Full server YAML preview */}
      {result.status === 'success' && result.serverYaml && (
        <div className="px-4 py-2 border-t border-slate-800">
          <button
            onClick={() => setShowFullYaml(!showFullYaml)}
            className="flex items-center gap-2 text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors"
          >
            {showFullYaml ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            Server result YAML
          </button>
          {showFullYaml && (
            <pre className="mt-2 p-3 bg-slate-950 rounded-sm border border-slate-800 text-xs font-mono max-h-64 overflow-auto">
              {serverLinesDiff.map(({ line, isNew }, i) => (
                <div key={i} className={cn(isNew && 'bg-green-950/30 text-green-400')}>
                  {isNew && <span className="text-green-600 mr-1">+</span>}
                  {line}
                </div>
              ))}
            </pre>
          )}
        </div>
      )}

      {/* Success with no defaults — clean */}
      {result.status === 'success' && result.defaultsApplied.length === 0 && result.warnings.length === 0 && (
        <div className="px-4 py-3 flex items-center gap-2 text-sm">
          <CheckCircle className="w-4 h-4 text-green-500" />
          <span className="text-green-300">Resource is valid. No additional fields will be added by the server.</span>
        </div>
      )}
    </div>
  );
}
