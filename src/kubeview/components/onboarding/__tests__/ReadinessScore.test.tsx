// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import React from 'react';

vi.mock('@/lib/utils', () => ({ cn: (...args: any[]) => args.filter(Boolean).join(' ') }));

import { ReadinessScore } from '../ReadinessScore';
import type { CategoryView } from '../types';

function makeCategoryView(overrides: Partial<CategoryView> = {}): CategoryView {
  return {
    id: overrides.id ?? 'prerequisites',
    label: overrides.label ?? 'Prerequisites',
    description: overrides.description ?? 'Cluster basics',
    gates: overrides.gates ?? [],
    results: overrides.results ?? {},
    summary: overrides.summary ?? { passed: 3, failed: 1, needs_attention: 0, not_started: 0, total: 4, score: 75 },
  };
}

describe('ReadinessScore', () => {
  afterEach(cleanup);

  it('renders the score value', () => {
    render(<ReadinessScore score={75} categories={[makeCategoryView()]} />);
    expect(screen.getByText('75')).toBeDefined();
    expect(screen.getByText('/ 100')).toBeDefined();
  });

  it('renders category labels and counts', () => {
    const categories = [
      makeCategoryView({ id: 'prerequisites', label: 'Prerequisites', summary: { passed: 3, failed: 1, needs_attention: 0, not_started: 0, total: 4, score: 75 } }),
      makeCategoryView({ id: 'security', label: 'Security', summary: { passed: 5, failed: 0, needs_attention: 0, not_started: 0, total: 5, score: 100 } }),
    ];
    render(<ReadinessScore score={80} categories={categories} />);
    expect(screen.getByText('Prerequisites')).toBeDefined();
    expect(screen.getByText('Security')).toBeDefined();
    expect(screen.getByText('3/4')).toBeDefined();
    expect(screen.getByText('5/5')).toBeDefined();
  });

  it('renders SVG circles for the gauge', () => {
    const { container } = render(<ReadinessScore score={50} categories={[makeCategoryView()]} />);
    const circles = container.querySelectorAll('circle');
    expect(circles.length).toBe(2); // background + progress
  });

  it('handles zero score', () => {
    render(<ReadinessScore score={0} categories={[makeCategoryView({ summary: { passed: 0, failed: 4, needs_attention: 0, not_started: 0, total: 4, score: 0 } })]} />);
    expect(screen.getByText('0')).toBeDefined();
  });

  it('handles 100 score', () => {
    render(<ReadinessScore score={100} categories={[makeCategoryView({ summary: { passed: 4, failed: 0, needs_attention: 0, not_started: 0, total: 4, score: 100 } })]} />);
    expect(screen.getByText('100')).toBeDefined();
  });

  it('renders empty when no categories', () => {
    render(<ReadinessScore score={0} categories={[]} />);
    expect(screen.getByText('0')).toBeDefined();
  });
});
