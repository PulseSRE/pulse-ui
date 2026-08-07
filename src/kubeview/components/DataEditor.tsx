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
}

export default function DataEditor({ resourcePath, data, kind, readOnly }: DataEditorProps) {
  const addToast = useUIStore((s) => s.addToast);
  const queryClient = useQueryClient();
  const [entries, setEntries] = useState<Array<{ key: string; value: string; isNew?: boolean }>>(
    Object.entries(data || {}).map(([key, value]) => ({
      key,
      value: kind === 'Secret' ? tryDecode(value) : value,
    }))
  );
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
    setEntries((prev) => prev.map((e, i) => i === idx ? { ...e, value: newValue } : e));
  }, []);

  const handleCopy = useCallback((idx: number) => {
    const entry = entries[idx];
    navigator.clipboard.writeText(entry.value);
    setCopiedIdx(idx);
    setTimeout(() => setCopiedIdx(null), 1500);
  }, [entries]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const newData: Record<string, string> = {};
      for (const entry of entries) {
        if (!entry.key.trim()) continue;
        newData[entry.key] = kind === 'Secret' ? btoa(entry.value) : entry.value;
      }

      const patchField = kind === 'Secret' ? 'data' : 'data';
      await k8sPatch(resourcePath, { [patchField]: newData });
      addToast({ type: 'success', title: `${kind} updated` });
      queryClient.invalidateQueries({ queryKey: ['detail'] });
    } catch (err) {
      showErrorToast(err, 'Save failed');
    } finally {
      setSaving(false);
    }
  }, [entries, kind, resourcePath, addToast]);

  const hasChanges = JSON.stringify(
    entries.reduce((acc, e) => { if (e.key) acc[e.key] = e.value; return acc; }, {} as Record<string, string>)
  ) !== JSON.stringify(
    Object.entries(data || {}).reduce((acc, [k, v]) => { acc[k] = kind === 'Secret' ? tryDecode(v) : v; return acc; }, {} as Record<string, string>)
  );

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
                {readOnly ? (
                  <pre className={cn(
                    'text-xs font-mono p-2 bg-slate-950 rounded-sm max-h-32 overflow-auto whitespace-pre-wrap break-all',
                    showValues ? 'text-slate-300' : 'text-slate-600'
                  )}>
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

function tryDecode(base64: string): string {
  try {
    return atob(base64);
  } catch {
    return base64;
  }
}
