// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../ErrorBoundary';

// Suppress console.error from ErrorBoundary's componentDidCatch
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// Component that throws on render
function ThrowingChild({ error }: { error: Error }) {
  throw error;
}

// Component that conditionally throws
function ConditionalThrow({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error('conditional error');
  return <div>child rendered ok</div>;
}

describe('ErrorBoundary', () => {
  it('renders children when no error', () => {
    render(
      <ErrorBoundary>
        <div>Hello World</div>
      </ErrorBoundary>,
    );
    expect(screen.getByText('Hello World')).toBeDefined();
  });

  it('shows fallback UI when child throws', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error('test crash')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();
    expect(screen.getByText('Render error')).toBeDefined();
    // Raw message is still visible in error details
    expect(screen.getByText(/test crash/)).toBeDefined();
  });

  it('shows custom fallbackTitle when provided', () => {
    render(
      <ErrorBoundary fallbackTitle="View crashed">
        <ThrowingChild error={new Error('oops')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('View crashed')).toBeDefined();
  });

  it('shows error details in expandable section', () => {
    const err = new Error('detailed failure');
    render(
      <ErrorBoundary>
        <ThrowingChild error={err} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Error details')).toBeDefined();
    // The error message appears in both the summary paragraph and the details pre
    const matches = screen.getAllByText(/detailed failure/);
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('shows Try Again button that resets error state', () => {
    // We need a component that can stop throwing after reset
    let shouldThrow = true;

    function MaybeThrow() {
      if (shouldThrow) throw new Error('first render crash');
      return <div>recovered</div>;
    }

    const { rerender } = render(
      <ErrorBoundary>
        <MaybeThrow />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Something went wrong')).toBeDefined();

    // Stop throwing, then click Try Again
    shouldThrow = false;
    fireEvent.click(screen.getByText('Try Again'));

    // After reset, children should re-render
    expect(screen.getByText('recovered')).toBeDefined();
  });

  it('shows Go Home button', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error('crash')} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Go Home')).toBeDefined();
  });

  it('"Go Home" goes to /pulse (there is no /welcome page)', () => {
    const original = window.location;
    const fake = { href: 'http://localhost/r/v1~pods' } as Location;
    Object.defineProperty(window, 'location', { value: fake, configurable: true, writable: true });
    try {
      render(
        <ErrorBoundary>
          <ThrowingChild error={new Error('crash')} />
        </ErrorBoundary>,
      );
      fireEvent.click(screen.getByText('Go Home'));
      expect(fake.href).toBe('/pulse');
    } finally {
      Object.defineProperty(window, 'location', { value: original, configurable: true, writable: true });
    }
  });

  it('shows chunk load error UI for ChunkLoadError', () => {
    const chunkError = new Error('Loading chunk 42 failed');
    chunkError.name = 'ChunkLoadError';

    render(
      <ErrorBoundary>
        <ThrowingChild error={chunkError} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Page update available')).toBeDefined();
    expect(screen.getByText('Reload Page')).toBeDefined();
    // Should NOT show the generic "Something went wrong"
    expect(screen.queryByText('Something went wrong')).toBeNull();
  });

  it('shows chunk error UI when message contains Loading chunk', () => {
    const chunkError = new Error('Loading chunk xyz failed');

    render(
      <ErrorBoundary>
        <ThrowingChild error={chunkError} />
      </ErrorBoundary>,
    );

    expect(screen.getByText('Page update available')).toBeDefined();
  });

  it('calls console.error via componentDidCatch', () => {
    render(
      <ErrorBoundary>
        <ThrowingChild error={new Error('logged error')} />
      </ErrorBoundary>,
    );

    expect(console.error).toHaveBeenCalled();
    const calls = vi.mocked(console.error).mock.calls;
    const boundaryCall = calls.find(
      (c) => typeof c[0] === 'string' && c[0].includes('ErrorBoundary caught'),
    );
    expect(boundaryCall).toBeDefined();
  });
});
