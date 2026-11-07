// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

vi.mock('../../../engine/askPulse', () => ({ askPulse: vi.fn() }));

import { askPulse } from '../../../engine/askPulse';
import { useFleetStore } from '../../../store/fleetStore';
import { AskPulseButton, AskPulsePrompts, askPulseLabel, useAskPulseBlockedReason } from '../AskPulseButton';
import { AskPulseButtonBase } from '../AskPulseButtonBase';
import { AI_ACCENT } from '../aiTokens';
import { PULSE_AI_LOCAL_ONLY } from '../../feedback/LocalClusterOnlyNotice';

const POD = { kind: 'Pod', name: 'api-7f9c', namespace: 'payments', gvr: 'v1~pods' };

beforeEach(() => {
  vi.mocked(askPulse).mockClear();
  useFleetStore.setState({ activeClusterId: 'local' });
});
afterEach(() => {
  cleanup();
  useFleetStore.setState({ activeClusterId: 'local' });
});

describe('AskPulseButton', () => {
  it('is labelled "Ask Pulse", with a suffix only when one is given', () => {
    expect(askPulseLabel()).toBe('Ask Pulse');
    expect(askPulseLabel('why')).toBe('Ask Pulse why');
    expect(askPulseLabel('to fix')).toBe('Ask Pulse to fix');
    expect(askPulseLabel('about this pod')).toBe('Ask Pulse about this pod');
    render(<><AskPulseButton prompt="q" /><AskPulseButton suffix="to investigate" prompt="q" /></>);
    expect(screen.getByRole('button', { name: 'Ask Pulse' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask Pulse to investigate' })).toBeTruthy();
  });

  it('uses the one AI style and icon', () => {
    render(<AskPulseButton prompt="q" />);
    const btn = screen.getByRole('button', { name: 'Ask Pulse' });
    for (const cls of AI_ACCENT.button.split(' ')) expect(btn.className).toContain(cls);
    expect(btn.querySelector('svg.lucide-sparkles')).not.toBeNull();
    expect(btn.getAttribute('data-ai-entry')).toBe('ask-pulse');
  });

  it('sends the question with the resource and namespace attached', () => {
    render(<AskPulseButton suffix="why" prompt="Why is it crashing?" context={POD} />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse why' }));
    expect(askPulse).toHaveBeenCalledWith('Why is it crashing?', POD);
  });

  it('builds a function prompt at click time', () => {
    let n = 1;
    render(<AskPulseButton prompt={() => `question ${n}`} />);
    n = 2;
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    expect(askPulse).toHaveBeenCalledWith('question 2', undefined);
  });

  it('runs the entry\'s own route instead when onAsk is given', () => {
    const onAsk = vi.fn();
    render(<AskPulseButton onAsk={onAsk} prompt="ignored" />);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse' }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(askPulse).not.toHaveBeenCalled();
  });

  it('on a remote cluster is disabled with the shared wording and sends nothing', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    const onAsk = vi.fn();
    render(<><AskPulseButton prompt="q" context={POD} /><AskPulseButton suffix="to fix" onAsk={onAsk} /></>);
    const btn = screen.getByRole('button', { name: 'Ask Pulse' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.title).toBe('Pulse AI answers about the local cluster only.');
    expect(PULSE_AI_LOCAL_ONLY).toBe('Pulse AI answers about the local cluster only.');
    // Announced to screen readers, not only on hover.
    const described = document.getElementById(btn.getAttribute('aria-describedby')!);
    expect(described?.textContent).toBe(PULSE_AI_LOCAL_ONLY);
    fireEvent.click(btn);
    fireEvent.click(screen.getByRole('button', { name: 'Ask Pulse to fix' }));
    expect(askPulse).not.toHaveBeenCalled();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it('localData skips the remote gate: the question carries only local or agent data', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    const onAsk = vi.fn();
    render(<AskPulseButton suffix="to investigate" onAsk={onAsk} localData />);
    const btn = screen.getByRole('button', { name: 'Ask Pulse to investigate' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    expect(onAsk).toHaveBeenCalledTimes(1);
  });

  it('useAskPulseBlockedReason gates other AI controls the same way', () => {
    function Probe({ local }: { local?: boolean }) { return <span data-testid="r">{useAskPulseBlockedReason(local) ?? 'ok'}</span>; }
    const { rerender } = render(<Probe />);
    expect(screen.getByTestId('r').textContent).toBe('ok');
    act(() => { useFleetStore.setState({ activeClusterId: 'prod-east' }); });
    rerender(<Probe />);
    expect(screen.getByTestId('r').textContent).toBe(PULSE_AI_LOCAL_ONLY);
    rerender(<Probe local />);
    expect(screen.getByTestId('r').textContent).toBe('ok');
  });

  it('shows the reason as visible text when asked to', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    render(<AskPulseButton prompt="q" showReason />);
    expect(screen.getByText(PULSE_AI_LOCAL_ONLY).className).not.toContain('sr-only');
  });

  it('keeps a caller\'s own disabled reason on the local cluster', () => {
    render(<AskPulseButton prompt="q" disabledReason="Checking…" />);
    expect((screen.getByRole('button', { name: 'Ask Pulse' }) as HTMLButtonElement).title).toBe('Checking…');
  });
});

describe('AskPulseButtonBase (store-free, for ErrorBoundary)', () => {
  it('has the same label and style', () => {
    const onClick = vi.fn();
    render(<AskPulseButtonBase onClick={onClick} />);
    const btn = screen.getByRole('button', { name: 'Ask Pulse' });
    expect(btn.className).toContain('bg-violet-500/15');
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalled();
  });
});

describe('AskPulsePrompts', () => {
  it('sends each chip with the context, under an "Ask Pulse …" heading', () => {
    render(<AskPulsePrompts suffix="about this pod" prompts={['What changed recently?']} context={POD} />);
    expect(screen.getByRole('heading', { name: 'Ask Pulse about this pod' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'What changed recently?' }));
    expect(askPulse).toHaveBeenCalledWith('What changed recently?', POD);
  });

  it('a chip may carry its own resource, and the heading level is configurable', () => {
    const op = { kind: 'ClusterOperator', name: 'dns' };
    render(<AskPulsePrompts headingLevel={3} prompts={[{ text: 'Why is operator dns degraded?', context: op }]} />);
    expect(screen.getByRole('heading', { level: 3, name: 'Ask Pulse' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Why is operator dns degraded?' }));
    expect(askPulse).toHaveBeenCalledWith('Why is operator dns degraded?', op);
  });

  it('disables the chips on a remote cluster and says why', () => {
    useFleetStore.setState({ activeClusterId: 'prod-east' });
    render(<AskPulsePrompts prompts={['Run a full security audit']} />);
    const chip = screen.getByRole('button', { name: 'Run a full security audit' }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    expect(screen.getByText(PULSE_AI_LOCAL_ONLY)).toBeTruthy();
    fireEvent.click(chip);
    expect(askPulse).not.toHaveBeenCalled();
  });
});
