// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

vi.mock('../../components/primitives/Card', () => ({
  Card: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="card" className={className}>{children}</div>
  ),
}));

vi.mock('../../components/primitives/EmptyState', () => ({
  EmptyState: ({ title, description }: { title: string; description: string }) => (
    <div data-testid="empty-state">
      <span>{title}</span>
      <span>{description}</span>
    </div>
  ),
}));

vi.mock('../../engine/formatters', () => ({
  formatRelativeTime: (ts: number) => 'just now',
}));

import MemoryView from '../MemoryView';

function createQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

function renderView() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <MemoryRouter>
        <MemoryView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('MemoryView', () => {
  afterEach(cleanup);

  it('renders page header', () => {
    renderView();
    expect(screen.getByText("Agent Intelligence")).toBeDefined();
  });

  it('renders subtitle', () => {
    renderView();
    expect(screen.getByText(/The agent learns from every interaction/)).toBeDefined();
  });

  it('renders tab buttons', () => {
    renderView();
    expect(screen.getByText('Learned Runbooks')).toBeDefined();
    expect(screen.getByText('Detected Patterns')).toBeDefined();
    expect(screen.getAllByText('Incident History').length).toBeGreaterThanOrEqual(1);
  });

  it('shows incidents tab by default with search input', () => {
    renderView();
    expect(screen.getByLabelText('Search incidents')).toBeDefined();
  });

  it('shows tab description section', () => {
    renderView();
    // The incidents tab description should be shown by default
    expect(screen.getByText(/Every interaction is scored/)).toBeDefined();
  });

  it('shows loading state for incidents', () => {
    renderView();
    expect(screen.getByText('Loading incidents...')).toBeDefined();
  });
});
