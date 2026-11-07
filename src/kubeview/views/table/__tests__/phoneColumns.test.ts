import { describe, it, expect } from 'vitest';
import { phoneHiddenColumns } from '../columnTemplate';

const ids = (...xs: string[]) => xs.map((id) => ({ id }));

describe('phoneHiddenColumns', () => {
  it('keeps name, status and age; hides the rest', () => {
    const hidden = phoneHiddenColumns(ids('name', 'namespace', 'status', 'ready', 'restarts', 'node', 'age'));
    expect([...hidden].sort()).toEqual(['namespace', 'node', 'ready', 'restarts']);
  });

  it('keeps readiness for a kind with no status column', () => {
    const hidden = phoneHiddenColumns(ids('name', 'namespace', 'ready', 'image', 'age'));
    expect([...hidden].sort()).toEqual(['image', 'namespace']);
  });

  it('hides nothing a list does not have', () => {
    expect(phoneHiddenColumns(ids('name', 'age')).size).toBe(0);
  });
});

describe('buildColumnTemplate at phone width', () => {
  it('lowers only the Name floor', async () => {
    const { buildColumnTemplate, FLEX_PERCENT_MIN_PX, PHONE_FLEX_PERCENT_MIN_PX } = await import('../columnTemplate');
    const cols = [{ width: '25%', header: 'Name' }, { width: '150px', header: 'Status' }];
    const desktop = buildColumnTemplate(cols, 100);
    const phone = buildColumnTemplate(cols, 100, { flexPercentMinPx: PHONE_FLEX_PERCENT_MIN_PX });
    expect(desktop.template).toContain(`minmax(${FLEX_PERCENT_MIN_PX}px, 2fr)`);
    expect(phone.template).toContain(`minmax(${PHONE_FLEX_PERCENT_MIN_PX}px, 2fr)`);
    expect(desktop.minWidth - phone.minWidth).toBe(FLEX_PERCENT_MIN_PX - PHONE_FLEX_PERCENT_MIN_PX);
  });
});
