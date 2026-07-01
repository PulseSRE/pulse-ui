// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { describeToolAction, riskLevel, RichContent } from '../MessageBubble';

const HTML_CONTENT = '<!DOCTYPE html><html><body>Generated dashboard</body></html>';
const PLAIN_CONTENT = 'Just a plain text response.';

describe('RichContent', () => {
  // Regression: RichContent used to call useState() after an early return
  // (when content contains an embedded HTML document), violating the Rules
  // of Hooks. Switching a single instance between HTML and plain content
  // across renders would then throw "Rendered fewer/more hooks than
  // expected" in React. All hooks must now be called unconditionally.

  it('renders HTML content without throwing', () => {
    expect(() => render(<RichContent content={HTML_CONTENT} />)).not.toThrow();
  });

  it('renders plain content without throwing', () => {
    expect(() => render(<RichContent content={PLAIN_CONTENT} />)).not.toThrow();
  });

  it('does not violate Rules of Hooks when re-rendering from HTML to plain content', () => {
    const { rerender } = render(<RichContent content={HTML_CONTENT} />);
    expect(() => rerender(<RichContent content={PLAIN_CONTENT} />)).not.toThrow();
  });

  it('does not violate Rules of Hooks when re-rendering from plain to HTML content', () => {
    const { rerender } = render(<RichContent content={PLAIN_CONTENT} />);
    expect(() => rerender(<RichContent content={HTML_CONTENT} />)).not.toThrow();
  });
});

describe('describeToolAction', () => {
  it('returns correct text for scale_deployment', () => {
    const result = describeToolAction('scale_deployment', {
      namespace: 'prod',
      name: 'api',
      replicas: 5,
    });
    expect(result).toBe('Scale deployment prod/api to 5 replicas');
  });

  it('returns correct text for delete_pod', () => {
    const result = describeToolAction('delete_pod', {
      namespace: 'default',
      pod_name: 'web-abc123',
    });
    expect(result).toBe('Delete pod default/web-abc123 (grace period: 30s)');
  });

  it('returns fallback for unknown tool', () => {
    const result = describeToolAction('custom_tool', {});
    expect(result).toBe('Execute custom_tool');
  });
});

describe('riskLevel', () => {
  it('returns MEDIUM for scale_deployment with replicas > 0', () => {
    const result = riskLevel('scale_deployment', { replicas: 3 });
    expect(result.level).toBe('MEDIUM');
    expect(result.color).toBe('text-amber-400');
  });

  it('returns HIGH for scale_deployment with replicas = 0', () => {
    const result = riskLevel('scale_deployment', { replicas: 0 });
    expect(result.level).toBe('HIGH');
    expect(result.color).toBe('text-red-400');
  });

  it('returns HIGH for drain_node', () => {
    const result = riskLevel('drain_node', { node_name: 'node-1' });
    expect(result.level).toBe('HIGH');
    expect(result.color).toBe('text-red-400');
  });

  it('returns MEDIUM for delete_pod', () => {
    const result = riskLevel('delete_pod', { namespace: 'default', pod_name: 'x' });
    expect(result.level).toBe('MEDIUM');
    expect(result.color).toBe('text-amber-400');
  });
});
