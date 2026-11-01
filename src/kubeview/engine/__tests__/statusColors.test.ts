import { describe, it, expect } from 'vitest';
import { statusTone, statusClasses, isKnownStatus, TONE_CLASSES, type StatusTone } from '../statusColors';

describe('statusTone', () => {
  const cases: Array<[string, StatusTone]> = [
    ['critical', 'danger'], ['Error', 'danger'], ['failed', 'danger'], ['CrashLoopBackOff', 'danger'],
    ['ImagePullBackOff', 'danger'], ['False', 'danger'], ['Not Ready', 'danger'],
    ['warning', 'warning'], ['Warning', 'warning'],
    ['pending', 'progress'], ['Progressing', 'progress'], ['ContainerCreating', 'progress'],
    ['healthy', 'success'], ['Running', 'success'], ['Succeeded', 'success'], ['success', 'success'], ['True', 'success'], ['Bound', 'success'],
    ['unknown', 'neutral'], ['not-compared', 'neutral'],
    ['info', 'info'],
    ['Terminating', 'terminating'],
  ];
  it.each(cases)('%s reads as %s', (status, tone) => {
    expect(statusTone(status)).toBe(tone);
  });

  it('treats unrecognised, empty and missing values as neutral', () => {
    expect(statusTone('banana')).toBe('neutral');
    expect(statusTone('')).toBe('neutral');
    expect(statusTone(undefined)).toBe('neutral');
    expect(statusTone(null)).toBe('neutral');
    expect(isKnownStatus('banana')).toBe(false);
    expect(isKnownStatus('Running')).toBe(true);
  });

  it('accepts booleans the way condition statuses arrive', () => {
    expect(statusTone(true)).toBe('success');
    expect(statusTone(false)).toBe('danger');
  });
});

describe('tone classes', () => {
  it('uses amber, not yellow, for warning everywhere', () => {
    const warning = TONE_CLASSES.warning;
    for (const cls of [warning.text, warning.bg, warning.border, warning.cardBorder, warning.solid, warning.chip, warning.accentBorder]) {
      expect(cls).toContain('amber');
      expect(cls).not.toContain('yellow');
    }
  });

  it('gives each tone its own colour family', () => {
    const families: Record<StatusTone, string> = {
      danger: 'red', warning: 'amber', progress: 'blue', success: 'emerald',
      neutral: 'slate', info: 'sky', terminating: 'orange',
    };
    for (const [tone, family] of Object.entries(families) as Array<[StatusTone, string]>) {
      expect(TONE_CLASSES[tone].text).toContain(`-${family}-`);
      expect(TONE_CLASSES[tone].chip).toContain(`text-${family}-`);
    }
  });

  it('pending and unknown no longer share warning colours', () => {
    expect(statusClasses('pending').text).toBe('text-blue-400');
    expect(statusClasses('unknown').text).toBe('text-slate-400');
    expect(statusClasses('warning').text).toBe('text-amber-400');
  });

  it('has a hex for every tone for SVG consumers', () => {
    for (const t of Object.values(TONE_CLASSES)) expect(t.hex).toMatch(/^#[0-9a-f]{6}$/);
  });
});
