// @vitest-environment jsdom
/**
 * The plan create dialog's payload construction.
 *
 * The dialog gained the graph fields (depends_on, branch_on/branches,
 * subplan). What matters is the shape that reaches the agent: dependencies
 * split into a list, branches parsed from "value: skill" lines into the
 * mapping the interpreter reads, and empty graph fields absent rather than
 * sent as empty strings the server would faithfully store.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: unknown[]) => args.filter(Boolean).join(' ') }));

import { CreatePlanDialog } from '../toolbox/CreatePlanDialog';

const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

function lastRequestBody(): { phases: Record<string, unknown>[] } {
  const [, init] = mockFetch.mock.calls[mockFetch.mock.calls.length - 1];
  return JSON.parse((init as RequestInit).body as string);
}

describe('CreatePlanDialog', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ status: 'created' }) });
  });
  afterEach(cleanup);

  function fillBasics() {
    fireEvent.change(screen.getByPlaceholderText('e.g. disk-pressure'), { target: { value: 'disk-pressure' } });
    fireEvent.change(screen.getByPlaceholderText('phase id (e.g. diagnose)'), { target: { value: 'triage' } });
  }

  it('sends dependencies as a list and drops empty graph fields', async () => {
    render(<CreatePlanDialog onClose={() => {}} onCreated={() => {}} />);
    fillBasics();
    fireEvent.change(screen.getByPlaceholderText('depends on: triage, logs'), {
      target: { value: ' a , b ' },
    });
    fireEvent.click(screen.getByText('Create plan'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const phase = lastRequestBody().phases[0];
    expect(phase.depends_on).toEqual(['a', 'b']);
    expect(phase).not.toHaveProperty('branch_on');
    expect(phase).not.toHaveProperty('branches');
    expect(phase).not.toHaveProperty('subplan');
  });

  it('parses branches from value: skill lines', async () => {
    render(<CreatePlanDialog onClose={() => {}} onCreated={() => {}} />);
    fillBasics();
    fireEvent.change(screen.getByPlaceholderText('branch on finding: cause'), {
      target: { value: 'cause' },
    });
    // The branches editor only appears once branch_on is set. The
    // placeholder holds a newline, which the DOM may normalize, so match on
    // its stable first line instead of the exact string.
    const branchesBox = await screen.findByPlaceholderText(/oom: oom-investigator/);
    fireEvent.change(branchesBox, {
      target: { value: 'oom: oom-investigator\nconfig: config-auditor, sre\nmalformed line' },
    });
    fireEvent.click(screen.getByText('Create plan'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    const phase = lastRequestBody().phases[0];
    expect(phase.branch_on).toBe('cause');
    expect(phase.branches).toEqual({
      oom: ['oom-investigator'],
      config: ['config-auditor', 'sre'],
    });
  });

  it('sends subplan when set', async () => {
    render(<CreatePlanDialog onClose={() => {}} onCreated={() => {}} />);
    fillBasics();
    fireEvent.change(screen.getByPlaceholderText('sub-plan: oom-investigation'), {
      target: { value: 'oom-investigation' },
    });
    fireEvent.click(screen.getByText('Create plan'));

    await waitFor(() => expect(mockFetch).toHaveBeenCalled());
    expect(lastRequestBody().phases[0].subplan).toBe('oom-investigation');
  });
});
