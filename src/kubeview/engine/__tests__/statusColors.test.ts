import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { statusTone, statusClasses, statusHex, riskTone, podPhaseTone, podPhaseClasses, utilizationTone, isKnownStatus, TONE_CLASSES, type StatusTone } from '../statusColors';

describe('statusTone', () => {
  const cases: Array<[string, StatusTone]> = [
    ['critical', 'danger'], ['Error', 'danger'], ['failed', 'danger'], ['CrashLoopBackOff', 'danger'],
    ['ImagePullBackOff', 'danger'], ['False', 'danger'], ['Not Ready', 'danger'],
    ['warning', 'warning'], ['Warning', 'warning'], ['Paused', 'warning'], ['retrying', 'warning'],
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

describe('helpers for maps and graphs', () => {
  it('gives every tone a left-edge stripe in its own family', () => {
    expect(TONE_CLASSES.warning.edge).toBe('border-l-amber-500');
    expect(TONE_CLASSES.danger.edge).toBe('border-l-red-500');
    for (const t of Object.values(TONE_CLASSES)) expect(t.edge).toMatch(/^border-l-[a-z]+-\d{3}$/);
  });

  it('statusHex is the tone hex, so SVG and classes agree', () => {
    expect(statusHex('Succeeded')).toBe(TONE_CLASSES.success.hex);
    expect(statusHex('Pending')).toBe(TONE_CLASSES.progress.hex);
    expect(statusHex('CrashLoopBackOff')).toBe(TONE_CLASSES.danger.hex);
    expect(statusHex('whatever')).toBe(TONE_CLASSES.neutral.hex);
  });

  it('maps the four risk levels and nothing else', () => {
    expect(riskTone('critical')).toBe('danger');
    expect(riskTone('high')).toBe('terminating');
    expect(riskTone('Medium')).toBe('warning');
    expect(riskTone('low')).toBe('success');
    expect(riskTone(undefined)).toBe('neutral');
  });

  it('grades utilisation at 60% and 80% by default', () => {
    expect(utilizationTone(59)).toBe('success');
    expect(utilizationTone(60)).toBe('warning');
    expect(utilizationTone(80)).toBe('danger');
    expect(utilizationTone(10, { ok: 'progress' })).toBe('progress');
  });
});

describe('status maps that used to be private', () => {
  // Each of these kept its own status → colour map (yellow warning in the
  // Inbox, blue or indigo Succeeded on the node map and pod grid). They now
  // read engine/statusColors; the lint rule pulse/no-inline-status-colors
  // stops a new map, and this stops a file quietly dropping the shared one.
  const files = [
    'views/inbox/InboxItem.tsx',
    'views/inbox/InboxGroup.tsx',
    'views/compute/NodeHexMap.tsx',
    'components/topology/overlays/PodGrid.tsx',
    'views/mission-control/ScannerDrawer.tsx',
    'views/argocd/RolloutsTab.tsx',
    'components/topology/GraphRenderer.tsx',
    'components/agent/AgentBlastRadius.tsx',
  ];
  it.each(['components/topology/overlays/PodGrid.tsx', 'engine/enhancers/pods.tsx'])('%s colours pods with podPhaseTone', (file) => {
    const src = readFileSync(resolve(__dirname, '..', '..', file), 'utf8');
    expect(src).toMatch(/podPhase(Tone|Classes)\(/);
  });

  it.each(files)('%s uses engine/statusColors and no yellow', (file) => {
    const src = readFileSync(resolve(__dirname, '..', '..', file), 'utf8');
    expect(src).toMatch(/from '(\.\.\/)+engine\/statusColors'/);
    expect(src).not.toMatch(/yellow-\d|#eab308/i);
  });
});

describe('podPhaseTone', () => {
  it('reads a Pending pod as warning, not progress', () => {
    expect(podPhaseTone('Pending')).toBe('warning');
    expect(statusTone('Pending')).toBe('progress'); // the generic word stays progress (rollouts, syncs)
  });

  it('reads normal start-up as progress', () => {
    expect(podPhaseTone('Pending', { reason: 'ContainerCreating' })).toBe('progress');
    expect(podPhaseTone('Pending', { reason: 'PodInitializing' })).toBe('progress');
    expect(podPhaseTone('ContainerCreating')).toBe('progress');
  });

  it('reads crash, pull and config errors as danger, even while Pending', () => {
    for (const reason of ['CrashLoopBackOff', 'ImagePullBackOff', 'ErrImagePull', 'CreateContainerConfigError', 'OOMKilled', 'Evicted']) {
      expect(podPhaseTone('Pending', { reason })).toBe('danger');
      expect(podPhaseTone('Running', { reason })).toBe('danger');
    }
    expect(podPhaseTone('CrashLoopBackOff')).toBe('danger');
  });

  it('maps the phases', () => {
    expect(podPhaseTone('Running')).toBe('success');
    expect(podPhaseTone('Running', { ready: false })).toBe('warning');
    expect(podPhaseTone('Running', { ready: true })).toBe('success');
    expect(podPhaseTone('Failed')).toBe('danger');
    expect(podPhaseTone('Unknown')).toBe('neutral');
    expect(podPhaseTone('Terminating')).toBe('terminating');
    expect(podPhaseTone(undefined)).toBe('neutral');
  });

  it('lets a density grid show Succeeded as neutral, apart from Running', () => {
    expect(podPhaseTone('Succeeded')).toBe('success');
    expect(podPhaseTone('Succeeded', { completed: 'neutral' })).toBe('neutral');
    expect(podPhaseClasses('Succeeded', { completed: 'neutral' }).hex).not.toBe(podPhaseClasses('Running').hex);
  });

  it('Pending is amber in every pod view', () => {
    expect(podPhaseClasses('Pending').solid).toBe('bg-amber-500');
    expect(podPhaseClasses('Pending').hex).toBe(TONE_CLASSES.warning.hex);
  });
});

describe('low: severity vs risk', () => {
  it('a low severity is info; a low risk is success', () => {
    expect(statusTone('low')).toBe('info');
    expect(riskTone('low')).toBe('success');
  });
});
