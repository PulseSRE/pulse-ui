// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { ComponentSpec } from '../../../engine/agentComponents';
import { useCustomViewStore, type ViewVersion } from '../../../store/customViewStore';
import { AgentEditBanner, describeDiff, diffLayouts, isAgentEdit } from '../AgentEditBanner';

const w = (title: string, extra: Record<string, unknown> = {}) => ({ kind: 'chart', title, ...extra }) as unknown as ComponentSpec;

describe('diffLayouts', () => {
  it('names added, removed, changed and reordered widgets', () => {
    const before = [w('CPU'), w('Alerts'), w('Old', { query: 'old_metric' })];
    const after = [w('Alerts'), w('CPU', { chartType: 'bar' }), w('Memory', { query: 'memory_bytes' })];
    const d = diffLayouts(before, after);
    expect(d.added).toEqual(['Memory']);
    expect(d.removed).toEqual(['Old']);
    expect(d.changed).toEqual(['CPU']);
    expect(d.reordered).toBe(true);
    expect(describeDiff(d)).toEqual(['added Memory', 'removed Old', 'changed CPU', 'reordered widgets']);
  });

  it('reads a title change in the same slot as a rename', () => {
    const d = diffLayouts([w('Nodes'), w('CPU')], [w('Nodes Ready'), w('CPU')]);
    expect(d.renamed).toEqual([['Nodes', 'Nodes Ready']]);
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('finds nothing when the layout is unchanged', () => {
    expect(describeDiff(diffLayouts([w('A'), w('B')], [w('A'), w('B')]))).toEqual([]);
  });
});

describe('isAgentEdit', () => {
  it('recognises agent edit actions, not user or restore ones', () => {
    expect(isAgentEdit('agent:move_widget')).toBe(true);
    expect(isAgentEdit('agent_update')).toBe(true);
    expect(isAgentEdit('add_widget')).toBe(true);
    expect(isAgentEdit('before_restore_to_v3')).toBe(false);
    expect(isAgentEdit('shared')).toBe(false);
  });
});

describe('AgentEditBanner', () => {
  const restoreVersion = vi.fn();
  function withLatest(version: Partial<ViewVersion> | null) {
    useCustomViewStore.setState({
      getLatestVersion: vi.fn().mockResolvedValue(
        version && { version: 7, action: 'agent:move_widget', created_at: new Date().toISOString(), layout: [], ...version },
      ),
      restoreVersion,
    });
  }

  beforeEach(() => {
    restoreVersion.mockReset().mockResolvedValue(undefined);
    localStorage.clear();
  });
  afterEach(() => cleanup());

  const current = [w('Alerts'), w('CPU')];

  it('says what the last agent edit changed and undoes it', async () => {
    withLatest({ layout: [w('CPU'), w('Alerts')] });
    const { findByText, getByRole } = render(<AgentEditBanner viewId="cv-1" layout={current} />);

    expect(await findByText(/reordered widgets/)).toBeTruthy();
    fireEvent.click(getByRole('button', { name: /undo/i }));
    await waitFor(() => expect(restoreVersion).toHaveBeenCalledWith('cv-1', 7));
  });

  it('stays hidden for edits that were not the agent', async () => {
    withLatest({ action: 'before_restore_to_v6', layout: [w('CPU'), w('Alerts')] });
    const { container } = render(<AgentEditBanner viewId="cv-1" layout={current} />);
    await waitFor(() => expect(useCustomViewStore.getState().getLatestVersion).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('stays hidden when nothing visible changed (e.g. already undone)', async () => {
    withLatest({ layout: current });
    const { container } = render(<AgentEditBanner viewId="cv-1" layout={current} />);
    await waitFor(() => expect(useCustomViewStore.getState().getLatestVersion).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('stays hidden for edits older than a day', async () => {
    withLatest({ layout: [w('CPU'), w('Alerts')], created_at: new Date(Date.now() - 2 * 86400_000).toISOString() });
    const { container } = render(<AgentEditBanner viewId="cv-1" layout={current} />);
    await waitFor(() => expect(useCustomViewStore.getState().getLatestVersion).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('dismissing hides that edit and stays dismissed', async () => {
    withLatest({ layout: [w('CPU'), w('Alerts')] });
    const first = render(<AgentEditBanner viewId="cv-1" layout={current} />);
    fireEvent.click(await first.findByRole('button', { name: 'Dismiss' }));
    expect(first.container.textContent).toBe('');
    first.unmount();

    const again = render(<AgentEditBanner viewId="cv-1" layout={current} />);
    await waitFor(() => expect(useCustomViewStore.getState().getLatestVersion).toHaveBeenCalled());
    expect(again.container.textContent).toBe('');
  });
});
