import { describe, it, expect, beforeEach } from 'vitest';
import { useActionPlanStore, resolveStepStatus, isStepDone, type ActionPlanStep } from '../actionPlanStore';

const STEPS: ActionPlanStep[] = [
  { title: 'Get pod status', description: 'Check pods', tool: 'get_pods', tool_input: {}, risk: 'low', status: 'pending' },
  { title: 'Check logs', description: 'Read logs', tool: 'get_pod_logs', tool_input: {}, risk: 'low', status: 'pending' },
  { title: 'Scale deployment', description: 'Scale up', tool: 'scale_deployment', tool_input: {}, risk: 'medium', status: 'pending' },
];

describe('actionPlanStore', () => {
  beforeEach(() => {
    useActionPlanStore.getState().clearExecution();
  });

  it('initializes with null execution', () => {
    expect(useActionPlanStore.getState().execution).toBeNull();
  });

  it('startExecution creates execution with correct shape', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Pod crashloop', STEPS);
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.itemId).toBe('item-1');
    expect(exec.itemTitle).toBe('Pod crashloop');
    expect(exec.steps).toHaveLength(3);
    expect(exec.stepStatuses).toEqual({});
    expect(exec.activeStepIndex).toBeNull();
    expect(exec.awaitingCompletion).toBe(false);
    expect(exec.completedAt).toBeNull();
  });

  it('startStep sets step to running and enables awaitingCompletion', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(0);
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.stepStatuses[0]).toBe('running');
    expect(exec.activeStepIndex).toBe(0);
    expect(exec.awaitingCompletion).toBe(true);
  });

  it('startStep skips previously running step', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().startStep(1);
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.stepStatuses[0]).toBe('skipped');
    expect(exec.stepStatuses[1]).toBe('running');
    expect(exec.activeStepIndex).toBe(1);
  });

  it('completeActiveStep marks step complete and clears active', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().completeActiveStep();
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.stepStatuses[0]).toBe('complete');
    expect(exec.activeStepIndex).toBeNull();
    expect(exec.awaitingCompletion).toBe(false);
  });

  it('completeActiveStep is no-op when awaitingCompletion is false', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().clearAwaitingCompletion();
    useActionPlanStore.getState().completeActiveStep();
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.stepStatuses[0]).toBe('running');
  });

  it('failActiveStep marks step failed', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(1);
    useActionPlanStore.getState().failActiveStep();
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.stepStatuses[1]).toBe('failed');
    expect(exec.activeStepIndex).toBeNull();
    expect(exec.awaitingCompletion).toBe(false);
  });

  it('setStepStatus updates individual step', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().setStepStatus(2, 'skipped');
    expect(useActionPlanStore.getState().execution!.stepStatuses[2]).toBe('skipped');
  });

  it('sets completedAt when all steps are terminated (complete, skipped, or failed)', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'skipped');
    expect(useActionPlanStore.getState().execution!.completedAt).toBeNull();
    useActionPlanStore.getState().setStepStatus(2, 'complete');
    expect(useActionPlanStore.getState().execution!.completedAt).toBeGreaterThan(0);
  });

  it('sets completedAt when steps include failures', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'failed');
    expect(useActionPlanStore.getState().execution!.completedAt).toBeNull();
    useActionPlanStore.getState().setStepStatus(2, 'skipped');
    expect(useActionPlanStore.getState().execution!.completedAt).toBeGreaterThan(0);
  });

  it('sets completedAt via completeActiveStep when last step finishes', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().setStepStatus(1, 'complete');
    useActionPlanStore.getState().startStep(2);
    useActionPlanStore.getState().completeActiveStep();
    expect(useActionPlanStore.getState().execution!.completedAt).toBeGreaterThan(0);
  });

  it('clearAwaitingCompletion guards against follow-up done events', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().clearAwaitingCompletion();
    expect(useActionPlanStore.getState().execution!.awaitingCompletion).toBe(false);
  });

  it('clearExecution resets to null', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    useActionPlanStore.getState().clearExecution();
    expect(useActionPlanStore.getState().execution).toBeNull();
  });

  it('resolveStepStatus returns override, then original, then pending', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    const exec1 = useActionPlanStore.getState().execution!;
    expect(resolveStepStatus(exec1, 0)).toBe('pending');
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    const exec2 = useActionPlanStore.getState().execution!;
    expect(resolveStepStatus(exec2, 0)).toBe('complete');
  });

  it('isStepDone returns true for complete and skipped', () => {
    expect(isStepDone('complete')).toBe(true);
    expect(isStepDone('skipped')).toBe(true);
    expect(isStepDone('pending')).toBe(false);
    expect(isStepDone('running')).toBe(false);
    expect(isStepDone('failed')).toBe(false);
  });

  it('clearAwaitingCompletion is no-op when already false', () => {
    useActionPlanStore.getState().startExecution('item-1', 'Test', STEPS);
    const before = useActionPlanStore.getState().execution;
    useActionPlanStore.getState().clearAwaitingCompletion();
    expect(useActionPlanStore.getState().execution).toBe(before);
  });

  it('startExecution replaces existing execution', () => {
    useActionPlanStore.getState().startExecution('item-1', 'First', STEPS);
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().startExecution('item-2', 'Second', STEPS);
    const exec = useActionPlanStore.getState().execution!;
    expect(exec.itemId).toBe('item-2');
    expect(exec.activeStepIndex).toBeNull();
    expect(exec.stepStatuses).toEqual({});
  });

  it('no-ops when execution is null', () => {
    useActionPlanStore.getState().startStep(0);
    useActionPlanStore.getState().completeActiveStep();
    useActionPlanStore.getState().failActiveStep();
    useActionPlanStore.getState().setStepStatus(0, 'complete');
    useActionPlanStore.getState().clearAwaitingCompletion();
    expect(useActionPlanStore.getState().execution).toBeNull();
  });
});
