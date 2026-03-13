import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { Button, Label, Tooltip } from '@patternfly/react-core';
import {
  CopyIcon,
  DownloadIcon,
  EditIcon,
  UndoIcon,
  SaveIcon,
  SearchIcon,
  ExpandIcon,
  CompressIcon,
  AlignLeftIcon,
  FilterIcon,
  CodeIcon,
  ExclamationTriangleIcon,
  TimesIcon,
} from '@patternfly/react-icons';
import CodeMirror, { type ReactCodeMirrorRef } from '@uiw/react-codemirror';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { yaml } from '@codemirror/lang-yaml';
import { oneDark } from '@codemirror/theme-one-dark';
import { search, openSearchPanel } from '@codemirror/search';
import { linter, lintGutter, type Diagnostic } from '@codemirror/lint';
import { EditorView, keymap } from '@codemirror/view';
import { useUIStore } from '@/store/useUIStore';

interface YamlEditorProps {
  /** The raw JSON string to display */
  value: string;
  /** Resource name for download filename */
  name: string;
  /** API URL for saving (PUT). If not provided, save is disabled. */
  apiUrl?: string;
  /** Called after a successful save with the new raw JSON */
  onSaved?: (newValue: string) => void;
}

type ViewFormat = 'json' | 'yaml';

// --- K8s metadata fields to strip in clean view ---
const NOISY_METADATA_KEYS = [
  'managedFields', 'resourceVersion', 'uid', 'generation',
  'creationTimestamp', 'selfLink',
];

const NOISY_ANNOTATION_PREFIXES = [
  'kubectl.kubernetes.io/',
  'control-plane.alpha.kubernetes.io/',
  'deprecated.daemonset.template.generation',
];

function cleanK8sObject(obj: unknown): unknown {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(cleanK8sObject);
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    // Strip noisy metadata keys at metadata level
    if (NOISY_METADATA_KEYS.includes(k)) continue;
    // Strip noisy annotations
    if (k === 'annotations' && typeof v === 'object' && v !== null) {
      const cleaned: Record<string, unknown> = {};
      for (const [ak, av] of Object.entries(v as Record<string, unknown>)) {
        if (!NOISY_ANNOTATION_PREFIXES.some(p => ak.startsWith(p))) {
          cleaned[ak] = av;
        }
      }
      if (Object.keys(cleaned).length > 0) result[k] = cleaned;
      continue;
    }
    result[k] = typeof v === 'object' ? cleanK8sObject(v) : v;
  }
  return result;
}

// --- JSON to YAML converter ---
function jsonToYaml(jsonStr: string): string {
  try {
    return toYaml(JSON.parse(jsonStr), 0);
  } catch {
    return jsonStr;
  }
}

function toYaml(value: unknown, indent: number): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') {
    if (value.includes('\n')) return `|\n${value.split('\n').map(l => pad + '  ' + l).join('\n')}`;
    if (/[:#{}[\],&*?|>!'"%@`]/.test(value) || value === '' || value === 'true' || value === 'false' || value === 'null' || !isNaN(Number(value)))
      return JSON.stringify(value);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value.map(item => {
      const rendered = toYaml(item, indent + 1);
      if (typeof item === 'object' && item !== null && !Array.isArray(item)) {
        const lines = rendered.split('\n');
        return `${pad}- ${lines[0].trimStart()}\n${lines.slice(1).join('\n')}`;
      }
      return `${pad}- ${rendered}`;
    }).join('\n');
  }
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    return entries.map(([k, v]) => {
      const key = /[:#{}[\],&*?|>!'"%@`\s]/.test(k) ? JSON.stringify(k) : k;
      if (typeof v === 'object' && v !== null) {
        return `${pad}${key}:\n${toYaml(v, indent + 1)}`;
      }
      return `${pad}${key}: ${toYaml(v, indent + 1)}`;
    }).join('\n');
  }
  return String(value);
}

// --- Simple inline diff ---
function computeDiff(original: string, modified: string): { added: number; removed: number; lines: DiffLine[] } {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const lines: DiffLine[] = [];
  let added = 0, removed = 0;

  // Simple LCS-based diff
  const n = origLines.length, m = modLines.length;
  // For performance, if too large just do a simple comparison
  if (n + m > 5000) {
    return { added: 0, removed: 0, lines: modLines.map(l => ({ text: l, type: 'same' as const })) };
  }

  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++)
      dp[i][j] = origLines[i - 1] === modLines[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);

  let i = n, j = m;
  const result: DiffLine[] = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && origLines[i - 1] === modLines[j - 1]) {
      result.push({ text: origLines[i - 1], type: 'same' });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.push({ text: modLines[j - 1], type: 'added' });
      added++;
      j--;
    } else {
      result.push({ text: origLines[i - 1], type: 'removed' });
      removed++;
      i--;
    }
  }
  result.reverse();
  return { added, removed, lines: result };
}

interface DiffLine {
  text: string;
  type: 'same' | 'added' | 'removed';
}

// --- JSON lint extension ---
const jsonLintExtension = linter(jsonParseLinter());

const wordWrapExt = EditorView.lineWrapping;

export default function YamlEditor({ value, name, apiUrl, onSaved }: YamlEditorProps) {
  const addToast = useUIStore((s) => s.addToast);
  const editorRef = useRef<ReactCodeMirrorRef>(null);

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(value);
  const [saving, setSaving] = useState(false);
  const [format, setFormat] = useState<ViewFormat>('json');
  const [wordWrap, setWordWrap] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [cleanView, setCleanView] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [jsonError, setJsonError] = useState<string | null>(null);

  useEffect(() => {
    if (!editing) setEditValue(value);
  }, [value, editing]);

  // Validate JSON in edit mode
  useEffect(() => {
    if (!editing) { setJsonError(null); return; }
    try {
      JSON.parse(editValue);
      setJsonError(null);
    } catch (e) {
      setJsonError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [editValue, editing]);

  // Keyboard shortcuts: Ctrl+S to save, Escape to cancel
  useEffect(() => {
    if (!editing) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (apiUrl && editValue !== value) handleSave();
      }
      if (e.key === 'Escape' && !showDiff) {
        e.preventDefault();
        handleCancel();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editing, editValue, value, apiUrl, showDiff]);

  // Escape exits fullscreen
  useEffect(() => {
    if (!fullscreen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); setFullscreen(false); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [fullscreen]);

  const isDark = document.documentElement.classList.contains('dark');
  const isModified = editing && editValue !== value;

  // Clean view: strip managedFields etc.
  const cleanedValue = useMemo(() => {
    if (!cleanView) return value;
    try {
      const obj = JSON.parse(value);
      return JSON.stringify(cleanK8sObject(obj), null, 2);
    } catch {
      return value;
    }
  }, [value, cleanView]);

  const strippedCount = useMemo(() => {
    if (!cleanView) return 0;
    return value.split('\n').length - cleanedValue.split('\n').length;
  }, [value, cleanedValue, cleanView]);

  function displayValue(): string {
    const base = editing ? editValue : cleanedValue;
    return format === 'yaml' && !editing ? jsonToYaml(base) : base;
  }

  const currentDisplay = displayValue();
  const lineCount = currentDisplay.split('\n').length;
  const byteSize = new Blob([currentDisplay]).size;

  // Diff computation
  const diff = useMemo(() => {
    if (!showDiff || !isModified) return null;
    return computeDiff(value, editValue);
  }, [showDiff, isModified, value, editValue]);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(editing ? editValue : currentDisplay);
    addToast({ type: 'success', title: 'Copied to clipboard' });
  }, [editing, editValue, currentDisplay, addToast]);

  const handleDownload = useCallback(() => {
    const content = editing ? editValue : currentDisplay;
    const ext = format === 'yaml' ? 'yaml' : 'json';
    const blob = new Blob([content], { type: `text/${ext}` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    addToast({ type: 'success', title: `Downloaded ${name}.${ext}` });
  }, [editing, editValue, currentDisplay, format, name, addToast]);

  const handleFormat = useCallback(() => {
    if (!editing) return;
    try {
      const parsed = JSON.parse(editValue);
      setEditValue(JSON.stringify(parsed, null, 2));
      addToast({ type: 'success', title: 'Formatted' });
    } catch {
      addToast({ type: 'error', title: 'Invalid JSON — cannot format' });
    }
  }, [editing, editValue, addToast]);

  const handleSearch = useCallback(() => {
    const view = editorRef.current?.view;
    if (view) openSearchPanel(view);
  }, []);

  const handleEdit = useCallback(() => {
    setFormat('json');
    setCleanView(false);
    setEditValue(value);
    setEditing(true);
    setShowDiff(false);
  }, [value]);

  const handleRevert = useCallback(() => {
    setEditValue(value);
  }, [value]);

  const handleCancel = useCallback(() => {
    setEditing(false);
    setEditValue(value);
    setShowDiff(false);
    setJsonError(null);
  }, [value]);

  const handleSave = useCallback(async () => {
    if (!apiUrl) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(editValue);
    } catch {
      addToast({ type: 'error', title: 'Invalid JSON', description: 'Fix syntax errors before saving.' });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(apiUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(parsed),
      });
      if (!res.ok) throw new Error(await res.text());
      const updated = await res.json();
      const newJson = JSON.stringify(updated, null, 2);
      setEditValue(newJson);
      setEditing(false);
      setShowDiff(false);
      onSaved?.(newJson);
      addToast({ type: 'success', title: 'Resource saved' });
    } catch (err) {
      addToast({ type: 'error', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
    }
    setSaving(false);
  }, [apiUrl, editValue, addToast, onSaved]);

  // CodeMirror keybindings for Ctrl+S
  const saveKeymap = useMemo(() => keymap.of([
    { key: 'Mod-s', run: () => { if (apiUrl && editing && editValue !== value) handleSave(); return true; } },
  ]), [apiUrl, editing, editValue, value, handleSave]);

  const extensions = useMemo(() => [
    format === 'yaml' && !editing ? yaml() : json(),
    search(),
    ...(editing ? [jsonLintExtension, lintGutter(), saveKeymap] : []),
    ...(wordWrap ? [wordWrapExt] : []),
  ], [format, editing, wordWrap, saveKeymap]);

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    return `${(bytes / 1024).toFixed(1)} KB`;
  };

  return (
    <div className={`os-yaml-editor${fullscreen ? ' os-yaml-editor--fullscreen' : ''}`}>
      {/* Toolbar */}
      <div className="os-yaml-editor__toolbar">
        <div className="os-yaml-editor__toolbar-left">
          {!editing && (
            <div className="os-yaml-editor__format-toggle">
              <button type="button" className={`os-yaml-editor__format-btn${format === 'json' ? ' os-yaml-editor__format-btn--active' : ''}`} onClick={() => setFormat('json')}>JSON</button>
              <button type="button" className={`os-yaml-editor__format-btn${format === 'yaml' ? ' os-yaml-editor__format-btn--active' : ''}`} onClick={() => setFormat('yaml')}>YAML</button>
            </div>
          )}
          {editing && <Label color="blue">Editing</Label>}
          {isModified && <Label color="orange">Modified</Label>}
          {jsonError && editing && (
            <Tooltip content={jsonError}>
              <Label color="red" icon={<ExclamationTriangleIcon />}>Error</Label>
            </Tooltip>
          )}
        </div>
        <div className="os-yaml-editor__toolbar-right">
          {editing && (
            <>
              <Tooltip content="Format JSON (prettify)"><Button variant="plain" size="sm" icon={<AlignLeftIcon />} onClick={handleFormat} aria-label="Format" /></Tooltip>
              <Tooltip content="Revert changes"><Button variant="plain" size="sm" icon={<UndoIcon />} onClick={handleRevert} isDisabled={!isModified} aria-label="Revert" /></Tooltip>
              <Tooltip content={showDiff ? 'Hide diff' : 'Show diff'}><Button variant="plain" size="sm" icon={<CodeIcon />} onClick={() => setShowDiff(!showDiff)} isDisabled={!isModified} aria-label="Toggle diff" className={showDiff ? 'os-yaml-editor__btn--active' : ''} /></Tooltip>
            </>
          )}
          <Tooltip content="Search (Ctrl+F)"><Button variant="plain" size="sm" icon={<SearchIcon />} onClick={handleSearch} aria-label="Search" /></Tooltip>
          {!editing && (
            <Tooltip content={cleanView ? 'Show full resource' : 'Hide managedFields & noise'}>
              <Button variant="plain" size="sm" icon={<FilterIcon />} onClick={() => setCleanView(!cleanView)} aria-label="Toggle clean view" className={cleanView ? 'os-yaml-editor__btn--active' : ''} />
            </Tooltip>
          )}
          <Tooltip content={wordWrap ? 'Disable word wrap' : 'Enable word wrap'}>
            <Button variant="plain" size="sm" icon={<AlignLeftIcon />} onClick={() => setWordWrap(!wordWrap)} aria-label="Toggle word wrap" className={wordWrap ? 'os-yaml-editor__btn--active' : ''} />
          </Tooltip>
          <Tooltip content={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'}>
            <Button variant="plain" size="sm" icon={fullscreen ? <CompressIcon /> : <ExpandIcon />} onClick={() => setFullscreen(!fullscreen)} aria-label="Toggle fullscreen" />
          </Tooltip>
          <span className="os-yaml-editor__separator" />
          <Button variant="secondary" size="sm" icon={<CopyIcon />} onClick={handleCopy}>Copy</Button>
          <Button variant="secondary" size="sm" icon={<DownloadIcon />} onClick={handleDownload}>Download</Button>
          {!editing && apiUrl && (
            <Button variant="primary" size="sm" icon={<EditIcon />} onClick={handleEdit}>Edit</Button>
          )}
          {editing && (
            <>
              <Button variant="secondary" size="sm" onClick={handleCancel}>Cancel</Button>
              <Tooltip content={jsonError ? 'Fix JSON errors first' : isModified ? 'Save (Ctrl+S)' : 'No changes'}>
                <Button variant="primary" size="sm" icon={<SaveIcon />} onClick={handleSave} isLoading={saving} isDisabled={saving || !isModified || !!jsonError}>Save</Button>
              </Tooltip>
            </>
          )}
        </div>
      </div>

      {/* Clean view banner */}
      {cleanView && strippedCount > 0 && (
        <div className="os-yaml-editor__banner">
          <FilterIcon /> Hiding {strippedCount} lines (managedFields, resourceVersion, uid, generation, creationTimestamp)
          <button type="button" className="os-yaml-editor__banner-dismiss" onClick={() => setCleanView(false)} aria-label="Show full resource"><TimesIcon /></button>
        </div>
      )}

      {/* Diff view */}
      {showDiff && diff && (
        <div className="os-yaml-editor__diff">
          <div className="os-yaml-editor__diff-header">
            <span>Changes: <strong className="os-yaml-editor__diff-added">+{diff.added}</strong> / <strong className="os-yaml-editor__diff-removed">-{diff.removed}</strong></span>
            <button type="button" className="os-yaml-editor__banner-dismiss" onClick={() => setShowDiff(false)} aria-label="Close diff"><TimesIcon /></button>
          </div>
          <div className="os-yaml-editor__diff-body">
            {diff.lines.map((line, i) => (
              <div key={i} className={`os-yaml-editor__diff-line os-yaml-editor__diff-line--${line.type}`}>
                <span className="os-yaml-editor__diff-marker">{line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}</span>
                <span className="os-yaml-editor__diff-text">{line.text || '\u00A0'}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Editor */}
      {!showDiff && (
        <CodeMirror
          ref={editorRef}
          value={editing ? editValue : currentDisplay}
          extensions={extensions}
          theme={isDark ? oneDark : 'light'}
          editable={editing}
          onChange={editing ? setEditValue : undefined}
          basicSetup={{ lineNumbers: true, foldGutter: true, highlightActiveLine: editing, bracketMatching: true, indentOnInput: true }}
          style={{ fontSize: 13, borderRadius: showDiff ? '0' : '0 0 0 0', overflow: 'hidden', border: '1px solid var(--modern-border, #eaeaea)', borderTop: 'none' }}
        />
      )}

      {/* Minimap (scroll indicator) */}
      {!showDiff && lineCount > 50 && (
        <div className="os-yaml-editor__minimap" title="Scroll to navigate">
          <div className="os-yaml-editor__minimap-track">
            {Array.from({ length: Math.min(lineCount, 200) }, (_, i) => {
              const line = currentDisplay.split('\n')[i] ?? '';
              const indent = line.search(/\S/);
              const width = Math.min(Math.max((line.trim().length / 80) * 100, 5), 100);
              return <div key={i} className="os-yaml-editor__minimap-line" style={{ width: `${width}%`, marginLeft: `${Math.max(indent * 3, 0)}%` }} />;
            })}
          </div>
        </div>
      )}

      {/* Status bar */}
      <div className="os-yaml-editor__statusbar">
        <span>Lines: {lineCount}</span>
        <span>Size: {formatSize(byteSize)}</span>
        <span>{format.toUpperCase()}</span>
        {cleanView && <span>Clean view</span>}
        {editing && <span>Ctrl+S save · Esc cancel · Ctrl+F search</span>}
      </div>

      <style>{`
        .os-yaml-editor { display: flex; flex-direction: column; position: relative; }
        .os-yaml-editor--fullscreen {
          position: fixed; inset: 0; z-index: 9998;
          background: var(--modern-card, #fff);
          padding: 0;
        }
        .os-yaml-editor--fullscreen .cm-editor { max-height: none !important; height: calc(100vh - 88px) !important; }
        .os-yaml-editor__toolbar {
          display: flex; justify-content: space-between; align-items: center;
          padding: 8px 12px; gap: 8px; flex-wrap: wrap;
          background: var(--modern-bg, #fafafa);
          border: 1px solid var(--modern-border, #eaeaea);
          border-radius: var(--modern-radius, 10px) var(--modern-radius, 10px) 0 0;
        }
        .os-yaml-editor__toolbar-left { display: flex; align-items: center; gap: 8px; }
        .os-yaml-editor__toolbar-right { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; }
        .os-yaml-editor__format-toggle {
          display: flex; border: 1px solid var(--modern-border, #eaeaea); border-radius: 6px; overflow: hidden;
        }
        .os-yaml-editor__format-btn {
          padding: 4px 12px; font-size: 12px; font-weight: 500; border: none; cursor: pointer;
          background: transparent; color: var(--modern-text-secondary, #666);
          transition: background 0.1s, color 0.1s;
        }
        .os-yaml-editor__format-btn:hover { background: var(--modern-hover, #f5f5f5); }
        .os-yaml-editor__format-btn--active {
          background: var(--modern-accent, #0066cc) !important; color: #fff !important;
        }
        .os-yaml-editor__separator { width: 1px; height: 20px; background: var(--modern-border, #eaeaea); margin: 0 4px; }
        .os-yaml-editor__btn--active { color: var(--modern-accent, #0066cc) !important; }

        .os-yaml-editor__banner {
          display: flex; align-items: center; gap: 8px;
          padding: 6px 12px; font-size: 12px;
          background: var(--modern-hover, #f5f5f5); color: var(--modern-text-secondary, #666);
          border: 1px solid var(--modern-border, #eaeaea); border-top: none;
        }
        .os-yaml-editor__banner-dismiss {
          margin-left: auto; background: none; border: none; cursor: pointer;
          color: var(--modern-text-muted, #999); padding: 2px;
        }
        .os-yaml-editor__banner-dismiss:hover { color: var(--modern-text, #171717); }

        .os-yaml-editor__diff {
          border: 1px solid var(--modern-border, #eaeaea); border-top: none;
          max-height: 60vh; overflow: auto;
        }
        .os-yaml-editor__diff-header {
          display: flex; align-items: center; justify-content: space-between;
          padding: 6px 12px; font-size: 12px;
          background: var(--modern-bg, #fafafa);
          border-bottom: 1px solid var(--modern-border, #eaeaea);
          position: sticky; top: 0; z-index: 1;
        }
        .os-yaml-editor__diff-added { color: #22863a; }
        .os-yaml-editor__diff-removed { color: #cb2431; }
        .os-yaml-editor__diff-body { font-family: monospace; font-size: 12px; line-height: 1.5; }
        .os-yaml-editor__diff-line { display: flex; padding: 0 12px; white-space: pre; }
        .os-yaml-editor__diff-line--added { background: rgba(34,134,58,0.12); }
        .os-yaml-editor__diff-line--removed { background: rgba(203,36,49,0.12); text-decoration: line-through; opacity: 0.7; }
        .os-yaml-editor__diff-marker { width: 16px; flex-shrink: 0; color: var(--modern-text-muted, #999); user-select: none; }
        .os-yaml-editor__diff-text { flex: 1; }

        .os-yaml-editor__minimap {
          position: absolute; right: 2px; top: 80px; bottom: 32px; width: 48px;
          pointer-events: none; opacity: 0.35; z-index: 2;
        }
        .os-yaml-editor__minimap-track { display: flex; flex-direction: column; gap: 0; height: 100%; overflow: hidden; }
        .os-yaml-editor__minimap-line { height: 1.5px; background: var(--modern-text-muted, #999); border-radius: 1px; flex-shrink: 0; }

        .os-yaml-editor__statusbar {
          display: flex; gap: 16px; padding: 4px 12px;
          font-size: 11px; color: var(--modern-text-muted, #999);
          background: var(--modern-bg, #fafafa);
          border: 1px solid var(--modern-border, #eaeaea); border-top: none;
          border-radius: 0 0 var(--modern-radius, 10px) var(--modern-radius, 10px);
        }
        .os-yaml-editor .cm-editor { max-height: 70vh; }
        .os-yaml-editor .cm-scroller { overflow: auto !important; }

        /* Lint gutter styling */
        .os-yaml-editor .cm-lint-marker-error { content: '●'; color: #cb2431; }
        .os-yaml-editor .cm-diagnostic-error { border-left: 3px solid #cb2431; padding: 4px 8px; }
      `}</style>
    </div>
  );
}
