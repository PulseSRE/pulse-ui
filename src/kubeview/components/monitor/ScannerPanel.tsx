import { useState, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, AlertTriangle, XCircle, Clock, Shield, ToggleLeft, ToggleRight } from 'lucide-react';
import { useMonitorStore } from '../../store/monitorStore';
import { cn } from '@/lib/utils';

interface Scanner {
  id: string;
  displayName: string;
  description: string;
  category: string;
  checks: string[];
  auto_fixable: boolean;
}

interface ScannerResult {
  name: string;
  displayName: string;
  description: string;
  duration_ms: number;
  findings_count: number;
  checks: string[];
  status: 'clean' | 'warning' | 'error';
  error?: string;
}

const STATUS_ICON = {
  clean: CheckCircle,
  warning: AlertTriangle,
  error: XCircle,
};

const STATUS_COLOR = {
  clean: 'text-emerald-400',
  warning: 'text-amber-400',
  error: 'text-red-400',
};

const CATEGORY_COLOR: Record<string, string> = {
  availability: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
  infrastructure: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
  security: 'bg-red-500/10 text-red-400 border-red-500/20',
  monitoring: 'bg-violet-500/10 text-violet-400 border-violet-500/20',
  resources: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  audit: 'bg-slate-500/10 text-slate-400 border-slate-500/20',
};

export function ScannerPanel() {
  const [scanners, setScanners] = useState<Scanner[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [disabledScanners, setDisabledScanners] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem('pulse-disabled-scanners');
      return saved ? new Set(JSON.parse(saved)) : new Set();
    } catch { return new Set(); }
  });
  const [loading, setLoading] = useState(true);
  const scanReport = useMonitorStore((s) => (s as any).scanReport as { scanId: number; duration_ms: number; total_findings: number; scanners: ScannerResult[] } | null);

  useEffect(() => {
    fetch('/api/agent/monitor/scanners')
      .then((r) => r.json())
      .then((data) => { setScanners(data.scanners || []); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setDisabledScannersBackend = useMonitorStore((s) => s.setDisabledScanners);

  const toggleEnabled = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDisabledScanners((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      localStorage.setItem('pulse-disabled-scanners', JSON.stringify([...next]));
      setDisabledScannersBackend([...next]);
      return next;
    });
  }, [setDisabledScannersBackend]);

  const resultMap = new Map(
    (scanReport?.scanners || []).map((s) => [s.name, s])
  );

  if (loading) {
    return <div className="p-4 text-xs text-slate-500">Loading scanners...</div>;
  }

  // Group by category
  const categories = new Map<string, Scanner[]>();
  for (const s of scanners) {
    const cat = s.category || 'other';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(s);
  }

  return (
    <div className="border border-slate-700 rounded-lg overflow-hidden">
      <div className="px-3 py-2 bg-slate-800/50 border-b border-slate-700 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-blue-400" />
          <span className="text-xs font-medium text-slate-300">
            Scanners ({scanners.length - disabledScanners.size}/{scanners.length} active)
          </span>
        </div>
        {scanReport && (
          <span className="text-[10px] text-slate-500">
            Scan #{scanReport.scanId} · {(scanReport.duration_ms / 1000).toFixed(1)}s · {scanReport.total_findings} findings
          </span>
        )}
      </div>
      <div className="divide-y divide-slate-800/50">
        {[...categories.entries()].map(([category, catScanners]) => (
          <div key={category}>
            <div className="px-3 py-1.5 bg-slate-900/50">
              <span className={cn('text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded border', CATEGORY_COLOR[category] || 'text-slate-400')}>
                {category}
              </span>
            </div>
            {catScanners.map((scanner) => {
              const result = resultMap.get(scanner.id);
              const isDisabled = disabledScanners.has(scanner.id);
              const status = isDisabled ? 'disabled' : (result?.status || 'clean');
              const Icon = isDisabled ? Clock : (STATUS_ICON[status as keyof typeof STATUS_ICON] || Clock);
              const isExpanded = expanded.has(scanner.id);

              return (
                <div key={scanner.id} className={cn(isDisabled && 'opacity-50')}>
                  <button
                    onClick={() => toggleExpand(scanner.id)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-slate-800/30 transition-colors"
                  >
                    <Icon className={cn('w-3.5 h-3.5 shrink-0', isDisabled ? 'text-slate-700' : (STATUS_COLOR[status as keyof typeof STATUS_COLOR] || 'text-slate-600'))} />
                    <div className="flex-1 min-w-0">
                      <span className={cn('text-xs font-medium', isDisabled ? 'text-slate-500 line-through' : 'text-slate-200')}>{scanner.displayName}</span>
                      {scanner.auto_fixable && !isDisabled && <span className="text-[10px] text-emerald-600 ml-1.5">auto-fix</span>}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {result && !isDisabled && (
                        <>
                          <span className="text-[10px] text-slate-600 tabular-nums">{result.duration_ms}ms</span>
                          {result.findings_count > 0 && (
                            <span className="text-[10px] font-medium text-amber-400 bg-amber-400/10 px-1 rounded">{result.findings_count}</span>
                          )}
                        </>
                      )}
                      <button
                        onClick={(e) => toggleEnabled(scanner.id, e)}
                        className="p-0.5 hover:bg-slate-700 rounded transition-colors"
                        title={isDisabled ? 'Enable scanner' : 'Disable scanner'}
                      >
                        {isDisabled
                          ? <ToggleLeft className="w-4 h-4 text-slate-600" />
                          : <ToggleRight className="w-4 h-4 text-emerald-500" />
                        }
                      </button>
                      {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-600" /> : <ChevronRight className="w-3 h-3 text-slate-600" />}
                    </div>
                  </button>
                  {isExpanded && (
                    <div className="px-3 pb-2 pl-9 space-y-1.5">
                      <p className="text-[10px] text-slate-500">{scanner.description}</p>
                      <div className="text-[10px] text-slate-600 uppercase tracking-wider">Checks:</div>
                      <ul className="space-y-0.5">
                        {scanner.checks.map((check, i) => (
                          <li key={i} className="text-xs text-slate-400 flex items-center gap-1.5">
                            <span className="w-1 h-1 rounded-full bg-slate-600 shrink-0" />
                            {check}
                          </li>
                        ))}
                      </ul>
                      {result?.error && (
                        <p className="text-[10px] text-red-400 mt-1">Error: {result.error}</p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
