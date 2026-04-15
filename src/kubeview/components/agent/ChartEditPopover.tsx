import { useState, useCallback, lazy, Suspense } from 'react';
import { Play, Save, X, AlertCircle, CheckCircle2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useCustomViewStore } from '../../store/customViewStore';
import type { ComponentSpec } from '../../engine/agentComponents';

const CodeMirror = lazy(() => import('@uiw/react-codemirror'));

const CHART_TYPES = [
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'bar', label: 'Bar' },
  { value: 'donut', label: 'Donut' },
  { value: 'stacked_area', label: 'Stacked Area' },
  { value: 'stacked_bar', label: 'Stacked Bar' },
] as const;

const TIME_RANGES = ['15m', '30m', '1h', '6h', '24h'] as const;

interface ChartEditPopoverProps {
  spec: {
    title?: string;
    query?: string;
    chartType?: string;
    timeRange?: string;
    yAxisLabel?: string;
    [key: string]: unknown;
  };
  viewId: string;
  widgetIndex: number;
  onClose: () => void;
}

export function ChartEditPopover({ spec, viewId, widgetIndex, onClose }: ChartEditPopoverProps) {
  const [title, setTitle] = useState(spec.title || '');
  const [query, setQuery] = useState(spec.query || '');
  const [chartType, setChartType] = useState(spec.chartType || 'line');
  const [timeRange, setTimeRange] = useState(spec.timeRange || '1h');
  const [yAxisLabel, setYAxisLabel] = useState(spec.yAxisLabel || '');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const updateWidget = useCustomViewStore((s) => s.updateWidget);

  const handleTest = useCallback(async () => {
    if (!query.trim()) {
      setTestResult({ ok: false, message: 'Query is empty' });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/k8s/prometheus/query?query=${encodeURIComponent(query.trim())}`);
      if (!res.ok) {
        const text = await res.text();
        setTestResult({ ok: false, message: `HTTP ${res.status}: ${text.slice(0, 100)}` });
        return;
      }
      const data = await res.json();
      if (data.status === 'error') {
        setTestResult({ ok: false, message: data.error || 'Query failed' });
      } else {
        const results = data.data?.result || [];
        const points = results.reduce((n: number, r: { values?: unknown[] }) => n + (r.values?.length || 1), 0);
        setTestResult({
          ok: true,
          message: results.length === 0
            ? 'No data returned — query is valid but matched no series'
            : `${results.length} series, ${points} data points`,
        });
      }
    } catch (e) {
      setTestResult({ ok: false, message: `Network error: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      setTesting(false);
    }
  }, [query]);

  const handleSave = useCallback(() => {
    updateWidget(viewId, widgetIndex, {
      title: title.trim() || undefined,
      query: query.trim() || undefined,
      chartType: chartType as 'line' | 'area' | 'bar' | 'donut' | 'stacked_area' | 'stacked_bar',
      timeRange,
      yAxisLabel: yAxisLabel.trim() || undefined,
    } as Partial<ComponentSpec>);
    onClose();
  }, [viewId, widgetIndex, title, query, chartType, timeRange, yAxisLabel, updateWidget, onClose]);

  return (
    <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-slate-900 border border-slate-700 rounded-lg shadow-2xl shadow-black/50 p-4 space-y-3"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Title */}
      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Title</label>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full mt-1 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
          placeholder="Chart title"
        />
      </div>

      {/* PromQL Query */}
      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">PromQL Query</label>
        <div className="mt-1 rounded-md overflow-hidden border border-slate-700 focus-within:border-blue-500">
          <Suspense fallback={
            <textarea
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full h-24 px-3 py-2 text-sm font-mono bg-slate-800 text-slate-200 resize-none focus:outline-none"
              placeholder="rate(container_cpu_usage_seconds_total[5m])"
            />
          }>
            <CodeMirror
              value={query}
              onChange={setQuery}
              height="96px"
              theme="dark"
              basicSetup={{
                lineNumbers: false,
                foldGutter: false,
                highlightActiveLine: true,
                bracketMatching: true,
                autocompletion: false,
              }}
              className="text-sm [&_.cm-editor]:bg-slate-800 [&_.cm-gutters]:bg-slate-800 [&_.cm-gutters]:border-slate-700"
            />
          </Suspense>
        </div>
      </div>

      {/* Test Query */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleTest}
          disabled={testing || !query.trim()}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors',
            testing
              ? 'bg-blue-900/50 text-blue-300 cursor-wait'
              : 'bg-blue-600 hover:bg-blue-500 text-white',
          )}
        >
          <Play className="w-3 h-3" />
          {testing ? 'Testing...' : 'Test Query'}
        </button>

        {testResult && (
          <div className={cn(
            'flex items-center gap-1.5 text-xs',
            testResult.ok ? 'text-emerald-400' : 'text-red-400',
          )}>
            {testResult.ok
              ? <CheckCircle2 className="w-3.5 h-3.5" />
              : <AlertCircle className="w-3.5 h-3.5" />}
            <span>{testResult.message}</span>
          </div>
        )}
      </div>

      {/* Chart Type + Time Range */}
      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Chart Type</label>
          <select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="w-full mt-1 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
          >
            {CHART_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        <div className="flex-1">
          <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Time Range</label>
          <div className="flex gap-1 mt-1">
            {TIME_RANGES.map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={cn(
                  'flex-1 py-1.5 text-xs rounded-md transition-colors',
                  timeRange === r
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700',
                )}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Y-Axis Label */}
      <div>
        <label className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">Y-Axis Label</label>
        <input
          type="text"
          value={yAxisLabel}
          onChange={(e) => setYAxisLabel(e.target.value)}
          className="w-full mt-1 px-3 py-1.5 text-sm bg-slate-800 border border-slate-700 rounded-md text-slate-200 focus:outline-none focus:border-blue-500"
          placeholder="e.g. CPU (cores)"
        />
      </div>

      {/* Actions */}
      <div className="flex justify-end gap-2 pt-1 border-t border-slate-800">
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-md transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-md transition-colors"
        >
          <Save className="w-3 h-3" />
          Save
        </button>
      </div>
    </div>
  );
}
