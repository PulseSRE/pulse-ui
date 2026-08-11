import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchAgentEvalStatus } from '../evalStatus';

describe('fetchAgentEvalStatus', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns parsed eval status on success', async () => {
    const data = {
      quality_gate_passed: true,
      generated_at_ms: 1700000000000,
      release: { gate_passed: true, scenario_count: 10, average_overall: 0.95 },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toEqual(data);
    expect(fetch).toHaveBeenCalledWith('/api/agent/eval/status', undefined);
  });

  it('returns null on non-ok response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: false,
      status: 404,
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toBeNull();
  });

  it('returns null when response is not an object', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve('not an object'),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toBeNull();
  });

  it('returns null when response is null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(null),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toBeNull();
  });

  it('returns null when quality_gate_passed is missing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ some: 'data' }),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toBeNull();
  });

  it('returns null when quality_gate_passed is not boolean', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ quality_gate_passed: 'yes' }),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toBeNull();
  });

  it('returns full status with all suites', async () => {
    const data = {
      quality_gate_passed: false,
      generated_at_ms: 1700000000000,
      release: { gate_passed: false, scenario_count: 20, average_overall: 0.7, blocker_counts: { critical: 2 } },
      safety: { gate_passed: true, scenario_count: 15, average_overall: 0.99 },
      integration: { gate_passed: true, scenario_count: 8, average_overall: 0.92 },
      outcomes: {
        gate_passed: true,
        current_actions: 100,
        baseline_actions: 95,
        regressions: { deploy: false },
      },
    };
    vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(data),
    } as Response);

    const result = await fetchAgentEvalStatus();
    expect(result).toEqual(data);
    expect(result!.quality_gate_passed).toBe(false);
    expect(result!.release!.blocker_counts).toEqual({ critical: 2 });
    expect(result!.outcomes!.current_actions).toBe(100);
  });
});
