// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { StatCard } from '../StatCard';

describe('StatCard', () => {
  afterEach(cleanup);

  it('renders label, value, subtitle and icon', () => {
    render(<StatCard label="Nodes" value="3/4" subtitle="1 not ready" icon={<span data-testid="icon" />} />);
    expect(screen.getByText('Nodes')).toBeTruthy();
    expect(screen.getByText('3/4')).toBeTruthy();
    expect(screen.getByText('1 not ready')).toBeTruthy();
    expect(screen.getByTestId('icon')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is a real button when clickable, reachable and activatable by keyboard', () => {
    const onClick = vi.fn();
    render(<StatCard label="Nodes" value="3" onClick={onClick} />);
    const btn = screen.getByRole('button', { name: /Nodes/ });
    expect(btn.tagName).toBe('BUTTON');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('colours the value from statusColors, using amber for warning', () => {
    render(<StatCard label="Out of sync" value={2} variant="warning" highlight />);
    const value = screen.getByText('2');
    expect(value.className).toContain('text-amber-400');
    expect(value.className).not.toContain('yellow');
  });

  it('shows an issue count and a usage bar', () => {
    render(<StatCard label="Nodes" value="3" issues={2} bar={140} barTone="danger" />);
    expect(screen.getByLabelText('2 issues').textContent).toBe('2');
    const meter = screen.getByRole('meter');
    expect(meter.getAttribute('aria-valuenow')).toBe('100');
  });

  it('toggles its explanation', () => {
    render(
      <StatCard
        label="Error Rate"
        value="1%"
        explanation={{ what: 'Share of failed calls.', good: 'Under 1%.', bad: 'Over 5%.', action: 'Open usage', actionLink: '/agent?tab=usage' }}
      />,
    );
    const toggle = screen.getByRole('button', { name: 'Explain Error Rate' });
    expect(screen.queryByText('Share of failed calls.')).toBeNull();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Share of failed calls.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Open usage' }).getAttribute('href')).toBe('/agent?tab=usage');
  });
});
