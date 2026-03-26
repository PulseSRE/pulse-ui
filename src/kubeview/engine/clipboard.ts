import { useUIStore } from '@/kubeview/store/uiStore';

/**
 * Copy text to clipboard with toast feedback.
 * Shows a success toast on success, or an error toast on failure.
 */
export async function copyToClipboard(
  text: string,
  successMessage = 'Copied to clipboard',
): Promise<boolean> {
  const { addToast } = useUIStore.getState();
  try {
    await navigator.clipboard.writeText(text);
    addToast({ type: 'success', title: successMessage });
    return true;
  } catch {
    addToast({ type: 'error', title: 'Failed to copy to clipboard' });
    return false;
  }
}
