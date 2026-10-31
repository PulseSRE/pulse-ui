/**
 * Guardrail: every in-app link written in the source resolves to a page.
 *
 * The router used to redirect unknown paths to /pulse, so broken links (to
 * /welcome, /incidents, `/r/v1~nodes//name`, `/r/v1~deployments/...`) looked
 * like they worked. This test statically scans all non-test source under src/
 * for literal paths handed to navigation and asserts each one is a route the
 * router mounts (engine/routeTable.ts isKnownRoute).
 *
 * Scanned forms: navigate('…'), go('…') (useNavigateTab), to="…" / to={'…'} /
 * to={`…`}, href="/…", window.location.href = '/…', `path: '/…'` and
 * `link: '/…'`. Template literals are checked by their static parts: each
 * `${…}` is treated as one dynamic value; a segment that is entirely dynamic
 * may be anything, a partly-dynamic segment must still fit the route (a
 * hand-built `/r/v1~${kind}s` gvr does not — use resourceDetailUrl()).
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { isKnownRoute, ROUTE_PATTERNS, isValidGvrSegment } from '../engine/routeTable';
import { normalizeAgentLink } from '../engine/agentLinks';
import agentLinks from './fixtures/agentLinks.json';

const SRC = path.resolve(__dirname, '../..');

/**
 * Literal links that are genuinely dynamic or not app routes. Each entry is
 * `file:literal` with the reason alongside. Keep this list short.
 */
const ALLOWLIST: Record<string, string> = {
  // (empty — add `relative/file.tsx:<literal>` with a reason when needed)
};

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
      out.push(...sourceFiles(full));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

const LITERAL = String.raw`('(?:[^'\\\n]|\\.)*'|"(?:[^"\\\n]|\\.)*"|\x60(?:[^\x60\\]|\\.)*\x60)`;
const PATTERNS: RegExp[] = [
  // navigate('/x'), go('/x'), navigateTab('/x')
  new RegExp(String.raw`\b(?:navigate|go|navigateTab)\(\s*` + LITERAL, 'g'),
  // to="/x" | to={'/x'} | to={`/x`}
  new RegExp(String.raw`\bto=\{?\s*` + LITERAL, 'g'),
  // href="/x" (internal only; external URLs are skipped below)
  new RegExp(String.raw`\bhref=\{?\s*` + LITERAL, 'g'),
  // window.location.href = '/x'
  new RegExp(String.raw`location\.href\s*=\s*` + LITERAL, 'g'),
  // path: '/x' and link: '/x' in config objects
  new RegExp(String.raw`\b(?:path|link):\s*` + LITERAL, 'g'),
];

interface Found { file: string; line: number; literal: string }

function extractLinks(file: string): Found[] {
  const text = fs.readFileSync(file, 'utf8');
  const found: Found[] = [];
  for (const re of PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const raw = m[1];
      const body = raw.slice(1, -1);
      if (!body.startsWith('/')) continue; // relative strings, API names, external URLs
      if (body.startsWith('//')) continue;
      if (/^\/api\/|^\/apis\/|^\/oauth\//.test(body)) continue; // backend endpoints, not pages
      // JSON Patch operations ({ op: 'replace', path: '/spec/…' }) are not links.
      if (/\bop:\s*['"][a-z]+['"],?\s*$/.test(text.slice(Math.max(0, m.index - 60), m.index))) continue;
      const line = text.slice(0, m.index).split('\n').length;
      found.push({ file: path.relative(SRC, file), line, literal: raw });
    }
  }
  return found;
}

const DYN = '\u0000';

/** Replace each ${…} in a template literal body with a single DYN marker. */
function templateToMarked(raw: string): string {
  const body = raw.slice(1, -1);
  if (raw[0] !== '`') return body;
  let out = '';
  for (let i = 0; i < body.length; i++) {
    if (body[i] === '$' && body[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < body.length && depth > 0) {
        if (body[i] === '{') depth++;
        else if (body[i] === '}') depth--;
        i++;
      }
      i--;
      out += DYN;
    } else {
      out += body[i];
    }
  }
  return out;
}

/**
 * Does a (possibly partly dynamic) path fit a mounted route? Fully static
 * paths go straight to isKnownRoute. With dynamic parts, segments are compared
 * to each pattern: static segments must be equal, a fully dynamic segment fits
 * any param (or any static segment of the pattern), a partly dynamic segment
 * fits a param only if its static parts could still be valid there.
 */
function fitsRoute(marked: string): boolean {
  if (!marked.includes(DYN)) return isKnownRoute(marked);
  // Query/hash: only the path part has to resolve. A dynamic value before any
  // `?` may itself carry a query string, so cut at the first literal ? or #.
  const q = marked.search(/[?#]/);
  const pathPart = q === -1 ? marked : marked.slice(0, q);
  // A path that ends in a dynamic value may continue with more segments.
  const segs = pathPart.split('/').slice(1);
  const openEnded = pathPart.endsWith(DYN);

  return ROUTE_PATTERNS.some((pattern) => {
    const pSegs = pattern === '/' ? [] : pattern.split('/').slice(1);
    if (segs.length > pSegs.length) return false;
    if (segs.length < pSegs.length && !openEnded) return false;
    return segs.every((seg, i) => {
      const p = pSegs[i];
      if (seg === DYN) return true;
      if (!seg.includes(DYN)) {
        if (!p.startsWith(':')) return seg === p;
        if (p === ':gvr') return isValidGvrSegment(seg);
        return seg.length > 0;
      }
      // Partly dynamic segment.
      if (!p.startsWith(':')) {
        return new RegExp('^' + seg.split(DYN).map(escapeRe).join('.*') + '$').test(p);
      }
      // A gvr must come whole from resourceDetailUrl()/gvrToUrl(); building
      // `v1~${kind}s` by hand is exactly the bug this guards against.
      if (p === ':gvr') return false;
      return true;
    });
  });
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

describe('route table', () => {
  it('accepts the shapes the app links to', () => {
    for (const ok of [
      '/', '/pulse', '/inbox?tab=activity', '/admin?tab=crds#x', '/r/v1~pods', '/r/apps~v1~deployments/default/web',
      '/r/v1~nodes/_/worker-1', '/r/operator.openshift.io~v1~ingresscontrollers/openshift-ingress-operator/default',
      '/r/machine.openshift.io~v1beta1~machines', '/yaml/v1~configmaps/ns/cm', '/logs/ns/pod', '/node-logs/n1',
      '/create/argoproj.io~v1alpha1~applications', '/project/team-a', '/fleet/r/apps~v1~deployments', '/custom/abc',
      '/agent?tab=skills', '/operators?q=loki', '/preview',
    ]) {
      expect(isKnownRoute(ok), ok).toBe(true);
    }
  });

  it('rejects dead pages, malformed gvrs and empty segments', () => {
    for (const bad of [
      '/welcome', '/dashboard', '/incidents', '/incidents?tab=actions', '/r/v1~nodes//worker-1', '/r/nodes',
      '/r/apps~deployments', '/r/v1~Pods', '/r/apps~v1~deployments/Default/x', 'pulse', 'https://example.com',
      '//evil.example/pulse', '#/resource/v1~pods', '', '/r/v1~pods/ns/name/extra',
    ]) {
      expect(isKnownRoute(bad), bad).toBe(false);
    }
  });
});

describe('static links in source', () => {
  const files = sourceFiles(path.join(SRC, 'kubeview'));
  const links = files.flatMap(extractLinks);

  it('finds links to check (scanner sanity)', () => {
    // If the scanner silently stops matching, this guardrail is worthless.
    expect(links.length).toBeGreaterThan(100);
    expect(links.some((l) => l.literal.includes('/inbox'))).toBe(true);
  });

  it('every navigate/go/to/href/path/link literal resolves to a mounted route', () => {
    const broken = links
      .filter((l) => !(`${l.file}:${l.literal}` in ALLOWLIST))
      .filter((l) => !fitsRoute(templateToMarked(l.literal)))
      .map((l) => `${l.file}:${l.line}  ${l.literal}`);
    expect(broken, `Links with no page:\n${broken.join('\n')}`).toEqual([]);
  });

  it('allowlist entries are still present (no stale exemptions)', () => {
    const present = new Set(links.map((l) => `${l.file}:${l.literal}`));
    for (const key of Object.keys(ALLOWLIST)) expect(present.has(key), key).toBe(true);
  });
});

describe('links the agent emits', () => {
  const entries = agentLinks.links as Array<{ link: string; source: string; legacy?: boolean }>;

  it.each(entries.map((e) => [e.link, e]))('%s resolves', (_link, entry) => {
    const e = entry as (typeof entries)[number];
    // Legacy links are mapped by normalizeAgentLink before they are followed.
    const resolved = e.legacy ? normalizeAgentLink(e.link) : e.link;
    expect(isKnownRoute(resolved), `${e.link} (${e.source})`).toBe(true);
    if (e.legacy) expect(isKnownRoute(e.link)).toBe(false);
  });
});
