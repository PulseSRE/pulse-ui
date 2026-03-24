import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createGitProvider, type GitOpsConfig } from '../gitProvider';

const mockFetch = vi.fn();
global.fetch = mockFetch;

const githubConfig: GitOpsConfig = {
  provider: 'github',
  repoUrl: 'https://github.com/myorg/gitops-repo',
  baseBranch: 'main',
  token: 'ghp_testtoken123',
};

const gitlabConfig: GitOpsConfig = {
  provider: 'gitlab',
  repoUrl: 'https://gitlab.com/myorg/gitops-repo',
  baseBranch: 'main',
  token: 'glpat-testtoken123',
};

describe('createGitProvider', () => {
  it('returns a GitHub provider for github config', () => {
    const provider = createGitProvider(githubConfig);
    expect(provider).toBeDefined();
    expect(provider.createBranch).toBeTypeOf('function');
    expect(provider.createPullRequest).toBeTypeOf('function');
  });

  it('returns a GitLab provider for gitlab config', () => {
    const provider = createGitProvider(gitlabConfig);
    expect(provider).toBeDefined();
  });

  it('returns a Bitbucket provider for bitbucket config', () => {
    const provider = createGitProvider({ ...githubConfig, provider: 'bitbucket' });
    expect(provider).toBeDefined();
  });

  it('throws for unsupported provider', () => {
    expect(() => createGitProvider({ ...githubConfig, provider: 'svn' as any })).toThrow('Unsupported');
  });
});

describe('GitHubProvider', () => {
  let provider: ReturnType<typeof createGitProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createGitProvider(githubConfig);
  });

  it('createBranch calls correct GitHub API endpoints', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ object: { sha: 'abc123' } }) }) // get ref
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }); // create ref

    await provider.createBranch('main', 'pulse/fix-123');

    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(mockFetch.mock.calls[0][0]).toContain('/git/ref/heads/main');
    expect(mockFetch.mock.calls[1][0]).toContain('/git/refs');
    const body = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(body.ref).toBe('refs/heads/pulse/fix-123');
    expect(body.sha).toBe('abc123');
  });

  it('getFileContent returns null for 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await provider.getFileContent('main', 'apps/deploy.yaml');
    expect(result).toBeNull();
  });

  it('getFileContent decodes base64 content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ content: btoa('apiVersion: apps/v1'), sha: 'file-sha-123' }),
    });

    const result = await provider.getFileContent('main', 'apps/deploy.yaml');
    expect(result?.content).toBe('apiVersion: apps/v1');
    expect(result?.sha).toBe('file-sha-123');
  });

  it('createPullRequest returns PR URL and number', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ html_url: 'https://github.com/myorg/repo/pull/42', number: 42 }),
    });

    const result = await provider.createPullRequest('Fix scaling', 'Updated replicas', 'pulse/fix', 'main');
    expect(result.url).toBe('https://github.com/myorg/repo/pull/42');
    expect(result.number).toBe(42);
  });

  it('createPullRequest throws on auth failure', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ message: 'Bad credentials' }),
    });

    await expect(provider.createPullRequest('Fix', 'Body', 'branch', 'main')).rejects.toThrow('401');
  });
});

describe('GitLabProvider', () => {
  let provider: ReturnType<typeof createGitProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createGitProvider(gitlabConfig);
  });

  it('createBranch calls GitLab API', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await provider.createBranch('main', 'pulse/fix-123');

    expect(mockFetch.mock.calls[0][0]).toContain('/repository/branches');
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.branch).toBe('pulse/fix-123');
    expect(body.ref).toBe('main');
  });

  it('createPullRequest creates merge request', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ web_url: 'https://gitlab.com/myorg/repo/-/merge_requests/5', iid: 5 }),
    });

    const result = await provider.createPullRequest('Fix', 'Body', 'pulse/fix', 'main');
    expect(result.url).toContain('merge_requests');
    expect(result.number).toBe(5);
  });

  it('uses PRIVATE-TOKEN header', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    await provider.createBranch('main', 'test');

    expect(mockFetch.mock.calls[0][1].headers['PRIVATE-TOKEN']).toBe('glpat-testtoken123');
  });
});
