// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeverityBanner } from '../SeverityBanner';

/**
 * These assert the shape of the banner, not its colours, because shape is what
 * went wrong: the landing view stacked two alert banners built independently,
 * one with a full tinted border, a 5-unit icon, py-3 and a whole-banner click
 * target, the other with a left accent bar, a 4-unit icon, py-2 and an inline
 * underlined link. Two alerts about the same cluster, on the same screen,
 * looking like they came from two products.
 *
 * Colour is allowed to vary by severity — that is the point of severity. The
 * geometry is not.
 */
describe('SeverityBanner', () => {
  const geometry = ['rounded-lg', 'border', 'px-4', 'py-3', 'gap-3', 'items-start'];

  it('uses identical geometry at every severity', () => {
    const seen = new Set<string>();

    for (const level of ['unknown', 'green', 'yellow', 'red'] as const) {
      const { container, unmount } = render(<SeverityBanner level={level}>msg</SeverityBanner>);
      const root = container.firstElementChild as HTMLElement;
      for (const cls of geometry) {
        expect(root.className, `${level} must keep ${cls}`).toContain(cls);
      }
      // No severity may reintroduce the left-accent-bar model.
      expect(root.className, `${level} must not use a left accent bar`).not.toContain('border-l-4');
      seen.add(geometry.filter((c) => root.className.includes(c)).join(' '));
      unmount();
    }

    expect(seen.size, 'every severity must share one geometry').toBe(1);
  });

  it('uses the same geometry whether or not it has an action', () => {
    const { container: plain, unmount } = render(<SeverityBanner level="red">msg</SeverityBanner>);
    const plainCls = (plain.firstElementChild as HTMLElement).className;
    unmount();

    const { container: actioned } = render(
      <SeverityBanner level="red" action={{ label: 'Investigate', onClick: () => {} }}>
        msg
      </SeverityBanner>,
    );
    const actionedCls = (actioned.firstElementChild as HTMLElement).className;

    for (const cls of geometry) {
      expect(plainCls).toContain(cls);
      expect(actionedCls).toContain(cls);
    }
  });

  // The whole banner is the target, not a link buried in the sentence: an
  // underlined word inside a coloured strip reads as decoration.
  it('makes the entire banner the click target when an action is given', () => {
    const onClick = vi.fn();
    const { container } = render(
      <SeverityBanner level="red" action={{ label: 'Investigate', onClick }}>
        1 critical
      </SeverityBanner>,
    );

    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('BUTTON');
    // Never a form submit if the banner ends up inside a form.
    expect(root.getAttribute('type')).toBe('button');

    fireEvent.click(root);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is not a button when there is nothing to do', () => {
    const { container } = render(<SeverityBanner level="green">All clear</SeverityBanner>);
    expect((container.firstElementChild as HTMLElement).tagName).toBe('DIV');
  });

  it('renders eyebrow, headline and meta', () => {
    render(
      <SeverityBanner level="red" eyebrow="Open incident" meta={<span>running 3h</span>}>
        HighOverallControlPlaneMemory
      </SeverityBanner>,
    );

    expect(screen.getByText('Open incident')).toBeTruthy();
    expect(screen.getByText('HighOverallControlPlaneMemory')).toBeTruthy();
    expect(screen.getByText('running 3h')).toBeTruthy();
  });
});
