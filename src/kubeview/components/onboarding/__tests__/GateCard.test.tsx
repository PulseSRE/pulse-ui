// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

const mockOpenDock = vi.fn();
const mockConnectAndSend = vi.fn();

vi.mock('../../../store/uiStore', () => ({
  useUIStore: Object.assign(
    (selector?: any) => {
      const state = { openDock: mockOpenDock };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ openDock: mockOpenDock }) },
  ),
}));

vi.mock('../../../store/agentStore', () => ({
  useAgentStore: Object.assign(
    (selector?: any) => {
      const state = { connectAndSend: mockConnectAndSend };
      return selector ? selector(state) : state;
    },
    { getState: () => ({ connectAndSend: mockConnectAndSend }) },
  ),
}));

import { GateCard } from '../GateCard';
import type { ReadinessGate, GateResult } from '../../../engine/readiness/types';

function makeGate(overrides: Partial<ReadinessGate> = {}): ReadinessGate {
  return {
    id: overrides.id ?? 'gate-1',
    title: overrides.title ?? 'TLS Configured',
    description: overrides.description ?? 'Check TLS termination',
    whyItMatters: overrides.whyItMatters ?? 'Secure connections are essential',
    category: overrides.category ?? 'security',
    priority: overrides.priority ?? 'blocking',
    evaluate: overrides.evaluate ?? vi.fn(),
  };
}

function makeResult(overrides: Partial<GateResult> = {}): GateResult {
  return {
    gateId: overrides.gateId ?? 'gate-1',
    status: overrides.status ?? 'passed',
    detail: overrides.detail ?? 'All good',
    fixGuidance: overrides.fixGuidance ?? '',
    evaluatedAt: overrides.evaluatedAt ?? Date.now(),
  };
}

describe('GateCard', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it('renders gate title and whyItMatters', () => {
    render(<GateCard gate={makeGate()} />);
    expect(screen.getByText('TLS Configured')).toBeDefined();
    expect(screen.getByText('Secure connections are essential')).toBeDefined();
  });

  it('shows Not Started label when no result', () => {
    render(<GateCard gate={makeGate()} />);
    expect(screen.getByText('Not Started')).toBeDefined();
  });

  it('shows Passed label when result is passed', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'passed' })} />);
    expect(screen.getByText('Passed')).toBeDefined();
  });

  it('shows Failed label and auto-expands when result is failed', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed', detail: 'Missing cert' })} />);
    expect(screen.getByText('Failed')).toBeDefined();
    // auto-expanded, so evidence should be visible
    expect(screen.getByText('Evidence')).toBeDefined();
    expect(screen.getByText('Missing cert')).toBeDefined();
  });

  it('shows Waived label when waived prop is true', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed' })} waived={true} waiverReason="Accepted risk" />);
    expect(screen.getByText('Waived')).toBeDefined();
  });

  it('shows waiver reason when waived', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed' })} waived={true} waiverReason="Accepted risk" />);
    // Waived gates are not auto-expanded; click to expand
    fireEvent.click(screen.getByText('TLS Configured'));
    expect(screen.getByText(/Accepted risk/)).toBeDefined();
  });

  it('shows fix guidance for failed gates', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed', detail: 'Bad', fixGuidance: 'Run this command' })} />);
    expect(screen.getByText('Remediation')).toBeDefined();
    expect(screen.getByText('Run this command')).toBeDefined();
  });

  it('shows fix link when available', () => {
    const result: GateResult = {
      gateId: 'gate-1',
      status: 'failed',
      detail: 'Bad',
      fixGuidance: 'Fix it',
      fixLink: '/fix',
      evaluatedAt: Date.now(),
    };
    render(<GateCard gate={makeGate()} result={result} />);
    // The link text contains an arrow character
    const links = screen.getAllByRole('link');
    const fixLink = links.find(l => l.getAttribute('href') === '/fix');
    expect(fixLink).toBeDefined();
  });

  it('shows Re-verify button when onReVerify is provided', () => {
    const onReVerify = vi.fn();
    // Click to expand first (not_started is collapsed by default)
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed' })} onReVerify={onReVerify} />);
    fireEvent.click(screen.getByText('Re-verify'));
    expect(onReVerify).toHaveBeenCalledWith('gate-1');
  });

  it('shows Waive button for non-passed, non-waived gates', () => {
    const onWaive = vi.fn();
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed' })} onWaive={onWaive} />);
    fireEvent.click(screen.getByText('Waive'));
    expect(onWaive).toHaveBeenCalledWith('gate-1');
  });

  it('hides Waive button for passed gates', () => {
    const onWaive = vi.fn();
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'passed' })} onWaive={onWaive} />);
    // expand
    fireEvent.click(screen.getByText('TLS Configured'));
    expect(screen.queryByText('Waive')).toBeNull();
  });

  it('shows Fix with AI button for failed gates and triggers agent', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'failed', detail: 'Bad config' })} />);
    fireEvent.click(screen.getByText('Fix with AI'));
    expect(mockOpenDock).toHaveBeenCalledWith('agent');
    expect(mockConnectAndSend).toHaveBeenCalledWith(expect.stringContaining('TLS Configured'));
  });

  it('toggles expanded state on click', () => {
    render(<GateCard gate={makeGate()} result={makeResult({ status: 'passed', detail: 'All good' })} />);
    // passed gate starts collapsed
    expect(screen.queryByText('Evidence')).toBeNull();
    fireEvent.click(screen.getByText('TLS Configured'));
    expect(screen.getByText('Evidence')).toBeDefined();
    fireEvent.click(screen.getByText('TLS Configured'));
    expect(screen.queryByText('Evidence')).toBeNull();
  });
});
