import React, { useState, useEffect } from 'react';
import { FileText, AlertCircle, ChevronRight, ChevronDown, Loader2, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchSchema, type ResourceSchema, type FieldSchema } from '../../engine/schema';

export interface SchemaPanelProps {
  gvk?: { group: string; version: string; kind: string };
  yamlContent?: string; // To auto-detect GVK from YAML
  onInsertField?: (path: string, example: string) => void;
}

function detectGvkFromYaml(yaml: string): { group: string; version: string; kind: string } | null {
  const apiVersionMatch = yaml.match(/^apiVersion:\s*(.+)$/m);
  const kindMatch = yaml.match(/^kind:\s*(.+)$/m);
  if (!apiVersionMatch || !kindMatch) return null;

  const apiVersion = apiVersionMatch[1].trim();
  const kind = kindMatch[1].trim();
  const [group, version] = apiVersion.includes('/')
    ? apiVersion.split('/')
    : ['', apiVersion];

  return { group, version, kind };
}

export default function SchemaPanel({ gvk: gvkProp, yamlContent, onInsertField }: SchemaPanelProps) {
  const [schema, setSchema] = useState<ResourceSchema | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<FieldSchema | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const gvk = gvkProp || (yamlContent ? detectGvkFromYaml(yamlContent) : null);

  useEffect(() => {
    if (!gvk) { setSchema(null); return; }

    setLoading(true);
    setError(null);
    fetchSchema(gvk.group, gvk.version, gvk.kind)
      .then(setSchema)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [gvk?.group, gvk?.version, gvk?.kind]);

  // Filter fields by search
  function filterFields(fields: FieldSchema[], query: string): FieldSchema[] {
    if (!query) return fields;
    const q = query.toLowerCase();
    return fields.filter((f) =>
      f.name.toLowerCase().includes(q) ||
      f.description.toLowerCase().includes(q) ||
      f.type.toLowerCase().includes(q) ||
      (f.properties && filterFields(f.properties, query).length > 0)
    );
  }

  const filteredFields = schema ? filterFields(schema.fields, searchQuery) : [];

  if (!gvk) {
    return (
      <div className="flex flex-col h-full bg-slate-900">
        <div className="px-3 py-2 border-b border-slate-700">
          <h3 className="text-sm font-semibold text-slate-200">Schema</h3>
        </div>
        <div className="flex-1 flex items-center justify-center p-4 text-xs text-slate-500 text-center">
          Add <code className="text-emerald-400">apiVersion</code> and <code className="text-emerald-400">kind</code> to your YAML to load the schema
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-slate-900">
      {/* Header */}
      <div className="px-3 py-2 border-b border-slate-700">
        <h3 className="text-sm font-semibold text-slate-200">Schema</h3>
        <p className="text-xs text-slate-500 mt-0.5">{gvk.kind} {gvk.group ? `${gvk.group}/${gvk.version}` : gvk.version}</p>
      </div>

      {/* Search */}
      <div className="px-2 py-1.5 border-b border-slate-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search fields..."
            className="w-full pl-7 pr-2 py-1 text-xs bg-slate-800 border border-slate-700 rounded text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* Loading / Error */}
      {loading && (
        <div className="flex items-center gap-2 p-4 text-xs text-slate-400">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading schema...
        </div>
      )}
      {error && (
        <div className="p-3 text-xs text-yellow-400 flex items-start gap-2">
          <AlertCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Field Tree */}
      {schema && (
        <div className="flex-1 overflow-auto py-1">
          {filteredFields.length === 0 ? (
            <div className="p-4 text-xs text-slate-500 text-center">No fields match "{searchQuery}"</div>
          ) : (
            filteredFields.map((field) => (
              <FieldTree
                key={field.path}
                field={field}
                selectedPath={selectedField?.path}
                onSelect={setSelectedField}
                searchQuery={searchQuery}
              />
            ))
          )}
        </div>
      )}

      {/* Field Documentation */}
      {selectedField && (
        <div className="border-t border-slate-700 p-3 bg-slate-950/50 max-h-48 overflow-auto">
          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
            <span className="font-mono text-xs text-white">{selectedField.path || selectedField.name}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-300">{selectedField.type}</span>
            {selectedField.required && <span className="text-xs px-1.5 py-0.5 rounded bg-red-900/50 text-red-400">Required</span>}
            {selectedField.format && <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-400">{selectedField.format}</span>}
          </div>
          {selectedField.description && (
            <p className="text-[11px] text-slate-400 leading-relaxed mb-2">{selectedField.description}</p>
          )}
          {selectedField.default !== undefined && (
            <div className="text-[11px]"><span className="text-slate-500">Default: </span><code className="text-emerald-400">{String(selectedField.default)}</code></div>
          )}
          {selectedField.enum && (
            <div className="mt-1.5">
              <span className="text-xs text-slate-500">Values: </span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {selectedField.enum.map((v) => <code key={v} className="text-xs px-1 py-0.5 bg-slate-700 rounded text-slate-300">{v}</code>)}
              </div>
            </div>
          )}
          {selectedField.minimum !== undefined && (
            <div className="text-[11px] mt-1"><span className="text-slate-500">Min: </span><code className="text-emerald-400">{selectedField.minimum}</code></div>
          )}
          {selectedField.pattern && (
            <div className="text-[11px] mt-1"><span className="text-slate-500">Pattern: </span><code className="text-slate-400 text-xs">{selectedField.pattern}</code></div>
          )}
        </div>
      )}
    </div>
  );
}

function FieldTree({ field, selectedPath, onSelect, level = 0, searchQuery = '' }: {
  field: FieldSchema;
  selectedPath?: string;
  onSelect: (field: FieldSchema) => void;
  level?: number;
  searchQuery?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(level < 2 || !!searchQuery);
  const hasChildren = (field.properties && field.properties.length > 0) || (field.items?.properties && field.items.properties.length > 0);
  const isActive = selectedPath === field.path;
  const children = field.properties || field.items?.properties || [];

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 px-2 py-1 text-xs cursor-pointer hover:bg-slate-800/50 transition-colors',
          isActive && 'bg-slate-700/50'
        )}
        style={{ paddingLeft: `${level * 10 + 8}px` }}
        onClick={() => { onSelect(field); if (hasChildren) setIsExpanded(!isExpanded); }}
      >
        {hasChildren ? (
          isExpanded ? <ChevronDown className="w-3 h-3 text-slate-500 flex-shrink-0" /> : <ChevronRight className="w-3 h-3 text-slate-500 flex-shrink-0" />
        ) : <span className="w-3 flex-shrink-0" />}
        <span className={cn('font-mono', isActive ? 'text-blue-400' : field.required ? 'text-slate-200' : 'text-slate-400')}>{field.name}</span>
        {field.required && <span className="text-red-400 text-[9px]">*</span>}
        <span className="text-xs text-slate-600 ml-auto flex-shrink-0">{field.type}</span>
      </div>
      {hasChildren && isExpanded && children.map((child) => (
        <FieldTree key={child.path} field={child} selectedPath={selectedPath} onSelect={onSelect} level={level + 1} searchQuery={searchQuery} />
      ))}
    </div>
  );
}
