// @vitest-environment jsdom
/** "Try in chat" and "Enable scanner" were disabled "coming soon" buttons. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const askPulse = vi.fn();
vi.mock('../../../engine/askPulse', () => ({ askPulse: (...a: unknown[]) => askPulse(...a) }));

import { CapabilityDiscovery } from '../CapabilityDiscovery';

afterEach(() => { cleanup(); askPulse.mockReset(); localStorage.clear(); });

describe('CapabilityDiscovery', () => {
  it('Try in chat sends the recommendation prompt to Pulse AI', () => {
    render(<CapabilityDiscovery recommendations={[{ type: 'capability', title: 'Capacity planning', description: 'Ask about headroom', action: { kind: 'chat_prompt', prompt: 'How much headroom do my nodes have?' } }]} />);
    fireEvent.click(screen.getByRole('button', { name: /Try in chat/ }));
    expect(askPulse).toHaveBeenCalledWith('How much headroom do my nodes have?');
  });

  it('does not show an Enable scanner button that cannot work', () => {
    render(<CapabilityDiscovery recommendations={[{ type: 'scanner', title: 'Cert scanner', description: 'Watch certs', action: { kind: 'enable_scanner', scanner: 'certs' } }]} />);
    expect(screen.getByText('Cert scanner')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Enable scanner/ })).toBeNull();
  });
});
