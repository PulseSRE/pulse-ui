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
  request?: (resolved: ResolvedHelmRepoUrl, options: Required<Pick<FetchOptions, 'timeoutMs' | 'maxBytes'>>) => Promise<IncomingMessage>;
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

function hostnameForValidation(url: URL): string {
  const hostname = url.hostname;
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}

function ipv4ToNumber(address: string): number | null {
  const parts = address.split('.').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function ipv4InCidr(address: number, base: string, prefix: number): boolean {
  const baseNumber = ipv4ToNumber(base);
  if (baseNumber === null) return true;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (address & mask) === (baseNumber & mask);
}

function isPrivateIpv4(address: string): boolean {
  const value = ipv4ToNumber(address);
  if (value === null) return true;

  const blockedRanges: Array<[string, number]> = [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.88.99.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4],
  ];
  return blockedRanges.some(([base, prefix]) => ipv4InCidr(value, base, prefix));
}

function parseIpv6Hextets(address: string): number[] | null {
  const withoutZone = address.toLowerCase().split('%')[0];
  if (withoutZone.includes('.')) return null;
  const parts = withoutZone.split('::');
  if (parts.length > 2) return null;

  const parsePart = (part: string): number[] | null => {
    if (!part) return [];
    const hextets = part.split(':').map((chunk) => Number.parseInt(chunk, 16));
    return hextets.every((hextet) => Number.isInteger(hextet) && hextet >= 0 && hextet <= 0xffff) ? hextets : null;
  };

  const left = parsePart(parts[0]);
  const right = parsePart(parts[1] ?? '');
  if (!left || !right) return null;

  if (parts.length === 1) {
    return left.length === 8 ? left : null;
  }

  const fillLength = 8 - left.length - right.length;
  if (fillLength < 1) return null;
  return [...left, ...Array(fillLength).fill(0), ...right];
}

function isPrivateIpv6(address: string): boolean {
  const lower = address.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const mapped = lower.slice('::ffff:'.length);
    return net.isIP(mapped) === 4 ? isPrivateIpv4(mapped) : true;
  }
  const hextets = parseIpv6Hextets(lower);
  if (!hextets) return true;

  const [first, second] = hextets;
  if (hextets.every((hextet) => hextet === 0)) return true;
  if (hextets.slice(0, 7).every((hextet) => hextet === 0) && hextets[7] === 1) return true;
  if ((first & 0xfe00) === 0xfc00) return true;
  if ((first & 0xffc0) === 0xfe80) return true;
  if (first === 0x2001 && second === 0x0db8) return true;
  if ((first & 0xff00) === 0xff00) return true;
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
  const hostname = hostnameForValidation(url);
  const literalFamily = net.isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily as 4 | 6 }]
    : await (options.lookup ?? ((hostnameToResolve) => dns.lookup(hostnameToResolve, { all: true, verbatim: true }) as Promise<ResolvedAddress[]>))(hostname);

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
    const response = await (options.request ?? fetchOnce)(resolved, { timeoutMs, maxBytes });
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
