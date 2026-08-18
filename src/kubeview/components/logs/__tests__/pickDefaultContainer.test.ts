import { describe, it, expect } from 'vitest';
import { pickDefaultContainer } from '../pickDefaultContainer';

describe('pickDefaultContainer', () => {
  it('returns undefined for an empty list', () => {
    expect(pickDefaultContainer([])).toBeUndefined();
  });

  it('returns the only container when there is just one', () => {
    expect(pickDefaultContainer(['app'])).toBe('app');
  });

  it('skips a leading sidecar and picks the app container', () => {
    expect(pickDefaultContainer(['oauth-proxy', 'streamlit-app'])).toBe('streamlit-app');
  });

  it('skips a leading sidecar regardless of how many app containers follow', () => {
    expect(pickDefaultContainer(['istio-proxy', 'api', 'worker'])).toBe('api');
  });

  it('falls back to the first container if every container is a known sidecar', () => {
    expect(pickDefaultContainer(['oauth-proxy', 'istio-proxy'])).toBe('oauth-proxy');
  });

  it('ignores undefined/empty entries', () => {
    expect(pickDefaultContainer([undefined, 'app', undefined])).toBe('app');
  });

  it('picks the first non-sidecar container even when it is not first in the list', () => {
    expect(pickDefaultContainer(['vault-agent-init', 'vault-agent', 'main'])).toBe('main');
  });
});
