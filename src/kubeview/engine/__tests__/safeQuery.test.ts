// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { safeQuery, checkAuth, agentFetch } from '../safeQuery';

// Mock uiStore
const mockAddDegradedReason = vi.fn();
const mockRemoveDegradedReason = vi.fn();
vi.mock('../../store/uiStore', () => ({
  useUIStore: {
    getState: () => ({
      addDegradedReason: mockAddDegradedReason,
      removeDegradedReason: mockRemoveDegradedReason,
    }),
  },
}));

// Mock fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('checkAuth', () => {
  it('flags session_expired on 401 response', () => {
    checkAuth({ status: 401 } as Response);
    expect(mockAddDegradedReason).toHaveBeenCalledWith('session_expired');
  });

  it('does not flag on 200 response', () => {
    checkAuth({ status: 200 } as Response);
    expect(mockAddDegradedReason).not.toHaveBeenCalled();
  });

  it('does not flag on 403 response', () => {
    checkAuth({ status: 403 } as Response);
    expect(mockAddDegradedReason).not.toHaveBeenCalled();
  });

  it('returns the response passthrough', () => {
    const res = { status: 200 } as Response;
    expect(checkAuth(res)).toBe(res);
  });
});

describe('agentFetch', () => {
  it('calls fetch and checks auth', async () => {
    mockFetch.mockResolvedValue({ status: 200, ok: true });
    const res = await agentFetch('/api/agent/skills');
    expect(mockFetch).toHaveBeenCalledWith('/api/agent/skills', undefined);
    expect(res.status).toBe(200);
    expect(mockAddDegradedReason).not.toHaveBeenCalled();
  });

  it('detects 401 and flags session expired', async () => {
    mockFetch.mockResolvedValue({ status: 401, ok: false });
    const res = await agentFetch('/api/agent/skills');
    expect(res.status).toBe(401);
    expect(mockAddDegradedReason).toHaveBeenCalledWith('session_expired');
  });

  it('passes init options to fetch', async () => {
    mockFetch.mockResolvedValue({ status: 200, ok: true });
    await agentFetch('/api/agent/admin/reload', { method: 'POST' });
    expect(mockFetch).toHaveBeenCalledWith('/api/agent/admin/reload', { method: 'POST' });
  });
});

describe('safeQuery', () => {
  it('returns result on success', async () => {
    const result = await safeQuery(() => Promise.resolve({ data: 'ok' }));
    expect(result).toEqual({ data: 'ok' });
  });

  it('returns null on 404', async () => {
    const result = await safeQuery(() => Promise.reject({ status: 404 }));
    expect(result).toBeNull();
  });

  it('flags session expired on 401 error', async () => {
    await expect(
      safeQuery(() => Promise.reject({ status: 401 })),
    ).rejects.toEqual({ status: 401 });
    expect(mockAddDegradedReason).toHaveBeenCalledWith('session_expired');
  });

  it('rethrows non-404 errors', async () => {
    await expect(
      safeQuery(() => Promise.reject({ status: 500 })),
    ).rejects.toEqual({ status: 500 });
  });
});
