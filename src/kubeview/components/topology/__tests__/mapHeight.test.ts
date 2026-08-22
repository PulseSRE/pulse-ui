import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MAP_HEIGHT } from '../WorldMap';

/**
 * The map took most of the first screen, and then moved it.
 *
 * Two separate faults in the same few lines. WorldMap hardcoded a 520px
 * container — measured against the reference cluster on a 1440x900 desktop,
 * 57.8% of the viewport, which pushed Heartbeat, Healthy and the utilisation
 * metrics off the bottom. The front door led with a picture of seven nodes and
 * hid the numbers an operator opens it for.
 *
 * And PulseView's Suspense skeleton reserved `h-[420px]` for that 520px map,
 * so everything below jumped 100px the moment the lazy chunk landed.
 */
describe('the map is bounded, and the skeleton reserves what it will take', () => {
  const parse = (v: string) => {
    const m = v.match(/^clamp\((\d+)px,\s*(\d+)vh,\s*(\d+)px\)$/);
    if (!m) throw new Error(`MAP_HEIGHT is not a clamp: ${v}`);
    return { floor: +m[1], vh: +m[2], ceiling: +m[3] };
  };

  it('never takes more than half the viewport', () => {
    // The whole point: at any viewport height, the fraction is under 50%, so
    // the health readouts below it cannot be pushed off the fold again.
    expect(parse(MAP_HEIGHT).vh).toBeLessThan(50);
  });

  it('stays legible on a short screen', () => {
    // 42vh on a 600px laptop is 252px, which is not a usable map. The floor is
    // what stops the clamp from solving one problem by creating another.
    expect(parse(MAP_HEIGHT).floor).toBeGreaterThanOrEqual(280);
  });

  it('does not grow past what it used to be on a large display', () => {
    // Nothing about the roomy case should change — this was a fix for small
    // and medium screens, not licence to take more space on big ones.
    expect(parse(MAP_HEIGHT).ceiling).toBeLessThanOrEqual(520);
  });

  it('pins the value, so a change has to be deliberate', () => {
    expect(MAP_HEIGHT).toBe('clamp(280px, 42vh, 520px)');
  });

  it('the loading skeleton reserves exactly the map height', () => {
    // A literal here is how the 100px jump got in. The skeleton and the map
    // must read from one constant or they drift apart again silently.
    const src = readFileSync(resolve(__dirname, '../../../views/PulseView.tsx'), 'utf8');
    const fallback = src.match(/<Suspense fallback=\{[\s\S]*?\}>/);
    expect(fallback, 'PulseView should still lazy-load the map behind a Suspense fallback').toBeTruthy();
    expect(fallback![0]).toContain('MAP_HEIGHT');
    expect(fallback![0]).not.toMatch(/h-\[\d+px\]|height:\s*\d+/);
  });
});
