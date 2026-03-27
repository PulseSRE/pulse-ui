/**
 * Git Provider Abstraction — creates branches, updates files, and creates PRs
 * across GitHub, GitLab, and Bitbucket via their REST APIs.
 */

export interface FileCommit {
  path: string;
  content: string;
}

export interface GitProvider {
  createBranch(baseBranch: string, newBranch: string): Promise<void>;
  getFileContent(branch: string, path: string): Promise<{ content: string; sha: string } | null>;
  createOrUpdateFile(branch: string, path: string, content: string, message: string, fileSha?: string): Promise<void>;
  commitMultipleFiles(branch: string, files: FileCommit[], message: string): Promise<void>;
  createPullRequest(title: string, body: string, head: string, base: string): Promise<{ url: string; number: number }>;
}

export interface GitOpsConfig {
  provider: 'github' | 'gitlab' | 'bitbucket';
  repoUrl: string;
  baseBranch: string;
  token: string;
  pathPrefix?: string;
}

function validateRepoUrl(repoUrl: string): void {
  let parsed: URL;
  try {
    parsed = new URL(repoUrl);
  } catch {
    throw new Error('Invalid repository URL');
  }

  if (parsed.protocol !== 'https:') {
    throw new Error('Repository URL must use https:// scheme');
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedPatterns = [
    '.local', '.internal', '.cluster',
    'localhost',
    '127.0.0.1',
    '10.',
    '192.168.',
  ];

  if (blockedPatterns.some(p => hostname.includes(p))) {
    throw new Error('Repository URL points to a blocked internal hostname');
  }

  // Check 172.16.0.0 – 172.31.255.255
  const ipMatch = hostname.match(/^(\d+)\.(\d+)\./);
  if (ipMatch && ipMatch[1] === '172') {
    const second = parseInt(ipMatch[2], 10);
    if (second >= 16 && second <= 31) {
      throw new Error('Repository URL points to a blocked internal hostname');
    }
  }
}

export function createGitProvider(config: GitOpsConfig): GitProvider {
  validateRepoUrl(config.repoUrl);

  switch (config.provider) {
    case 'github': return new GitHubProvider(config);
    case 'gitlab': return new GitLabProvider(config);
    case 'bitbucket': return new BitbucketProvider(config);
    default: throw new Error(`Unsupported Git provider: ${config.provider}`);
  }
}

/** Extract owner/repo from a repo URL */
function parseRepoSlug(repoUrl: string): { owner: string; repo: string } {
  const clean = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = clean.split('/');
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
}

// ── GitHub ──

class GitHubProvider implements GitProvider {
  private apiBase: string;
  private owner: string;
  private repo: string;
  private headers: Record<string, string>;

  constructor(config: GitOpsConfig) {
    const { owner, repo } = parseRepoSlug(config.repoUrl);
    this.owner = owner;
    this.repo = repo;
    this.apiBase = `https://api.github.com/repos/${owner}/${repo}`;
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
    };
  }

  async createBranch(baseBranch: string, newBranch: string): Promise<void> {
    // Get base branch SHA
    const refRes = await fetch(`${this.apiBase}/git/ref/heads/${baseBranch}`, { headers: this.headers });
    if (!refRes.ok) throw new Error(`Failed to get base branch: ${refRes.status}`);
    const refData = await refRes.json();
    const sha = refData.object.sha;

    // Create new branch
    const createRes = await fetch(`${this.apiBase}/git/refs`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha }),
    });
    if (!createRes.ok) throw new Error(`Failed to create branch: ${createRes.status}`);
  }

  async getFileContent(branch: string, path: string): Promise<{ content: string; sha: string } | null> {
    const res = await fetch(`${this.apiBase}/contents/${encodeURIComponent(path)}?ref=${branch}`, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get file: ${res.status}`);
    const data = await res.json();
    return { content: atob(data.content), sha: data.sha };
  }

  async createOrUpdateFile(branch: string, path: string, content: string, message: string, fileSha?: string): Promise<void> {
    const body: Record<string, unknown> = {
      message,
      content: btoa(content),
      branch,
    };
    if (fileSha) body.sha = fileSha;

    const res = await fetch(`${this.apiBase}/contents/${encodeURIComponent(path)}`, {
      method: 'PUT',
      headers: this.headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
  }

  async commitMultipleFiles(branch: string, files: FileCommit[], message: string): Promise<void> {
    // Create blobs first (these are content-addressed and don't depend on branch state)
    const tree = await Promise.all(files.map(async (f) => {
      const blobRes = await fetch(`${this.apiBase}/git/blobs`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
      });
      if (!blobRes.ok) {
        const errBody = await blobRes.json().catch(() => ({}));
        throw new Error(`Failed to create blob for ${f.path}: ${blobRes.status} ${errBody.message || ''}`);
      }
      const blobData = await blobRes.json();
      return { path: f.path, mode: '100644' as const, type: 'blob' as const, sha: blobData.sha };
    }));

    // Retry loop: read ref → create tree → create commit → update ref
    // Retries on 422 (ref moved due to eventual consistency)
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      // Get the latest commit SHA on the branch
      const refRes = await fetch(`${this.apiBase}/git/ref/heads/${branch}`, { headers: this.headers });
      if (!refRes.ok) throw new Error(`Failed to get branch ref: ${refRes.status}`);
      const refData = await refRes.json();
      const latestCommitSha = refData.object.sha;

      // Get the tree SHA of that commit
      const commitRes = await fetch(`${this.apiBase}/git/commits/${latestCommitSha}`, { headers: this.headers });
      if (!commitRes.ok) throw new Error(`Failed to get commit: ${commitRes.status}`);
      const commitData = await commitRes.json();
      const baseTreeSha = commitData.tree.sha;

      // Create a new tree
      const treeRes = await fetch(`${this.apiBase}/git/trees`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ base_tree: baseTreeSha, tree }),
      });
      if (!treeRes.ok) {
        const errBody = await treeRes.json().catch(() => ({}));
        throw new Error(`Failed to create tree: ${treeRes.status} ${errBody.message || ''}`);
      }
      const treeData = await treeRes.json();

      // Create the commit
      const newCommitRes = await fetch(`${this.apiBase}/git/commits`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ message, tree: treeData.sha, parents: [latestCommitSha] }),
      });
      if (!newCommitRes.ok) throw new Error(`Failed to create commit: ${newCommitRes.status}`);
      const newCommitData = await newCommitRes.json();

      // Update the branch ref
      const updateRes = await fetch(`${this.apiBase}/git/refs/heads/${branch}`, {
        method: 'PATCH',
        headers: this.headers,
        body: JSON.stringify({ sha: newCommitData.sha }),
      });

      if (updateRes.ok) return; // Success

      if (updateRes.status === 422 && attempt < MAX_RETRIES - 1) {
        // Ref moved — wait briefly then retry with fresh ref
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      throw new Error(`Failed to update branch ref: ${updateRes.status}`);
    }
  }

  async createPullRequest(title: string, body: string, head: string, base: string): Promise<{ url: string; number: number }> {
    const res = await fetch(`${this.apiBase}/pulls`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title, body, head, base }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Failed to create PR: ${res.status} ${err.message || ''}`);
    }
    const data = await res.json();
    return { url: data.html_url, number: data.number };
  }
}

// ── GitLab ──

class GitLabProvider implements GitProvider {
  private apiBase: string;
  private projectId: string;
  private headers: Record<string, string>;

  constructor(config: GitOpsConfig) {
    const url = new URL(config.repoUrl.replace(/\.git$/, ''));
    const projectPath = url.pathname.replace(/^\//, '');
    this.projectId = encodeURIComponent(projectPath);
    this.apiBase = `${url.origin}/api/v4/projects/${this.projectId}`;
    this.headers = {
      'PRIVATE-TOKEN': config.token,
      'Content-Type': 'application/json',
    };
  }

  async createBranch(baseBranch: string, newBranch: string): Promise<void> {
    const res = await fetch(`${this.apiBase}/repository/branches`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ branch: newBranch, ref: baseBranch }),
    });
    if (!res.ok) throw new Error(`Failed to create branch: ${res.status}`);
  }

  async getFileContent(branch: string, path: string): Promise<{ content: string; sha: string } | null> {
    const res = await fetch(`${this.apiBase}/repository/files/${encodeURIComponent(path)}?ref=${branch}`, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get file: ${res.status}`);
    const data = await res.json();
    return { content: atob(data.content), sha: data.blob_id };
  }

  async createOrUpdateFile(branch: string, path: string, content: string, message: string, fileSha?: string): Promise<void> {
    const method = fileSha ? 'PUT' : 'POST';
    const res = await fetch(`${this.apiBase}/repository/files/${encodeURIComponent(path)}`, {
      method,
      headers: this.headers,
      body: JSON.stringify({ branch, content, commit_message: message, encoding: 'text' }),
    });
    if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
  }

  async commitMultipleFiles(branch: string, files: FileCommit[], message: string): Promise<void> {
    const actions = files.map((f) => ({
      action: 'create' as const,
      file_path: f.path,
      content: f.content,
    }));
    const res = await fetch(`${this.apiBase}/repository/commits`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ branch, commit_message: message, actions }),
    });
    if (!res.ok) throw new Error(`Failed to commit files: ${res.status}`);
  }

  async createPullRequest(title: string, body: string, head: string, base: string): Promise<{ url: string; number: number }> {
    const res = await fetch(`${this.apiBase}/merge_requests`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ title, description: body, source_branch: head, target_branch: base }),
    });
    if (!res.ok) throw new Error(`Failed to create MR: ${res.status}`);
    const data = await res.json();
    return { url: data.web_url, number: data.iid };
  }
}

// ── Bitbucket ──

class BitbucketProvider implements GitProvider {
  private apiBase: string;
  private owner: string;
  private repo: string;
  private headers: Record<string, string>;

  constructor(config: GitOpsConfig) {
    const { owner, repo } = parseRepoSlug(config.repoUrl);
    this.owner = owner;
    this.repo = repo;
    this.apiBase = `https://api.bitbucket.org/2.0/repositories/${owner}/${repo}`;
    this.headers = {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    };
  }

  async createBranch(baseBranch: string, newBranch: string): Promise<void> {
    // Resolve branch name to commit hash
    const branchRes = await fetch(`${this.apiBase}/refs/branches/${baseBranch}`, { headers: this.headers });
    if (!branchRes.ok) throw new Error(`Failed to get base branch: ${branchRes.status}`);
    const branchData = await branchRes.json();
    const hash = branchData.target?.hash;
    if (!hash) throw new Error('Could not resolve base branch commit hash');

    const res = await fetch(`${this.apiBase}/refs/branches`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ name: newBranch, target: { hash } }),
    });
    if (!res.ok) throw new Error(`Failed to create branch: ${res.status}`);
  }

  async getFileContent(branch: string, path: string): Promise<{ content: string; sha: string } | null> {
    const res = await fetch(`${this.apiBase}/src/${branch}/${encodeURIComponent(path)}`, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Failed to get file: ${res.status}`);
    const content = await res.text();
    return { content, sha: '' };
  }

  async createOrUpdateFile(branch: string, path: string, content: string, message: string): Promise<void> {
    const formData = new FormData();
    formData.append(path, new Blob([content]));
    formData.append('message', message);
    formData.append('branch', branch);

    const res = await fetch(`${this.apiBase}/src`, {
      method: 'POST',
      headers: { Authorization: this.headers.Authorization },
      body: formData,
    });
    if (!res.ok) throw new Error(`Failed to update file: ${res.status}`);
  }

  async commitMultipleFiles(branch: string, files: FileCommit[], message: string): Promise<void> {
    const formData = new FormData();
    for (const f of files) {
      formData.append(f.path, new Blob([f.content]));
    }
    formData.append('message', message);
    formData.append('branch', branch);

    const res = await fetch(`${this.apiBase}/src`, {
      method: 'POST',
      headers: { Authorization: this.headers.Authorization },
      body: formData,
    });
    if (!res.ok) throw new Error(`Failed to commit files: ${res.status}`);
  }

  async createPullRequest(title: string, body: string, head: string, base: string): Promise<{ url: string; number: number }> {
    const res = await fetch(`${this.apiBase}/pullrequests`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({
        title,
        description: body,
        source: { branch: { name: head } },
        destination: { branch: { name: base } },
      }),
    });
    if (!res.ok) throw new Error(`Failed to create PR: ${res.status}`);
    const data = await res.json();
    return { url: data.links?.html?.href || '', number: data.id };
  }
}
