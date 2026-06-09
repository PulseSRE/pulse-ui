import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import type { IncomingMessage } from 'node:http';

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

interface ResolveOptions {
  lookup?: (hostname: string) => Promise<ResolvedAddress[]>;
}

interface FetchOptions extends ResolveOptions {
  timeoutMs?: number;
  maxBytes?: number;
  maxRedirects?: number;
}

export interface ResolvedHelmRepoUrl {
  url: URL;
  addresses: ResolvedAddress[];
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;
const DEFAULT_MAX_REDIRECTS = 3;

function normalizeHelmIndexUrl(repoUrl: string): URL {
  const parsed = new URL(repoUrl);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('URL must use http or https protocol');
  }
  if (parsed.username || parsed.password) {
    throw new Error('Repository URL credentials are not allowed');
  }
  if (!parsed.pathname.endsWith('/index.yaml')) {
    parsed.pathname = `${parsed.pathname.replace(/\/$/, '')}/index.yaml`;
  }
  return parsed;
}

function isPrivateIpv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower === '::' || lower === '::1') return true;
  if (lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:')) return true;
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    return net.isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  return false;
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 4) return isPrivateIpv4(address);
  if (family === 6) return isPrivateIpv6(address);
  return true;
}

export async function resolveAndValidateHelmRepoUrl(
  repoUrl: string,
  options: ResolveOptions = {},
): Promise<ResolvedHelmRepoUrl> {
  const url = normalizeHelmIndexUrl(repoUrl);
  const literalFamily = net.isIP(url.hostname);
  const addresses = literalFamily
    ? [{ address: url.hostname, family: literalFamily as 4 | 6 }]
    : await (options.lookup ?? ((hostname) => dns.lookup(hostname, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>))(url.hostname);

  if (addresses.length === 0) {
    throw new Error('Repository hostname did not resolve');
  }
  if (addresses.some((addr) => isBlockedAddress(addr.address))) {
    throw new Error('Internal/private addresses are not allowed');
  }

  return { url, addresses };
}

function readBody(res: IncomingMessage, maxBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks: Buffer[] = [];

    res.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxBytes) {
        res.destroy(new Error('Chart index response is too large'));
        return;
      }
      chunks.push(chunk);
    });
    res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    res.on('error', reject);
  });
}

async function fetchOnce(resolved: ResolvedHelmRepoUrl, options: Required<Pick<FetchOptions, 'timeoutMs' | 'maxBytes'>>): Promise<IncomingMessage> {
  const target = resolved.url;
  const firstAddress = resolved.addresses[0];
  const client = target.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const req = client.request(target, {
      method: 'GET',
      timeout: options.timeoutMs,
      lookup: (_hostname, _opts, callback) => {
        callback(null, firstAddress.address, firstAddress.family);
      },
      headers: {
        Accept: 'application/x-yaml,text/yaml,text/plain,*/*',
      },
    }, resolve);

    req.on('timeout', () => req.destroy(new Error('Timed out fetching chart index')));
    req.on('error', reject);
    req.end();
  });
}

export async function fetchHelmRepoIndex(repoUrl: string, options: FetchOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = repoUrl;

  for (let redirects = 0; redirects <= maxRedirects; redirects += 1) {
    const resolved = await resolveAndValidateHelmRepoUrl(currentUrl, options);
    const response = await fetchOnce(resolved, { timeoutMs, maxBytes });
    const statusCode = response.statusCode ?? 0;

    if (statusCode >= 300 && statusCode < 400 && response.headers.location) {
      currentUrl = new URL(response.headers.location, resolved.url).toString();
      response.resume();
      continue;
    }

    if (statusCode < 200 || statusCode >= 300) {
      response.resume();
      throw new Error(`${statusCode}`);
    }

    return readBody(response, maxBytes);
  }

  throw new Error('Too many redirects fetching chart index');
}
