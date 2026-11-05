// @vitest-environment jsdom
/**
 * LoadError never shows a raw parser message as the reason. Known failures map
 * to a plain sentence; the raw text stays reachable behind "Details".
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { LoadError } from '../LoadError';
import { PrometheusReadError, describeReadError } from '../../../engine/readError';

afterEach(cleanup);

function reasonOf() {
  // The first line under the title is the reason.
  const alert = screen.getByRole('alert');
  return alert.querySelector('.min-w-0 > div:nth-child(2)')?.textContent ?? '';
}

describe('LoadError', () => {
  it('maps a JSON parser message to plain text and keeps the raw message under Details', () => {
    const raw = `Unexpected token '<', "<!DOCTYPE "... is not valid JSON`;
    render(<LoadError title="Could not load metrics" error={new SyntaxError(raw)} />);
    expect(reasonOf()).toBe('The server answered with something that is not data — the backend may be down or behind a login page');
    expect(reasonOf()).not.toMatch(/Unexpected token/);
    const details = screen.getByText('Details').closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain(raw);
  });

  it('shows a PrometheusReadError message as is, with its raw detail behind Details', () => {
    const e = new PrometheusReadError('unreachable', 'Prometheus could not be reached — check the network or the metrics proxy', undefined, 'Failed to fetch');
    render(<LoadError title="Could not load metrics" error={e} />);
    expect(reasonOf()).toBe('Prometheus could not be reached — check the network or the metrics proxy');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('Failed to fetch');
  });

  it('maps a 403 to "no permission" and keeps the server text', () => {
    const e = Object.assign(new Error('pods is forbidden: User "dev" cannot list resource "pods"'), { statusCode: 403 });
    render(<LoadError title="Pods could not be loaded" error={e} />);
    expect(reasonOf()).toBe('You do not have permission to read this');
    expect(screen.getByText('Details').closest('details')!.textContent).toContain('cannot list resource');
  });

  it('maps a 401 to an expired session', () => {
    render(<LoadError title="x" error={Object.assign(new Error('Unauthorized'), { status: 401 })} />);
    expect(reasonOf()).toBe('Your session has expired — sign in again');
  });

  it('maps a network TypeError and a timeout', () => {
    expect(describeReadError(new TypeError('Failed to fetch')).reason).toBe('Could not reach the server — check the connection');
    expect(describeReadError(new DOMException('signal timed out', 'TimeoutError')).reason).toBe('The request timed out');
  });

  it('leaves an already-readable message alone, with no Details', () => {
    render(<LoadError title="x" error={new Error('Learned runbooks are disabled on this agent')} />);
    expect(reasonOf()).toBe('Learned runbooks are disabled on this agent');
    expect(screen.queryByText('Details')).toBeNull();
  });

  it('accepts a string and calls onRetry', () => {
    const onRetry = vi.fn();
    render(<LoadError title="x" error="Quota service unavailable" onRetry={onRetry} />);
    expect(reasonOf()).toBe('Quota service unavailable');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
