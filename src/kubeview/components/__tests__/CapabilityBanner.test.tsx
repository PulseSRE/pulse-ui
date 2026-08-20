// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CapabilityBanner } from '../primitives/CapabilityBanner';

const state: { findings: Array<Record<string, unknown>> } = { findings: [] };

vi.mock('../../store/monitorStore', () => ({
  useMonitorStore: (selector: (s: typeof state) => unknown) => selector(state),
}));

function finding(over: Record<string, unknown> = {}) {
  return {
    id: 'f-1',
    severity: 'warning',
    category: 'degraded',
    title: 'Scanner alerts has failed 7 runs in a row',
    summary: '',
    resources: [],
    autoFixable: false,
    timestamp: 0,
    ...over,
  };
}

describe('CapabilityBanner', () => {
  it('stays out of the way when nothing is degraded', () => {
    state.findings = [];
    const { container } = render(<CapabilityBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('ignores ordinary findings', () => {
    state.findings = [finding({ category: 'crashloop', title: 'Pod restarting' })];
    const { container } = render(<CapabilityBanner />);
    expect(container.innerHTML).toBe('');
  });

  it('names what has gone blind', () => {
    state.findings = [finding()];
    render(<CapabilityBanner />);
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Scanner alerts has failed 7 runs/)).toBeTruthy();
  });

  it('says that missing findings mean unknown, not clear', () => {
    state.findings = [finding()];
    render(<CapabilityBanner />);
    expect(screen.getByText(/unknown rather than clear/i)).toBeTruthy();
  });

  it('counts multiple degraded capabilities', () => {
    state.findings = [finding(), finding({ id: 'f-2', title: 'AI investigations failing — 1111 in a row' })];
    render(<CapabilityBanner />);
    expect(screen.getByText(/2 capabilities affected/)).toBeTruthy();
  });

  it('escalates when a capability is critically degraded', () => {
    state.findings = [finding({ severity: 'critical', title: 'AI investigations failing — 1111 in a row' })];
    render(<CapabilityBanner />);
    expect(screen.getByRole('alert').className).toContain('red');
  });
});
