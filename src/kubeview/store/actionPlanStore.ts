/**
 * Action Plan Store — tracks execution state for inbox action plan steps.
 * Bridges the TaskDetailDrawer (where plans are displayed) and the AI sidebar
 * (where the agent executes steps). Ephemeral session state, no persistence.
 */

import { create } from 'zustand';

export interface ActionPlanStep {
  title: string;
  description: string;
  tool: string | null;
  tool_input: Record<string, unknown> | null;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
}

export type StepStatus = ActionPlanStep['status'];

interface ActionPlanExecution {
  itemId: string;
  itemTitle: string;
  steps: ActionPlanStep[];
  stepStatuses: Record<number, StepStatus>;
  activeStepIndex: number | null;
  awaitingCompletion: boolean;
  completedAt: number | null;
}

interface ActionPlanState {
  execution: ActionPlanExecution | null;

  startExecution: (itemId: string, itemTitle: string, steps: ActionPlanStep[]) => void;
  startStep: (stepIndex: number) => void;
  completeActiveStep: () => void;
  failActiveStep: () => void;
  setStepStatus: (stepIndex: number, status: StepStatus) => void;
  clearAwaitingCompletion: () => void;
  clearExecution: () => void;
}

export function isStepDone(status: StepStatus): boolean {
  return status === 'complete' || status === 'skipped';
}

export function isAllTerminated(exec: ActionPlanExecution): boolean {
  return exec.steps.every((_, i) => {
    const s = exec.stepStatuses[i] ?? exec.steps[i].status ?? 'pending';
    return s !== 'pending' && s !== 'running';
  });
}

export function resolveStepStatus(exec: ActionPlanExecution, stepIndex: number): StepStatus {
  return exec.stepStatuses[stepIndex] ?? exec.steps[stepIndex]?.status ?? 'pending';
}

export const useActionPlanStore = create<ActionPlanState>((set, get) => ({
  execution: null,

  startExecution: (itemId, itemTitle, steps) => {
    set({
      execution: {
        itemId,
        itemTitle,
        steps: [...steps],
        stepStatuses: {},
        activeStepIndex: null,
        awaitingCompletion: false,
        completedAt: null,
      },
    });
  },

  startStep: (stepIndex) => {
    const { execution } = get();
    if (!execution) return;

    const next: Record<number, StepStatus> = { ...execution.stepStatuses };

    if (execution.activeStepIndex != null && next[execution.activeStepIndex] === 'running') {
      next[execution.activeStepIndex] = 'skipped';
    }

    next[stepIndex] = 'running';

    set({
      execution: {
        ...execution,
        stepStatuses: next,
        activeStepIndex: stepIndex,
        awaitingCompletion: true,
      },
    });
  },

  completeActiveStep: () => {
    const { execution } = get();
    if (!execution || !execution.awaitingCompletion || execution.activeStepIndex == null) return;

    const next = { ...execution.stepStatuses, [execution.activeStepIndex]: 'complete' as StepStatus };
    const updated: ActionPlanExecution = {
      ...execution,
      stepStatuses: next,
      activeStepIndex: null,
      awaitingCompletion: false,
    };

    if (isAllTerminated(updated)) {
      updated.completedAt = Date.now();
    }

    set({ execution: updated });
  },

  failActiveStep: () => {
    const { execution } = get();
    if (!execution || !execution.awaitingCompletion || execution.activeStepIndex == null) return;

    set({
      execution: {
        ...execution,
        stepStatuses: { ...execution.stepStatuses, [execution.activeStepIndex]: 'failed' as StepStatus },
        activeStepIndex: null,
        awaitingCompletion: false,
      },
    });
  },

  setStepStatus: (stepIndex, status) => {
    const { execution } = get();
    if (!execution) return;

    const next = { ...execution.stepStatuses, [stepIndex]: status };
    const updated: ActionPlanExecution = { ...execution, stepStatuses: next };

    if (isAllTerminated(updated)) {
      updated.completedAt = Date.now();
    }

    set({ execution: updated });
  },

  clearAwaitingCompletion: () => {
    const { execution } = get();
    if (!execution || !execution.awaitingCompletion) return;
    set({ execution: { ...execution, awaitingCompletion: false } });
  },

  clearExecution: () => {
    set({ execution: null });
  },
}));
