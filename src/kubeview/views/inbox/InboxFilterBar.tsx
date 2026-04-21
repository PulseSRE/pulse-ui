import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useInboxStore } from '../../store/inboxStore';

const TYPE_OPTIONS = [
  { value: '', label: 'All types' },
  { value: 'finding', label: 'Findings' },
  { value: 'task', label: 'Tasks' },
  { value: 'alert', label: 'Alerts' },
  { value: 'assessment', label: 'Assessments' },
];

const STATUS_OPTIONS: Record<string, Array<{ value: string; label: string }>> = {
  finding: [
    { value: '', label: 'Any status' },
    { value: 'new', label: 'New' },
    { value: 'agent_reviewing', label: 'AI Reviewing' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'action_taken', label: 'Action Taken' },
    { value: 'verifying', label: 'Verifying' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'agent_cleared', label: 'Agent Cleared' },
  ],
  task: [
    { value: '', label: 'Any status' },
    { value: 'new', label: 'New' },
    { value: 'agent_reviewing', label: 'AI Reviewing' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'agent_cleared', label: 'Agent Cleared' },
  ],
  alert: [
    { value: '', label: 'Any status' },
    { value: 'new', label: 'New' },
    { value: 'agent_reviewing', label: 'AI Reviewing' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'agent_cleared', label: 'Agent Cleared' },
  ],
  assessment: [
    { value: '', label: 'Any status' },
    { value: 'new', label: 'New' },
    { value: 'agent_reviewing', label: 'AI Reviewing' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'escalated', label: 'Escalated' },
    { value: 'agent_cleared', label: 'Agent Cleared' },
  ],
  default: [
    { value: '', label: 'Any status' },
    { value: 'new', label: 'New' },
    { value: 'agent_reviewing', label: 'AI Reviewing' },
    { value: 'acknowledged', label: 'Acknowledged' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'investigating', label: 'Investigating' },
    { value: 'action_taken', label: 'Action Taken' },
    { value: 'verifying', label: 'Verifying' },
    { value: 'resolved', label: 'Resolved' },
    { value: 'agent_cleared', label: 'Agent Cleared' },
    { value: 'escalated', label: 'Escalated' },
  ],
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
          'border focus:outline-none focus:ring-1 focus:ring-violet-500',
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

  const currentType = filters.type || '';
  const currentStatus = filters.status || '';
  const currentSeverity = filters.severity || '';
  const statusOptions = STATUS_OPTIONS[currentType] || STATUS_OPTIONS.default;

  const hasActiveFilters = currentType || currentStatus || currentSeverity;

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-800">
      <FilterSelect
        label="Filter by type"
        value={currentType}
        options={TYPE_OPTIONS}
        onChange={(v) => setFilters({ ...filters, type: v || undefined, status: undefined })}
        active={!!currentType}
      />
      <FilterSelect
        label="Filter by status"
        value={currentStatus}
        options={statusOptions}
        onChange={(v) => setFilters({ ...filters, status: v || undefined })}
        active={!!currentStatus}
      />
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
