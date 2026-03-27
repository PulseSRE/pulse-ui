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

  it('commitMultipleFiles uses Git Trees API for atomic commit', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ object: { sha: 'ref-sha-1' } }) }) // get ref
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tree: { sha: 'base-tree-sha' } }) }) // get commit
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'blob-sha-1' }) }) // create blob 1
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'blob-sha-2' }) }) // create blob 2
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'new-tree-sha' }) }) // create tree
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ sha: 'new-commit-sha' }) }) // create commit
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) }); // update ref

    const files = [
      { path: 'apps/deploy.yaml', content: 'replicas: 3' },
      { path: 'apps/service.yaml', content: 'port: 8080' },
    ];

    await provider.commitMultipleFiles('pulse/fix', files, 'Update manifests');

    expect(mockFetch).toHaveBeenCalledTimes(7);

    // 1. Get ref
    expect(mockFetch.mock.calls[0][0]).toContain('/git/ref/heads/pulse/fix');

    // 2. Get commit to find base tree
    expect(mockFetch.mock.calls[1][0]).toContain('/git/commits/ref-sha-1');

    // 3-4. Create blobs
    expect(mockFetch.mock.calls[2][0]).toContain('/git/blobs');
    expect(mockFetch.mock.calls[3][0]).toContain('/git/blobs');

    // 5. Create tree
    expect(mockFetch.mock.calls[4][0]).toContain('/git/trees');
    const treeBody = JSON.parse(mockFetch.mock.calls[4][1].body);
    expect(treeBody.base_tree).toBe('base-tree-sha');
    expect(treeBody.tree).toHaveLength(2);

    // 6. Create commit
    expect(mockFetch.mock.calls[5][0]).toContain('/git/commits');

    // 7. Update ref
    expect(mockFetch.mock.calls[6][0]).toContain('/git/refs/heads/pulse/fix');
  });

  it('commitMultipleFiles throws when blob creation fails', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ object: { sha: 'ref-sha-1' } }) })
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({ tree: { sha: 'base-tree-sha' } }) })
      .mockResolvedValueOnce({ ok: false, status: 422 });

    await expect(
      provider.commitMultipleFiles('branch', [{ path: 'a.yaml', content: 'x' }], 'msg'),
    ).rejects.toThrow('Failed to create blob for a.yaml: 422');
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

  it('commitMultipleFiles uses Commits API with actions array', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) });

    const files = [
      { path: 'apps/deploy.yaml', content: 'replicas: 3' },
      { path: 'apps/service.yaml', content: 'port: 8080' },
    ];

    await provider.commitMultipleFiles('pulse/fix', files, 'Update manifests');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/repository/commits');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.branch).toBe('pulse/fix');
    expect(body.commit_message).toBe('Update manifests');
    expect(body.actions).toHaveLength(2);
    expect(body.actions[0]).toEqual({ action: 'create', file_path: 'apps/deploy.yaml', content: 'replicas: 3' });
    expect(body.actions[1]).toEqual({ action: 'create', file_path: 'apps/service.yaml', content: 'port: 8080' });
  });

  it('commitMultipleFiles throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400 });

    await expect(
      provider.commitMultipleFiles('branch', [{ path: 'a.yaml', content: 'x' }], 'msg'),
    ).rejects.toThrow('Failed to commit files: 400');
  });
});

describe('BitbucketProvider', () => {
  const bitbucketConfig: GitOpsConfig = {
    provider: 'bitbucket',
    repoUrl: 'https://bitbucket.org/myorg/gitops-repo',
    baseBranch: 'main',
    token: 'bb_testtoken123',
  };

  let provider: ReturnType<typeof createGitProvider>;

  beforeEach(() => {
    vi.clearAllMocks();
    provider = createGitProvider(bitbucketConfig);
  });

  it('commitMultipleFiles uses FormData with multiple file entries', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const files = [
      { path: 'apps/deploy.yaml', content: 'replicas: 3' },
      { path: 'apps/service.yaml', content: 'port: 8080' },
    ];

    await provider.commitMultipleFiles('pulse/fix', files, 'Update manifests');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][0]).toContain('/src');
    expect(mockFetch.mock.calls[0][1].method).toBe('POST');

    const formData = mockFetch.mock.calls[0][1].body as FormData;
    expect(formData.get('message')).toBe('Update manifests');
    expect(formData.get('branch')).toBe('pulse/fix');
    // FormData file entries are Blobs; verify both paths are present
    expect(formData.has('apps/deploy.yaml')).toBe(true);
    expect(formData.has('apps/service.yaml')).toBe(true);
  });

  it('commitMultipleFiles throws on failure', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 403 });

    await expect(
      provider.commitMultipleFiles('branch', [{ path: 'a.yaml', content: 'x' }], 'msg'),
    ).rejects.toThrow('Failed to commit files: 403');
  });
});
