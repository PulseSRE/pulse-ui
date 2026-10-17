// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PreviewView, { PREVIEW_VIEW_ID } from '../PreviewView';
import { useCustomViewStore } from '../../store/customViewStore';

vi.mock('../../components/agent/AgentComponentRenderer', () => ({
  AgentComponentRenderer: ({ spec }: { spec: { title?: string } }) => <div data-testid="widget">{spec.title}</div>,
}));

function renderPreview() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <PreviewView />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
  delete window.__PULSE_PREVIEW__;
  useCustomViewStore.setState({ views: [] });
});

describe('PreviewView', () => {
  it('renders the injected draft without editing controls and without loading saved views', () => {
    const loadViews = vi.fn();
    useCustomViewStore.setState({ views: [], loadViews });
    window.__PULSE_PREVIEW__ = {
      title: 'Production overview',
      description: 'draft',
      layout: [{ kind: 'metric_card', title: 'CPU', value: '1' }] as never,
      positions: { 0: { x: 0, y: 0, w: 1, h: 3 } },
    };

    const { getByText, queryByTitle, container } = renderPreview();

    expect(getByText('Production overview')).toBeTruthy();
    expect(container.querySelector('[data-preview-status="ready"]')?.className).toContain('openshiftpulse');
    expect(queryByTitle('Delete view')).toBeNull();
    expect(queryByTitle('Edit with AI')).toBeNull();
    expect(loadViews).not.toHaveBeenCalled();
    expect(useCustomViewStore.getState().views[0].id).toBe(PREVIEW_VIEW_ID);
  });

  it('says so when there is no draft to render', () => {
    const { container } = renderPreview();
    expect(container.querySelector('[data-preview-status="missing"]')).toBeTruthy();
  });
});
