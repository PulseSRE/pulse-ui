import { ChevronDown, HelpCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Tooltip } from '../../components/primitives/Tooltip';
import { useInboxStore } from '../../store/inboxStore';

const SOURCE_OPTIONS = [
  { value: '', label: 'All sources' },
  { value: 'system:monitor', label: 'Monitor' },
  { value: 'system:agent', label: 'AI Agent' },
  { value: '__user__', label: 'Manual' },
];

const UNIFIED_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Any status' },
  { value: 'new', label: 'New' },
  { value: 'triaged', label: 'Triaged' },
  { value: 'claimed', label: 'Claimed' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'agent_cleared', label: 'Agent Cleared' },
];

const STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  finding: UNIFIED_STATUS_OPTIONS,
  task: UNIFIED_STATUS_OPTIONS,
  alert: UNIFIED_STATUS_OPTIONS,
  assessment: UNIFIED_STATUS_OPTIONS,
  default: UNIFIED_STATUS_OPTIONS,
};

const SEVERITY_OPTIONS = [
  { value: '', label: 'Any severity' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'info', label: 'Info' },
];

const GROUP_OPTIONS = [
  { value: '', label: 'No grouping' },
  { value: 'correlation', label: 'Group by correlation' },
];

function FilterSelect({
  value,
  options,
  onChange,
  active,
  label,
}: {
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
  active?: boolean;
  label: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
        className={cn(
          'appearance-none pl-3 pr-7 py-1.5 rounded-lg text-xs font-medium transition-colors cursor-pointer',
          'border focus:outline-hidden focus:ring-1 focus:ring-violet-500',
          active
            ? 'bg-violet-600/20 text-violet-300 border-violet-700/50'
            : 'bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600 hover:text-slate-300',
        )}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-500 pointer-events-none" />
    </div>
  );
}

export function InboxFilterBar() {
  const filters = useInboxStore((s) => s.filters);
  const setFilters = useInboxStore((s) => s.setFilters);
  const groupBy = useInboxStore((s) => s.groupBy);
  const setGroupBy = useInboxStore((s) => s.setGroupBy);

  const currentSource = filters.created_by || '';
  const currentStatus = filters.status || '';
  const currentSeverity = filters.severity || '';
  const statusOptions = STATUS_OPTIONS.default;

  const hasActiveFilters = currentSource || currentStatus || currentSeverity;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800">
      <FilterSelect
        label="Filter by source"
        value={currentSource}
        options={SOURCE_OPTIONS}
        onChange={(v) => setFilters({ ...filters, created_by: v || undefined })}
        active={!!currentSource}
      />
      <Tooltip
        content={
          <div className="space-y-1.5 max-w-xs">
            <div><span className="font-medium text-slate-200">Monitor</span> — detected by cluster scanning (crashloop, OOM, degraded)</div>
            <div><span className="font-medium text-slate-200">AI Agent</span> — recommended by the agent during investigation</div>
            <div><span className="font-medium text-slate-200">Manual</span> — created by you via New Task</div>
          </div>
        }
        side="bottom"
      >
        <button className="text-slate-600 hover:text-slate-400 transition-colors" aria-label="Source definitions">
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <FilterSelect
        label="Filter by status"
        value={currentStatus}
        options={statusOptions}
        onChange={(v) => setFilters({ ...filters, status: v || undefined })}
        active={!!currentStatus}
      />
      <Tooltip
        content={
          <div className="space-y-1 max-w-xs">
            <div><span className="font-medium text-slate-200">New</span> — just arrived, awaiting agent review</div>
            <div><span className="font-medium text-slate-200">Triaged</span> — agent investigated and built an action plan</div>
            <div><span className="font-medium text-slate-200">Claimed</span> — you own it, investigation view generated</div>
            <div><span className="font-medium text-slate-200">In Progress</span> — actively being worked on</div>
            <div><span className="font-medium text-slate-200">Resolved</span> — done, postmortem available</div>
          </div>
        }
        side="bottom"
      >
        <button className="text-slate-600 hover:text-slate-400 transition-colors" aria-label="Status definitions">
          <HelpCircle className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <FilterSelect
        label="Filter by severity"
        value={currentSeverity}
        options={SEVERITY_OPTIONS}
        onChange={(v) => setFilters({ ...filters, severity: v || undefined })}
        active={!!currentSeverity}
      />
      {hasActiveFilters && (
        <button
          onClick={() => setFilters({})}
          className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
        >
          Clear
        </button>
      )}
      <div className="ml-auto">
        <FilterSelect
          label="Group items"
          value={groupBy || ''}
          options={GROUP_OPTIONS}
          onChange={(v) => setGroupBy(v || null)}
          active={!!groupBy}
        />
      </div>
    </div>
  );
}
