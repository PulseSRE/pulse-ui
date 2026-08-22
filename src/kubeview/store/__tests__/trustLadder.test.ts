import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TRUST_LABELS, TRUST_DESCRIPTIONS, TRUST_HINTS, type TrustLevel } from '../trustStore';

/**
 * The trust ladder described a different agent than the one that ships.
 *
 * Verified by running the agent's `auto_fix` at every level:
 *
 *   0  auto_fix not entered; write tool buttons blocked (max_trust_level < 1)
 *   1  auto_fix not entered — nothing is ever proposed
 *   2  auto_fix entered, every action saved as "proposed", nothing executed
 *   3  auto_fix entered, executes without a confirmation gate, category-filtered
 *   4  auto_fix entered, executes without a confirmation gate, unfiltered
 *
 * The labels said 1 was "Confirm — every action requires your explicit
 * approval" for a level that proposes nothing, and 2 was "Batch — low-risk
 * auto-approved" for the level that actually asks. An operator who wanted
 * supervised remediation picked 1 and got an agent that did nothing — the
 * `total_actions: 0` symptom, sitting in plain sight in the control's own name.
 */
describe('the trust ladder describes the agent that ships', () => {
  const levels: TrustLevel[] = [0, 1, 2, 3, 4];

  it('does not promise confirmation on a level that never proposes', () => {
    // Level 1 does not enter auto_fix, so nothing exists to approve. Any
    // label or description implying otherwise is the original bug.
    expect(TRUST_LABELS[1]).not.toMatch(/confirm/i);
    expect(TRUST_DESCRIPTIONS[1]).not.toMatch(/approv|confirm/i);
    expect(TRUST_HINTS[1]).not.toMatch(/approv|confirm/i);
  });

  it('names level 2 as the one that actually asks', () => {
    expect(TRUST_DESCRIPTIONS[2]).toMatch(/approv/i);
    expect(TRUST_LABELS[2]).toBe('Propose');
  });

  it('does not claim risk tiers that the fix path does not implement', () => {
    // `risk_level` exists only in LLM investigation output; auto_fix never
    // reads it. Promising "low-risk auto-approved" invents a guarantee.
    for (const l of levels) {
      expect(TRUST_DESCRIPTIONS[l], `level ${l}`).not.toMatch(/low[- ]risk|medium|high[- ]risk/i);
    }
  });

  it('describes what actually separates 3 from 4', () => {
    // 3 filters by category; 4 does not. That is the only difference.
    expect(TRUST_DESCRIPTIONS[3]).toMatch(/categor/i);
    expect(TRUST_DESCRIPTIONS[4]).not.toMatch(/categor/i);
  });

  it('keeps every level distinct', () => {
    // Two levels reading the same is how an operator picks the wrong one.
    expect(new Set(Object.values(TRUST_LABELS)).size).toBe(5);
    expect(new Set(Object.values(TRUST_DESCRIPTIONS)).size).toBe(5);
    expect(new Set(Object.values(TRUST_HINTS)).size).toBe(5);
  });

  it('gets more autonomous as the number rises, in the words too', () => {
    // 0 and 1 must not describe the agent acting on its own; 3 and 4 must.
    expect(TRUST_DESCRIPTIONS[0]).toMatch(/never acts|no actions/i);
    expect(TRUST_DESCRIPTIONS[1]).toMatch(/never remediates|does not/i);
    expect(TRUST_DESCRIPTIONS[3]).toMatch(/without asking/i);
    expect(TRUST_DESCRIPTIONS[4]).toMatch(/without asking/i);
  });

  it('is stated once, not restated per screen', () => {
    // PulseView kept its own array of level names. That is how the badge
    // tooltip and Mission Control came to describe different agents.
    const src = readFileSync(resolve(__dirname, '../../views/PulseView.tsx'), 'utf8');
    expect(src).toContain('TRUST_LABELS');
    expect(src).not.toMatch(/\[\s*0,\s*'Observe'/);
  });
});
