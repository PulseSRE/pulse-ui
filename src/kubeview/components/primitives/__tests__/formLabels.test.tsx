// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeAll, afterAll, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { FormField } from '../../../views/create/FormField';
import { SearchInput } from '../SearchInput';
import { RelativeTime } from '../RelativeTime';

const ORIGINAL_TZ = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { if (ORIGINAL_TZ === undefined) delete process.env.TZ; else process.env.TZ = ORIGINAL_TZ; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('FormField', () => {
  it('ties each label to its own input', () => {
    const onName = vi.fn();
    render(
      <>
        <FormField label="Name" required value="" onChange={onName} />
        <FormField label="Image" value="quay.io/org/api" onChange={() => {}} />
      </>,
    );
    const name = screen.getByLabelText(/^Name/);
    const image = screen.getByLabelText('Image');
    expect(name).not.toBe(image);
    expect(name.id).toBeTruthy();
    expect(name.id).not.toBe(image.id);
    expect(screen.getByText('Name').closest('label')?.getAttribute('for')).toBe(name.id);
    expect((name as HTMLInputElement).required).toBe(true);
    expect((image as HTMLInputElement).value).toBe('quay.io/org/api');
    fireEvent.change(name, { target: { value: 'api' } });
    expect(onName).toHaveBeenCalledWith('api');
  });
});

describe('SearchInput', () => {
  it('is named by its label, not its placeholder', () => {
    render(<SearchInput label="Search views" placeholder="Type…" value="" onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Search views' })).toBeTruthy();
  });
});

describe('RelativeTime', () => {
  it('says how long ago, with the full timestamp on hover', () => {
    vi.useFakeTimers();
    vi.setSystemTime(Date.parse('2026-10-30T14:10:09Z'));
    render(<RelativeTime value="2026-10-30T14:05:09Z" />);
    const el = screen.getByText('5m ago');
    expect(el.tagName).toBe('TIME');
    expect(el.getAttribute('title')).toBe('Oct 30, 2026, 2:05:09 PM');
    expect(el.getAttribute('datetime')).toBe('2026-10-30T14:05:09.000Z');
  });

  it('shows the fallback when there is no time', () => {
    render(<RelativeTime value={undefined} fallback="never" />);
    expect(screen.getByText('never').tagName).toBe('SPAN');
  });
});
