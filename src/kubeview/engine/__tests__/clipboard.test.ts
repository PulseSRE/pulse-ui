import { describe, it, expect, vi, beforeEach } from 'vitest';
import { copyToClipboard } from '../clipboard';
import { useUIStore } from '../../store/uiStore';

describe('copyToClipboard', () => {
  let addToast: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    addToast = vi.fn();
    vi.spyOn(useUIStore, 'getState').mockReturnValue({
      ...useUIStore.getState(),
      addToast,
    });
  });

  it('copies text and shows success toast', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    const result = await copyToClipboard('hello', 'Copied!');

    expect(result).toBe(true);
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('hello');
    expect(addToast).toHaveBeenCalledWith({ type: 'success', title: 'Copied!' });
  });

  it('uses default success message', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) },
    });

    await copyToClipboard('text');

    expect(addToast).toHaveBeenCalledWith({ type: 'success', title: 'Copied to clipboard' });
  });

  it('shows error toast when clipboard fails', async () => {
    Object.assign(navigator, {
      clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
    });

    const result = await copyToClipboard('secret');

    expect(result).toBe(false);
    expect(addToast).toHaveBeenCalledWith({ type: 'error', title: 'Failed to copy to clipboard' });
  });
});
