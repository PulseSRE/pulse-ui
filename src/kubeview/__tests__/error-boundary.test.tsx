/**
 * Tests for ErrorBoundary contextual error messages.
 *
 * Verifies error categorization (network vs render) and contextual
 * recovery suggestions including fallbackTitle support.
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';

// Suppress console.error from ErrorBoundary.componentDidCatch
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function ThrowingChild({ error }: { error: Error }) {
  throw error;
}

describe('ErrorBoundary contextual error messages', () => {
  it('shows network suggestion for Failed to fetch TypeError', () => {
    const networkError = new TypeError('Failed to fetch');
    render(
      <ErrorBoundary>
        <ThrowingChild error={networkError} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Network error')).toBeTruthy();
    expect(screen.getByText(/oc proxy/)).toBeTruthy();
  });

  it('shows network suggestion for NetworkError', () => {
    const networkError = new TypeError('NetworkError when attempting to fetch resource');
    render(
      <ErrorBoundary>
        <ThrowingChild error={networkError} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Network error')).toBeTruthy();
  });

  it('shows render error for generic errors', () => {
    const genericError = new Error('Cannot read properties of undefined');
    render(
      <ErrorBoundary>
        <ThrowingChild error={genericError} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Render error')).toBeTruthy();
    expect(screen.getByText(/unexpected error occurred/)).toBeTruthy();
  });

  it('displays fallbackTitle prominently', () => {
    const error = new Error('some crash');
    render(
      <ErrorBoundary fallbackTitle="Workloads view failed">
        <ThrowingChild error={error} />
      </ErrorBoundary>
    );
    const title = screen.getByText('Workloads view failed');
    expect(title.tagName).toBe('H2');
    expect(title.className).toContain('font-bold');
  });

  it('shows default title when fallbackTitle is not provided', () => {
    const error = new Error('oops');
    render(
      <ErrorBoundary>
        <ThrowingChild error={error} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Something went wrong')).toBeTruthy();
  });

  it('renders children normally when no error', () => {
    render(
      <ErrorBoundary>
        <div data-testid="child">Hello</div>
      </ErrorBoundary>
    );
    expect(screen.getByTestId('child')).toBeTruthy();
  });

  it('shows chunk error UI for ChunkLoadError', () => {
    const chunkError = new Error('Loading chunk 123 failed');
    render(
      <ErrorBoundary>
        <ThrowingChild error={chunkError} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Page update available')).toBeTruthy();
    expect(screen.getByText('Reload Page')).toBeTruthy();
  });

  it('keeps Try Again, Ask Pulse, and Go Home buttons for non-chunk errors', () => {
    const error = new Error('render crash');
    render(
      <ErrorBoundary>
        <ThrowingChild error={error} />
      </ErrorBoundary>
    );
    expect(screen.getByText('Try Again')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask Pulse' })).toBeTruthy();
    expect(screen.getByText('Go Home')).toBeTruthy();
  });
});
