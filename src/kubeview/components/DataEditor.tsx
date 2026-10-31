import React, { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, Save, Eye, EyeOff, Copy, Check, FileText, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sPatch } from '../engine/query';
import { useUIStore } from '../store/uiStore';
import { Card } from './primitives/Card';
import { showErrorToast } from '../engine/errorToast';

interface DataEditorProps {
  resourcePath: string; // API path to patch
  data: Record<string, string>;
  kind: 'ConfigMap' | 'Secret';
  readOnly?: boolean;
  /** Cluster the resource lives in (the one on screen). */
  clusterId?: string;
  /** The version the data was read at; the save is refused (409) if it changed since. */
  resourceVersion?: string;
}

interface Entry {
  key: string;
  /** Text shown and edited. For a binary Secret value, the raw base64. */
  value: string;
  isNew?: boolean;
  /** Key and stored value as read, so unchanged entries are never re-encoded. */
  origKey?: string;
  origRaw?: string;
  /** A Secret value that is not valid UTF-8: shown read-only, never re-encoded. */
  binary?: boolean;
}

/** Base64 of a UTF-8 string (btoa alone throws on anything outside Latin-1). */
function encodeBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** Decode a Secret value as UTF-8; null when it is not valid base64 or not valid UTF-8 (binary). */
export function decodeSecretValue(base64: string): string | null {
  try {
    const bin = atob(base64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function entriesFrom(data: Record<string, string>, kind: 'ConfigMap' | 'Secret'): Entry[] {
  return Object.entries(data || {}).filter(([, raw]) => typeof raw === 'string').map(([key, raw]) => {
    if (kind !== 'Secret') return { key, value: raw, origKey: key, origRaw: raw };
    const text = decodeSecretValue(raw);
    return text === null
      ? { key, value: raw, origKey: key, origRaw: raw, binary: true }
      : { key, value: text, origKey: key, origRaw: raw };
  });
}

function storedValue(e: Entry, kind: 'ConfigMap' | 'Secret'): string {
  if (e.binary) return e.origRaw ?? e.value;
  return kind === 'Secret' ? encodeBase64(e.value) : e.value;
}

function isUnchanged(e: Entry, kind: 'ConfigMap' | 'Secret'): boolean {
  if (e.origKey === undefined || e.origKey !== e.key) return false;
  if (e.binary) return true;
  const original = kind === 'Secret' ? decodeSecretValue(e.origRaw ?? '') : e.origRaw;
  return original === e.value;
}

/**
 * The merge patch for a save: only keys whose value changed or that were
 * added, `null` for keys removed (or renamed away from), and the
 * resourceVersion the data was read at. Unchanged keys are left out so their
 * stored bytes are never decoded and re-encoded — a Latin-1 decode followed by
 * a UTF-8 encode used to corrupt every non-ASCII and binary Secret value on
 * any save.
 */
export function buildDataPatch(entries: Entry[], original: Record<string, string>, kind: 'ConfigMap' | 'Secret', resourceVersion?: string) {
  const data: Record<string, string | null> = {};
  const kept = new Set<string>();
  for (const e of entries) {
    if (!e.key.trim()) continue;
    kept.add(e.key);
    if (isUnchanged(e, kind)) continue;
    data[e.key] = storedValue(e, kind);
  }
  for (const key of Object.keys(original || {})) {
    if (!kept.has(key)) data[key] = null;
  }
  return {
    ...(resourceVersion ? { metadata: { resourceVersion } } : {}),
    data,
  };
}

export default function DataEditor({ resourcePath, data, kind, readOnly, clusterId, resourceVersion }: DataEditorProps) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  // What the editor was loaded from; replaced after a save or a reload.
  const [base, setBase] = useState<{ data: Record<string, string>; resourceVersion?: string }>({ data: data || {}, resourceVersion });
  const [entries, setEntries] = useState<Entry[]>(() => entriesFrom(data, kind));
  const [conflict, setConflict] = useState(false);
  const [showValues, setShowValues] = useState(kind !== 'Secret');
  const [saving, setSaving] = useState(false);
  const [editingKey, setEditingKey] = useState<number | null>(null);
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);

  const handleAddEntry = useCallback(() => {
    setEntries((prev) => [...prev, { key: '', value: '', isNew: true }]);
    setEditingKey(entries.length);
  }, [entries.length]);

  const handleRemoveEntry = useCallback((idx: number) => {
    setEntries((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleUpdateKey = useCallback((idx: number, newKey: string) => {
    setEntries((prev) => prev.map((e, i) => i === idx ? { ...e, key: newKey } : e));
  }, []);

  const handleUpdateValue = useCallback((idx: number, newValue: string) => {
    setEntries((prev) => prev.map((e, i) => i === idx && !e.binary ? { ...e, value: newValue } : e));
  }, []);

  const handleCopy = useCallback((idx: number) => {
    const entry = entries[idx];
    navigator.clipboard.writeText(entry.value);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }, [entries]);

  const handleReload = useCallback(() => {
    setBase({ data: data || {}, resourceVersion });
    setEntries(entriesFrom(data, kind));
    setConflict(false);
    queryClient.invalidateQueries({ queryKey: ['detail'] });
  }, [data, resourceVersion, kind, queryClient]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setConflict(false);
    try {
      const patch = buildDataPatch(entries, base.data, kind, base.resourceVersion);
      const updated = await k8sPatch<{ data?: Record<string, string>; metadata?: { resourceVersion?: string } }>(
        resourcePath, patch, 'application/merge-patch+json', clusterId,
      );
      const nextData = updated?.data ?? {};
      setBase({ data: nextData, resourceVersion: updated?.metadata?.resourceVersion });
      setEntries(entriesFrom(nextData, kind));
      addToast({ type: 'success', title: `${kind} updated` });
      queryClient.invalidateQueries({ queryKey: ['detail'] });
    } catch (err) {
      if ((err as { statusCode?: number } | null)?.statusCode === 409) {
        // Someone else changed it since it was loaded; nothing was written.
        setConflict(true);
      } else {
        showErrorToast(err, 'Save failed');
      }
    } finally {
      setSaving(false);
    }
  }, [entries, base, kind, resourcePath, clusterId, addToast, queryClient]);

  const hasChanges = Object.keys(buildDataPatch(entries, base.data, kind).data).length > 0;

  return (
    <Card>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {kind === 'Secret' ? <Lock className="w-4 h-4 text-red-400" /> : <FileText className="w-4 h-4 text-yellow-400" />}
          <h2 className="text-sm font-semibold text-slate-100">
            Data ({entries.length} {entries.length === 1 ? 'entry' : 'entries'})
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {kind === 'Secret' && (
            <button
              onClick={() => setShowValues(!showValues)}
              className="flex items-center gap-1.5 px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded-sm hover:bg-slate-700"
            >
              {showValues ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
              {showValues ? 'Hide' : 'Reveal'}
            </button>
          )}
          {!readOnly && (
            <>
              <button
                onClick={handleAddEntry}
                className="flex items-center gap-1.5 px-2 py-1 text-xs bg-slate-800 text-slate-300 rounded-sm hover:bg-slate-700"
              >
                <Plus className="w-3 h-3" />
                Add
              </button>
              <button
                onClick={handleSave}
                disabled={!hasChanges || saving}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1 text-xs rounded-sm transition-colors',
                  hasChanges ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-slate-700 text-slate-500 cursor-not-allowed'
                )}
              >
                <Save className="w-3 h-3" />
                {saving ? 'Saving...' : 'Save'}
              </button>
            </>
          )}
        </div>
      </div>

      {conflict && (
        <div role="alert" className="flex items-center gap-3 px-4 py-2 text-xs bg-amber-950/40 border-b border-amber-900 text-amber-200">
          <span className="flex-1">This {kind} was changed by someone else since you opened it. Nothing was saved. Reload to see the current data, then make your change again.</span>
          <button onClick={handleReload} className="px-2 py-1 rounded-sm bg-amber-800/50 hover:bg-amber-800 text-amber-100">Reload</button>
        </div>
      )}

      {/* Entries */}
      <div className="divide-y divide-slate-800">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            No data entries. {!readOnly && 'Click "Add" to create one.'}
          </div>
        ) : (
          entries.map((entry, idx) => (
            <div key={idx} className="flex items-start gap-3 px-4 py-3 group hover:bg-slate-800/30">
              {/* Key */}
              <div className="w-48 shrink-0">
                {editingKey === idx || entry.isNew ? (
                  <input
                    type="text"
                    value={entry.key}
                    onChange={(e) => handleUpdateKey(idx, e.target.value)}
                    onBlur={() => setEditingKey(null)}
                    placeholder="key"
                    className="w-full px-2 py-1 text-xs font-mono bg-slate-800 border border-slate-600 rounded-sm text-slate-200 focus:outline-hidden focus:ring-1 focus:ring-blue-500"
                    autoFocus={entry.isNew}
                  />
                ) : (
                  <button
                    onClick={() => !readOnly && setEditingKey(idx)}
                    className="text-xs font-mono text-blue-400 hover:text-blue-300 truncate block w-full text-left"
                    title={entry.key}
                  >
                    {entry.key}
                  </button>
                )}
              </div>

              {/* Value */}
              <div className="flex-1 min-w-0">
                {readOnly || entry.binary ? (
                  <pre
                    title={entry.binary ? 'Binary value (not UTF-8 text), shown as base64; kept unchanged on save' : undefined} className={cn(
                    'text-xs font-mono p-2 bg-slate-950 rounded-sm max-h-32 overflow-auto whitespace-pre-wrap break-all',
                    showValues ? 'text-slate-300' : 'text-slate-600'
                  )}>
                    {entry.binary && <span className="mr-1 text-[10px] uppercase text-amber-400">binary · base64</span>}
                    {showValues ? entry.value : '••••••••••'}
                  </pre>
                ) : (
                  <textarea
                    value={showValues ? entry.value : '••••••••••'}
                    onChange={(e) => handleUpdateValue(idx, e.target.value)}
                    disabled={!showValues && kind === 'Secret'}
                    rows={Math.min(5, Math.max(1, entry.value.split('\n').length))}
                    className="w-full px-2 py-1 text-xs font-mono bg-slate-950 border border-slate-800 rounded-sm text-slate-300 focus:outline-hidden focus:ring-1 focus:ring-blue-500 resize-y"
                    placeholder="value"
                  />
                )}
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity pt-1">
                <button onClick={() => handleCopy(idx)} className="p-1 rounded-sm text-slate-500 hover:text-slate-300 hover:bg-slate-700" title="Copy value">
                  {copiedIdx === idx ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
                {!readOnly && (
                  <button onClick={() => handleRemoveEntry(idx)} className="p-1 rounded-sm text-slate-500 hover:text-red-400 hover:bg-slate-700" title="Remove entry">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}
