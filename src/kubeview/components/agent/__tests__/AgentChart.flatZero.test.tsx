// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AgentChart from '../AgentChart';
import type { ChartSpec } from '../../../engine/agentComponents';

afterEach(() => cleanup());

function renderChart(spec: ChartSpec) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AgentChart spec={spec} />
    </QueryClientProvider>,
  );
}

const zeros = (label: string) => ({ label, data: [[1000, 0], [2000, 0], [3000, 0]] as [number, number][] });

describe('AgentChart flat at zero', () => {
  it('shows one compact line instead of a plot, and the chart on request', () => {
    const { container, getByText } = renderChart({ kind: 'chart', title: 'Restarts', series: [zeros('api'), zeros('web')], timeRange: '1h' } as ChartSpec);
    expect(container.querySelector('[data-flat-zero]')).not.toBeNull();
    expect(getByText('0 throughout the last 1h')).toBeTruthy();
    fireEvent.click(getByText('Show chart'));
    expect(container.querySelector('[data-flat-zero]')).toBeNull();
  });

  it('marks zero as good when higher is worse', () => {
    const { container } = renderChart({ kind: 'chart', title: 'Errors', series: [zeros('api')], thresholds: { warning: 1, critical: 5 } } as ChartSpec);
    expect(container.querySelector('[data-flat-zero]')?.className).toContain('text-emerald-400');
  });

  it('keeps the plot when any value is non-zero', () => {
    const { container } = renderChart({ kind: 'chart', title: 'Restarts', series: [{ label: 'api', data: [[1000, 0], [2000, 2]] }] } as ChartSpec);
    expect(container.querySelector('[data-flat-zero]')).toBeNull();
  });
});
