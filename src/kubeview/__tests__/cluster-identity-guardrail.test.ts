/**
 * Guardrail: never read from one cluster and write to another.
 *
 * CLAUDE.md: "Preserve active cluster/user identity in query keys,
 * subscriptions, tabs, and pending actions." This scan fails when
 *
 *  (a) a `useQuery({ queryKey, queryFn })` in views/, components/ or hooks/
 *      reads Kubernetes or Prometheus data (k8sGet/k8sList/k8sLogs/k8sFetch,
 *      queryInstant/queryRange/promFetch, or fetch of /api/kubernetes or
 *      /api/prometheus) and its key carries no cluster identifier; or
 *  (b) code outside engine/ calls `fetch('/api/kubernetes…')` or
 *      `fetch('/api/prometheus…')` directly, which pins the request to the
 *      local cluster and skips impersonation.
 *
 * Fix the call site (pass the cluster id to the k8s helper and put it in the
 * key) rather than adding to the allowlists. An allowlisted entry must say
 * why the request is correct for every active cluster.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const ROOT = path.resolve(__dirname, '..');
const SCANNED_DIRS = ['views', 'components', 'hooks'];

/**
 * (a) Queries allowed to omit the cluster from their key, as
 * `relativePath#queryKeySource` (the key's exact source text) -> reason.
 */
const QUERY_KEY_ALLOWLIST: Record<string, string> = {
  // (empty — every cluster read keys on the cluster it reads)
};

/**
 * (b) Files allowed to fetch /api/kubernetes or /api/prometheus directly.
 */
const RAW_FETCH_ALLOWLIST: Record<string, string> = {
  // Prometheus helpers own the /api/prometheus base and refuse non-local clusters.
  'components/metrics/prometheus.ts': 'owns the local-only Prometheus base',
};

const CLUSTER_READ = /\bk8s(?:Get|List|Logs|Fetch)\s*[<(]|\bquery(?:Instant|Range)\s*\(|\bpromFetch\s*\(|\bgetMetricNames\s*\(|\bgetLabelValues\s*\(|fetch\(\s*[`'"]\/api\/(?:kubernetes|prometheus)|\bclusterBase\b|\bgetClusterBase\s*\(/;
/** An identifier (not a string literal like 'clusterversion') naming a cluster. */
const CLUSTER_IDENTIFIER = /cluster/i;
const RAW_FETCH = /\bfetch\(\s*[`'"]\/api\/(?:kubernetes|prometheus)\b/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|\.spec\.|\.d\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Same-file declarations (functions, variable initializers) by name, built
 * once per file: resolving names by walking the tree per lookup made the
 * scan quadratic and too slow under coverage instrumentation.
 */
const declCache = new WeakMap<ts.SourceFile, Map<string, ts.Node>>();
function declarations(sf: ts.SourceFile): Map<string, ts.Node> {
  let map = declCache.get(sf);
  if (map) return map;
  const m = new Map<string, ts.Node>();
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name && !m.has(node.name.text)) m.set(node.name.text, node);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && !m.has(node.name.text)) {
      m.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  map = m;
  declCache.set(sf, map);
  return map;
}

/** The declaration (function, or variable initializer) a name refers to in the same file. */
function resolveLocalNode(sf: ts.SourceFile, name: string): ts.Node | undefined {
  return declarations(sf).get(name);
}

function resolveLocalFunction(sf: ts.SourceFile, name: string): string {
  return resolveLocalNode(sf, name)?.getText(sf) ?? '';
}

function mentionsClusterIdentifier(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return CLUSTER_IDENTIFIER.test(node.text);
  if (ts.isStringLiteralLike(node)) return false;
  return ts.forEachChild(node, mentionsClusterIdentifier) ?? false;
}

export function findUnscopedQueries(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^use(?:Suspense)?Query$/.test(node.expression.text)) {
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        let keyText = '';
        let fnText = '';
        let keyHasClusterId = false;
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
          const name = prop.name.getText(sf);
          const init = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
          if (name === 'queryKey') {
            keyText = init.getText(sf);
            // queryKey: someKey — judge the array that name is bound to.
            const keyNode = ts.isIdentifier(init) ? resolveLocalNode(sf, init.text) ?? init : init;
            keyHasClusterId = mentionsClusterIdentifier(keyNode);
          }
          if (name === 'queryFn') {
            fnText = init.getText(sf);
            if (ts.isIdentifier(init)) fnText += resolveLocalFunction(sf, init.text);
            // queryFn: () => loadThing(a) — follow one level into same-file helpers.
            for (const m of fnText.matchAll(/\b([a-zA-Z_]\w*)\s*\(/g)) {
              const helper = resolveLocalFunction(sf, m[1]);
              if (helper && helper !== fnText) fnText += helper;
            }
            // fetch(url) — follow the URL variable (e.g. built from clusterBase).
            for (const m of fnText.matchAll(/\bfetch\(\s*([a-zA-Z_]\w*)\s*[,)]/g)) {
              fnText += resolveLocalFunction(sf, m[1]);
            }
          }
        }
        if (fnText && CLUSTER_READ.test(fnText) && !keyHasClusterId) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          problems.push(`${file}:${line + 1} queryKey ${keyText}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

function rel(file: string) {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

// Parsing every source file takes a few seconds on a loaded CI runner with
// coverage on; the default 5s per-test timeout is for single behaviours.
const SCAN_TIMEOUT_MS = 30_000;

describe('cluster identity guardrail', () => {
  const files = SCANNED_DIRS.flatMap(d => walk(path.join(ROOT, d)));

  it('every query that reads cluster data keys on the cluster it reads', () => {
    const problems = files.flatMap(f => {
      const r = rel(f);
      return findUnscopedQueries(r, fs.readFileSync(f, 'utf8'))
        .filter(p => !Object.keys(QUERY_KEY_ALLOWLIST).some(k => {
          const [file, key] = k.split('#');
          return p.startsWith(`${file}:`) && p.endsWith(`queryKey ${key}`);
        }));
    });
    expect(problems).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  it('nothing outside engine/ fetches /api/kubernetes or /api/prometheus directly', () => {
    const all = walk(ROOT).filter(f => !rel(f).startsWith('engine/'));
    const problems: string[] = [];
    for (const f of all) {
      const r = rel(f);
      if (r in RAW_FETCH_ALLOWLIST) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (RAW_FETCH.test(line)) problems.push(`${r}:${i + 1} ${line.trim()}`);
      });
    }
    expect(problems).toEqual([]);
  });

  it('the scan catches an unscoped key and accepts a scoped one', () => {
    const bad = `const q = useQuery({ queryKey: ['k8s', 'get', apiPath], queryFn: () => k8sGet(apiPath) });`;
    const viaHelper = `async function load() { return fetch('/api/prometheus/api/v1/rules'); }
      const q = useQuery({ queryKey: ['rules'], queryFn: load });`;
    const good = `const q = useQuery({ queryKey: ['k8s', 'get', clusterId, apiPath], queryFn: () => k8sGet(apiPath, clusterId) });`;
    const viaUrlVar = `const url = \`\${clusterBase}\${apiPath}\`;
      const q = useQuery({ queryKey: ['k8s', 'get', apiPath], queryFn: async () => (await fetch(url)).json() });`;
    const namedKey = `const queryKey = ['k8s', 'list', apiPath, clusterId];
      const q = useQuery({ queryKey, queryFn: () => k8sList(apiPath, undefined, clusterId) });`;
    const literalOnly = `const q = useQuery({ queryKey: ['admin', 'clusterversion'], queryFn: () => k8sGet(p) });`;
    const unrelated = `const q = useQuery({ queryKey: ['agent', 'views'], queryFn: () => fetch('/api/agent/views') });`;
    expect(findUnscopedQueries('x.ts', bad)).toHaveLength(1);
    expect(findUnscopedQueries('x.ts', viaHelper)).toHaveLength(1);
    expect(findUnscopedQueries('x.ts', good)).toEqual([]);
    expect(findUnscopedQueries('x.ts', literalOnly)).toHaveLength(1);
    expect(findUnscopedQueries('x.ts', viaUrlVar)).toHaveLength(1);
    expect(findUnscopedQueries('x.ts', namedKey)).toEqual([]);
    expect(findUnscopedQueries('x.ts', unrelated)).toEqual([]);
  });
});
