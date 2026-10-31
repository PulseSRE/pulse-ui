// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { useRef, useState } from 'react';
import { Dialog } from '../Dialog';
import { DrawerShell } from '../DrawerShell';
import { ConfirmDialog } from '../../feedback/ConfirmDialog';

function Harness({ dismissible = true, onClose = vi.fn() }: { dismissible?: boolean; onClose?: () => void }) {
  const [open, setOpen] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <>
      <button onClick={() => setOpen(true)}>Open</button>
      <Dialog
        open={open}
        onClose={() => { onClose(); setOpen(false); }}
        title="Rename"
        description="Pick a new name"
        initialFocusRef={nameRef}
        dismissible={dismissible}
        footer={<button>Save</button>}
      >
        <input ref={nameRef} aria-label="Name" />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  afterEach(cleanup);

  it('is a labelled, described modal that focuses the initial element', () => {
    render(<Harness />);
    fireEvent.click(screen.getByText('Open'));
    const dialog = screen.getByRole('dialog', { name: 'Rename' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe('Pick a new name');
    expect(document.activeElement).toBe(screen.getByLabelText('Name'));
  });

  it('traps Tab inside and returns focus to the opener on Escape', () => {
    render(<Harness />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    const save = screen.getByText('Save');
    save.focus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(save);

    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('closes on a backdrop press but not on a press inside', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.mouseDown(screen.getByLabelText('Name'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while not dismissible', () => {
    const onClose = vi.fn();
    render(<Harness dismissible={false} onClose={onClose} />);
    fireEvent.click(screen.getByText('Open'));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByRole('dialog').parentElement!);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });
});

describe('ConfirmDialog', () => {
  afterEach(cleanup);

  it('focuses Cancel for a danger confirmation and confirms on click', () => {
    const onConfirm = vi.fn();
    render(<ConfirmDialog open onClose={vi.fn()} onConfirm={onConfirm} title="Delete pod?" description="It is gone for good." />);
    expect(screen.getByRole('dialog', { name: 'Delete pod?' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape while loading', () => {
    const onClose = vi.fn();
    render(<ConfirmDialog open loading onClose={onClose} onConfirm={vi.fn()} title="Delete pod?" description="x" />);
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('focus trap reaches more than buttons', () => {
  afterEach(cleanup);

  function RiskConfirm({ onConfirm }: { onConfirm: () => void }) {
    const [accepted, setAccepted] = useState(false);
    return (
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirm={onConfirm}
        title="Update cluster?"
        description="This update has known risks."
        confirmLabel="Update"
        variant="warning"
        confirmDisabled={!accepted}
      >
        <label>
          <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} />
          I accept these risks
        </label>
        <a href="/docs/risks">Read the risks</a>
        <button hidden>Hidden action</button>
        <div style={{ display: 'none' }}><button>Collapsed action</button></div>
      </ConfirmDialog>
    );
  }

  it('Tabs to the checkbox when confirm is disabled, and ticking it enables confirm', () => {
    const onConfirm = vi.fn();
    render(<RiskConfirm onConfirm={onConfirm} />);
    const update = screen.getByRole('button', { name: 'Update' }) as HTMLButtonElement;
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    const box = screen.getByRole('checkbox', { name: 'I accept these risks' });
    const link = screen.getByRole('link', { name: 'Read the risks' });
    expect(update.disabled).toBe(true);

    // Disabled confirm: the first focusable is the checkbox; Cancel is last.
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Tab' });
    expect(document.activeElement).toBe(box);
    fireEvent.keyDown(box, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(cancel);

    // Hidden and display:none buttons are skipped; the link is reachable.
    link.focus();
    expect(document.activeElement).toBe(link);

    fireEvent.click(box);
    expect(update.disabled).toBe(false);
    fireEvent.click(update);
    expect(onConfirm).toHaveBeenCalledTimes(1);

    // Now enabled, confirm is the last stop and wraps to the checkbox.
    update.focus();
    fireEvent.keyDown(update, { key: 'Tab' });
    expect(document.activeElement).toBe(box);
  });
});

describe('DrawerShell', () => {
  afterEach(cleanup);

  it('is a modal dialog that closes on Escape and the close button', () => {
    const onClose = vi.fn();
    render(<DrawerShell title="Tool: get_pods" onClose={onClose} actions={<button>Run</button>}>body</DrawerShell>);
    expect(screen.getByRole('dialog', { name: 'Tool: get_pods' }).getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('lets Escape close only the innermost modal', () => {
    const closeDrawer = vi.fn();
    const closeConfirm = vi.fn();
    render(
      <DrawerShell title="Skill" onClose={closeDrawer}>
        <ConfirmDialog open onClose={closeConfirm} onConfirm={vi.fn()} title="Delete skill?" description="x" />
      </DrawerShell>,
    );
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(closeConfirm).toHaveBeenCalledTimes(1);
    expect(closeDrawer).not.toHaveBeenCalled();
  });
});
