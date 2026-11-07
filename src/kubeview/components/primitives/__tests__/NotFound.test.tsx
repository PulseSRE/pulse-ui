// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { NotFound, ReadFailure, onCluster } from '../NotFound';
import { PulseError } from '../../../engine/errors';
import { AgentHttpError } from '../../../engine/safeQuery';
import { isNotFoundError } from '../../../engine/readError';

afterEach(cleanup);

const k8sError = (statusCode: number) =>
  new PulseError({ message: `status ${statusCode}`, category: 'server', statusCode, context: { operation: 'get' }, userMessage: '', suggestions: [] } as unknown as ConstructorParameters<typeof PulseError>[0]);

const notFound = {
  what: 'Pod web-1',
  where: onCluster('local'),
  actions: [{ label: 'Go to pods in shop', href: '/r/v1~pods?ns=shop', onClick: vi.fn() }] as [{ label: string; href: string; onClick: () => void }],
};

describe('NotFound', () => {
  it('says what was not found and where Pulse looked', () => {
    render(<NotFound {...notFound} reason="It may have been deleted." />);
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Pod web-1 not found');
    expect(screen.getByTestId('not-found').textContent).toContain('Looked on cluster Local Cluster. It may have been deleted.');
  });

  it('is the page heading when asked, and takes a title override', () => {
    render(<NotFound {...notFound} headingLevel={1} title="Pod web-1 is not in the graph" />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Pod web-1 is not in the graph');
  });

  it('actions are real links: plain click in the app, modified click to the browser; no-href actions are buttons', () => {
    const go = vi.fn();
    const close = vi.fn();
    render(<NotFound what="Custom view" where="in your saved views" actions={[{ label: 'Go to Views', href: '/views', onClick: go }, { label: 'Close tab', onClick: close }]} />);
    const link = screen.getByRole('link', { name: 'Go to Views' });
    expect(link.getAttribute('href')).toBe('/views');
    expect(fireEvent.click(link, { ctrlKey: true })).toBe(true);
    expect(fireEvent.click(link, { button: 1 })).toBe(true);
    expect(go).not.toHaveBeenCalled();
    expect(fireEvent.click(link)).toBe(false);
    expect(go).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close tab' }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});

describe('ReadFailure picks NotFound or LoadError', () => {
  it.each([
    ['k8s 404', k8sError(404)],
    ['agent 404', new AgentHttpError(404, 'gone')],
    ['agent 410', new AgentHttpError(410, 'expired')],
  ])('%s → NotFound, no alert, no Retry', (_label, error) => {
    expect(isNotFoundError(error)).toBe(true);
    render(<ReadFailure error={error} title="Could not load pod web-1" onRetry={vi.fn()} notFound={notFound} />);
    expect(screen.getByTestId('not-found')).toBeDefined();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it.each([
    ['k8s 403', k8sError(403)],
    ['k8s 500', k8sError(500)],
    ['agent 403', new AgentHttpError(403, 'forbidden')],
    ['agent 503', new AgentHttpError(503, 'down')],
    ['network', new TypeError('Failed to fetch')],
  ])('%s → LoadError with Retry, not NotFound', (_label, error) => {
    expect(isNotFoundError(error)).toBe(false);
    const retry = vi.fn();
    render(<ReadFailure error={error} title="Could not load pod web-1" onRetry={retry} notFound={notFound} />);
    expect(screen.queryByTestId('not-found')).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('Could not load pod web-1');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
