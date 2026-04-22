import {
  CheckCircle2, XCircle, Loader2, SkipForward,
  CheckCheck, ExternalLink, X,
} from 'lucide-react';
import { Tooltip } from '../primitives/Tooltip';
import { Dropdown, type DropdownItem } from '../primitives/Dropdown';
import { useActionPlanStore, resolveStepStatus, type StepStatus, isStepDone } from '../../store/actionPlanStore';
import { useInboxStore } from '../../store/inboxStore';
import { useNavigateTab } from '../../hooks/useNavigateTab';

function StepDotIcon({ status, size = 14 }: { status: StepStatus; size?: number }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 style={{ width: size, height: size }} className="text-emerald-400" />;
    case 'failed':
      return <XCircle style={{ width: size, height: size }} className="text-red-400" />;
    case 'running':
      return <Loader2 style={{ width: size, height: size }} className="text-blue-400 animate-spin" />;
    case 'skipped':
      return <SkipForward style={{ width: size, height: size }} className="text-slate-600" />;
    default:
      return (
        <div
          className="rounded-full border-2 border-slate-600"
          style={{ width: size, height: size }}
        />
      );
  }
}

function StepDot({ index, title, status }: { index: number; title: string; status: StepStatus }) {
  const setStepStatus = useActionPlanStore((s) => s.setStepStatus);

  if (status === 'pending' || status === 'running') {
    return (
      <Tooltip content={`Step ${index + 1}: ${title} - ${status}`} side="bottom">
        <button
          className="shrink-0 p-0.5"
          aria-label={`Step ${index + 1}: ${title} - ${status}`}
        >
          <StepDotIcon status={status} />
        </button>
      </Tooltip>
    );
  }

  const items: DropdownItem[] = [];

  if (status === 'failed') {
    items.push({
      id: 'mark-complete',
      label: 'Mark complete',
      icon: <CheckCircle2 className="w-3 h-3" />,
      onClick: () => setStepStatus(index, 'complete'),
    });
    items.push({
      id: 'mark-skipped',
      label: 'Skip',
      icon: <SkipForward className="w-3 h-3" />,
      onClick: () => setStepStatus(index, 'skipped'),
    });
  }

  if (status === 'complete') {
    items.push({
      id: 'mark-failed',
      label: 'Mark failed',
      icon: <XCircle className="w-3 h-3" />,
      onClick: () => setStepStatus(index, 'failed'),
      danger: true,
    });
  }

  if (status === 'skipped') {
    items.push({
      id: 'mark-complete',
      label: 'Mark complete',
      icon: <CheckCircle2 className="w-3 h-3" />,
      onClick: () => setStepStatus(index, 'complete'),
    });
  }

  if (items.length === 0) {
    return (
      <Tooltip content={`Step ${index + 1}: ${title} - ${status}`} side="bottom">
        <button
          className="shrink-0 p-0.5"
          aria-label={`Step ${index + 1}: ${title} - ${status}`}
        >
          <StepDotIcon status={status} />
        </button>
      </Tooltip>
    );
  }

  return (
    <Dropdown
      trigger={
        <Tooltip content={`Step ${index + 1}: ${title} - ${status}`} side="bottom">
          <button
            className="shrink-0 p-0.5"
            aria-label={`Step ${index + 1}: ${title} - ${status}`}
          >
            <StepDotIcon status={status} />
          </button>
        </Tooltip>
      }
      items={items}
      align="left"
    />
  );
}

function Connector({ leftDone, rightDone }: { leftDone: boolean; rightDone: boolean }) {
  const bothDone = leftDone && rightDone;
  return (
    <div className={`w-2 h-0.5 shrink-0 ${bothDone ? 'bg-emerald-600' : 'bg-slate-700'}`} />
  );
}

export function ActionPlanTracker() {
  const execution = useActionPlanStore((s) => s.execution);
  const clearExecution = useActionPlanStore((s) => s.clearExecution);
  const resolve = useInboxStore((s) => s.resolve);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);
  const go = useNavigateTab();

  if (!execution) return null;

  const statuses = execution.steps.map((_, i) => resolveStepStatus(execution, i));
  const runningIdx = statuses.indexOf('running');
  const allTerminated = execution.completedAt != null;
  const hasRunning = runningIdx >= 0;
  const hasFailed = statuses.includes('failed');

  const label = allTerminated
    ? (hasFailed ? 'Done with failures' : 'All done')
    : hasRunning
      ? `Step ${runningIdx + 1}: ${execution.steps[runningIdx].title}`
      : execution.itemTitle;

  const handleReopen = () => {
    go('/inbox', 'Inbox');
    setSelectedItem(execution.itemId);
  };

  const handleResolve = () => {
    resolve(execution.itemId);
    clearExecution();
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-800 bg-slate-900/80"
      role="status"
      aria-live="polite"
      aria-label="Action plan progress"
    >
      <div className="flex items-center gap-0.5 shrink-0">
        {execution.steps.map((step, idx) => (
          <div key={idx} className="flex items-center gap-0.5">
            {idx > 0 && (
              <Connector leftDone={isStepDone(statuses[idx - 1])} rightDone={isStepDone(statuses[idx])} />
            )}
            <StepDot index={idx} title={step.title} status={statuses[idx]} />
          </div>
        ))}
      </div>

      <span className="text-xs text-slate-400 truncate flex-1 min-w-0">
        {allTerminated && <CheckCheck className={`w-3 h-3 inline mr-1 ${hasFailed ? 'text-amber-400' : 'text-emerald-400'}`} />}
        {label}
      </span>

      {allTerminated && (
        <button
          onClick={handleResolve}
          className={`text-xs shrink-0 transition-colors ${
            hasFailed
              ? 'text-amber-400 hover:text-amber-300'
              : 'text-emerald-400 hover:text-emerald-300'
          }`}
          aria-label="Resolve inbox item"
        >
          Resolve
        </button>
      )}

      <button
        onClick={handleReopen}
        className="text-xs text-blue-400 hover:text-blue-300 shrink-0 flex items-center gap-0.5 transition-colors"
        aria-label="Reopen action plan drawer"
      >
        <ExternalLink className="w-3 h-3" />
        Reopen
      </button>

      {!hasRunning && (
        <Tooltip content="Dismiss tracker">
          <button
            onClick={clearExecution}
            className="text-slate-600 hover:text-slate-400 shrink-0 transition-colors"
            aria-label="Dismiss action plan tracker"
          >
            <X className="w-3 h-3" />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
