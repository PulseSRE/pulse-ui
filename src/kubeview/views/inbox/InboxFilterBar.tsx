import { FilterButtonGroup } from '../../components/primitives/FilterButtonGroup';
import { useInboxStore } from '../../store/inboxStore';

const TYPE_OPTIONS = [
  { key: null, label: 'All' },
  { key: 'finding', label: 'Finding' },
  { key: 'task', label: 'Task' },
  { key: 'alert', label: 'Alert' },
  { key: 'assessment', label: 'Assessment' },
];

const STATUS_OPTIONS: Record<string, Array<{ key: string | null; label: string }>> = {
  finding: [
    { key: null, label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'acknowledged', label: 'Acknowledged' },
    { key: 'investigating', label: 'Investigating' },
    { key: 'action_taken', label: 'Action Taken' },
    { key: 'verifying', label: 'Verifying' },
  ],
  task: [
    { key: null, label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'in_progress', label: 'In Progress' },
  ],
  alert: [
    { key: null, label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'acknowledged', label: 'Acknowledged' },
  ],
  assessment: [
    { key: null, label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'acknowledged', label: 'Acknowledged' },
  ],
  default: [
    { key: null, label: 'All' },
    { key: 'new', label: 'New' },
    { key: 'acknowledged', label: 'Acknowledged' },
    { key: 'in_progress', label: 'In Progress' },
    { key: 'investigating', label: 'Investigating' },
  ],
};

const SEVERITY_OPTIONS = [
  { key: null, label: 'All' },
  { key: 'critical', label: 'Critical' },
  { key: 'warning', label: 'Warning' },
  { key: 'info', label: 'Info' },
];

const GROUP_OPTIONS = [
  { key: null, label: 'None' },
  { key: 'correlation', label: 'Correlation' },
];

export function InboxFilterBar() {
  const filters = useInboxStore((s) => s.filters);
  const setFilters = useInboxStore((s) => s.setFilters);
  const groupBy = useInboxStore((s) => s.groupBy);
  const setGroupBy = useInboxStore((s) => s.setGroupBy);

  const currentType = filters.type || null;
  const currentStatus = filters.status || null;
  const currentSeverity = filters.severity || null;
  const statusOptions = STATUS_OPTIONS[currentType || ''] || STATUS_OPTIONS.default;

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-2 border-b border-slate-800">
      <FilterButtonGroup
        options={TYPE_OPTIONS}
        value={currentType}
        onChange={(value) => setFilters({ ...filters, type: value || undefined, status: undefined })}
      />
      <FilterButtonGroup
        options={statusOptions}
        value={currentStatus}
        onChange={(value) => setFilters({ ...filters, status: value || undefined })}
      />
      <FilterButtonGroup
        options={SEVERITY_OPTIONS}
        value={currentSeverity}
        onChange={(value) => setFilters({ ...filters, severity: value || undefined })}
      />
      <div className="ml-auto">
        <FilterButtonGroup
          options={GROUP_OPTIONS}
          value={groupBy}
          onChange={(value) => setGroupBy(value)}
        />
      </div>
    </div>
  );
}
