// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { HealthAuditPanel } from '../HealthAuditPanel';
import type { AuditCheck } from '../types';

const check = (id: string, failing: number, informational = false): AuditCheck => ({
  id, title: id, description: '', why: '', yamlExample: '', informational,
  passing: [{ name: 'ok' }], failing: Array.from({ length: failing }, (_, i) => ({ name: `f${i}` })),
});

afterEach(cleanup);

describe('informational audit checks', () => {
  it('are shown as advice and never lower the score', () => {
    render(<HealthAuditPanel title="Storage" checks={[check('binding', 0), check('reclaim', 3, true)]} />);
    expect(screen.getByText('100%')).toBeDefined();
    expect(screen.getByText('1/1 passing')).toBeDefined();
    expect(screen.getByText('Informational')).toBeDefined();
    expect(screen.queryByText(/need attention/)).toBeNull();
  });

  it('a real failure still counts', () => {
    render(<HealthAuditPanel title="Storage" checks={[check('binding', 2), check('reclaim', 3, true)]} />);
    expect(screen.getByText('0%')).toBeDefined();
    expect(screen.getByText('2 of 3 need attention')).toBeDefined();
  });
});
