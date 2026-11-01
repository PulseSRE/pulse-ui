// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { ConfirmDialog } from '../ConfirmDialog';

afterEach(cleanup);

describe('ConfirmDialog focus trap', () => {
  it('Tab reaches a required checkbox while confirm is disabled', () => {
    render(
      <ConfirmDialog open onClose={vi.fn()} onConfirm={vi.fn()} title="Accept risks?" description="" confirmLabel="Accept" confirmDisabled>
        <a href="https://issues.redhat.com/browse/OCPBUGS-1">Risk details</a>
        <label><input type="checkbox" /> I accept</label>
      </ConfirmDialog>,
    );
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    // Cancel is the last focusable control (Accept is disabled); Tab wraps to the first, the risk link.
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('link', { name: 'Risk details' }));
    // Shift+Tab from the first wraps back to Cancel; the checkbox is in the cycle too.
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);
    const focusables = Array.from(screen.getByRole('dialog').querySelectorAll('button:not([disabled]), input:not([disabled]), a[href]'));
    expect(focusables).toContain(screen.getByRole('checkbox'));
  });
});
