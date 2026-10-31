/**
 * Guardrail: never read from one cluster and write to another.
 *
 * CLAUDE.md: "Preserve active cluster/user identity in query keys,
 * subscriptions, tabs, and pending actions." Every non-test source file under
 * src/ outside src/kubeview/engine/ is parsed with the TypeScript compiler,
 * and the scan fails when
 *
 *  (a) a React Query hook (useQuery, useSuspenseQuery, useInfiniteQuery, or
 *      an entry of useQueries) has a queryFn that reads Kubernetes or
 *      Prometheus data — the k8s helpers, the Prometheus helpers, a cluster
 *      base URL, or a Kubernetes/Prometheus proxy path — and its key names no
 *      cluster id (see CLUSTER_ID_NAMES); or
 *  (b) any string or template literal contains the Kubernetes or Prometheus
 *      proxy path. A literal base pins the request to the local cluster and
 *      skips impersonation, however it reaches fetch (directly, split across
 *      lines, or through a constant). Use k8sFetch/k8sGet/… with a cluster id,
 *      or the Prometheus helpers.
 *
 * Fix the call site rather than adding to the allowlists. An allowlisted
 * entry must say why the request is correct for every active cluster.
 */
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

const SRC = path.resolve(__dirname, '../..');
/** Owns cluster routing; its helpers take the cluster id explicitly. */
const EXEMPT_DIR = 'kubeview/engine/';

/**
 * The names that mean "the cluster this read is for". Exact names only: an
 * identifier that merely contains "cluster" (isClusterScoped, clusterName)
 * says nothing about which cluster a cached entry came from.
 */
const CLUSTER_ID_NAMES = new Set([
  'clusterId',
  'activeClusterId',
  'resolvedClusterId',
  'pollClusterId',
  'LOCAL_CLUSTER_ID',
  'CONFIG_CLUSTER_ID',
  'METRICS_CLUSTER_ID',
]);

/**
 * (a) Queries allowed to omit the cluster from their key, as
 * `path#queryKeySource` (path relative to src/, the key's exact source) -> reason.
 */
const QUERY_KEY_ALLOWLIST: Record<string, string> = {
  // (empty — every cluster read keys on the cluster it reads)
};

/** (b) Files allowed to contain a proxy-path literal (path relative to src/) -> reason. */
const PROXY_LITERAL_ALLOWLIST: Record<string, string> = {
  'kubeview/components/metrics/prometheus.ts':
    'owns the local-only Prometheus base; its helpers refuse any cluster but the local one without sending a request',
};

const PROXY_PATH = /\/api\/(?:kubernetes|prometheus)\b/;
const CLUSTER_READ = /\bk8s(?:Get|List|Logs|Fetch)\s*[<(]|\bquery(?:Instant|Range)\s*\(|\bpromFetch\s*\(|\bgetMetricNames\s*\(|\bgetLabelValues\s*\(|\bclusterBase\b|\bgetClusterBase\s*\(|\/api\/(?:kubernetes|prometheus)\b/;
const QUERY_HOOKS = /^use(?:Suspense)?(?:Infinite)?Query$/;

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

function parse(file: string, source: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
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

function mentionsClusterId(node: ts.Node): boolean {
  if (ts.isIdentifier(node)) return CLUSTER_ID_NAMES.has(node.text);
  if (ts.isStringLiteralLike(node)) return false;
  return ts.forEachChild(node, mentionsClusterId) ?? false;
}

/** The queryFn's text plus the same-file helpers and variables it names (one level). */
function readText(sf: ts.SourceFile, fn: ts.Node): string {
  const decls = declarations(sf);
  let text = fn.getText(sf);
  // Names the queryFn declares itself (locals, parameters) are not outer helpers.
  const seen = new Set<string>();
  const local = (node: ts.Node) => {
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node)) && node.name && ts.isIdentifier(node.name)) {
      seen.add(node.name.text);
    }
    ts.forEachChild(node, local);
  };
  local(fn);
  const follow = (node: ts.Node) => {
    if (ts.isIdentifier(node) && !seen.has(node.text)) {
      seen.add(node.text);
      const decl = decls.get(node.text);
      if (decl && decl !== fn && !(decl.pos <= fn.pos && fn.end <= decl.end)) text += '\n' + decl.getText(sf);
    }
    ts.forEachChild(node, follow);
  };
  follow(fn);
  return text;
}

function queryOptionObjects(node: ts.CallExpression): ts.ObjectLiteralExpression[] {
  if (!ts.isIdentifier(node.expression)) return [];
  const name = node.expression.text;
  const arg = node.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg)) return [];
  if (QUERY_HOOKS.test(name)) return [arg];
  if (name === 'useQueries' || name === 'useSuspenseQueries') {
    // useQueries({ queries: [ {...}, ... ] }) or queries: list.map(x => ({...}))
    const out: ts.ObjectLiteralExpression[] = [];
    const queries = arg.properties.find(p => ts.isPropertyAssignment(p) && p.name.getText() === 'queries');
    if (queries && ts.isPropertyAssignment(queries)) {
      const collect = (n: ts.Node) => {
        if (ts.isObjectLiteralExpression(n) && n.properties.some(p => (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) && p.name.getText() === 'queryKey')) {
          out.push(n);
          return;
        }
        ts.forEachChild(n, collect);
      };
      collect(queries.initializer);
    }
    return out;
  }
  return [];
}

export function findUnscopedQueries(file: string, source: string): string[] {
  const sf = parse(file, source);
  const decls = declarations(sf);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      for (const obj of queryOptionObjects(node)) {
        let keyNode: ts.Node | undefined;
        let fnNode: ts.Node | undefined;
        for (const prop of obj.properties) {
          if (!ts.isPropertyAssignment(prop) && !ts.isShorthandPropertyAssignment(prop)) continue;
          const init = ts.isPropertyAssignment(prop) ? prop.initializer : prop.name;
          if (prop.name.getText(sf) === 'queryKey') keyNode = init;
          if (prop.name.getText(sf) === 'queryFn') fnNode = init;
        }
        if (!keyNode || !fnNode) continue;
        // queryKey: someKey — judge the array that name is bound to.
        const resolvedKey = ts.isIdentifier(keyNode) ? decls.get(keyNode.text) ?? keyNode : keyNode;
        if (CLUSTER_READ.test(readText(sf, fnNode)) && !mentionsClusterId(resolvedKey)) {
          const { line } = sf.getLineAndCharacterOfPosition(obj.getStart(sf));
          problems.push(`${file}:${line + 1} queryKey ${keyNode.getText(sf)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

/** String and template literals holding a Kubernetes/Prometheus proxy path. */
export function findProxyLiterals(file: string, source: string): string[] {
  const sf = parse(file, source);
  const problems: string[] = [];
  const visit = (node: ts.Node) => {
    let text: string | undefined;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) text = node.text;
    if (text !== undefined && PROXY_PATH.test(text)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      problems.push(`${file}:${line + 1} ${JSON.stringify(text)}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return problems;
}

function rel(file: string) {
  return path.relative(SRC, file).split(path.sep).join('/');
}

// Parsing every source file takes a few seconds on a loaded CI runner with
// coverage on; the default 5s per-test timeout is for single behaviours.
const SCAN_TIMEOUT_MS = 30_000;

describe('cluster identity guardrail', () => {
  const files = walk(SRC).filter(f => !rel(f).startsWith(EXEMPT_DIR));

  it('scans all of src/ outside the engine, including src/lib', () => {
    const scanned = files.map(rel);
    expect(scanned).toContain('lib/dependencyGraph.ts');
    expect(scanned).toContain('kubeview/views/YamlEditorView.tsx');
    expect(scanned.some(f => f.startsWith(EXEMPT_DIR))).toBe(false);
  });

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

  it('no Kubernetes/Prometheus proxy path literal outside the engine', () => {
    const problems = files
      .filter(f => !(rel(f) in PROXY_LITERAL_ALLOWLIST))
      .flatMap(f => findProxyLiterals(rel(f), fs.readFileSync(f, 'utf8')));
    expect(problems).toEqual([]);
  }, SCAN_TIMEOUT_MS);

  describe('catches each shape that slipped past the first version', () => {
    const unscoped = (src: string) => findUnscopedQueries('fixture.tsx', src);
    const literals = (src: string) => findProxyLiterals('fixture.tsx', src);

    it('a plain unscoped key, and accepts a scoped one', () => {
      expect(unscoped(`useQuery({ queryKey: ['k8s', 'get', apiPath], queryFn: () => k8sGet(apiPath) });`)).toHaveLength(1);
      expect(unscoped(`useQuery({ queryKey: ['k8s', 'get', apiPath, clusterId], queryFn: () => k8sGet(apiPath, clusterId) });`)).toEqual([]);
      expect(unscoped(`useQuery({ queryKey: ['agent', 'views'], queryFn: () => agentFetch('/api/agent/views') });`)).toEqual([]);
    });

    it('a string literal or an unrelated "cluster" identifier is not a cluster id', () => {
      expect(unscoped(`useQuery({ queryKey: ['admin', 'clusterversion'], queryFn: () => k8sGet(p) });`)).toHaveLength(1);
      expect(unscoped(`useQuery({ queryKey: ['rbac', isClusterScoped], queryFn: () => k8sList(p) });`)).toHaveLength(1);
      expect(unscoped(`useQuery({ queryKey: ['n', clusterName], queryFn: () => k8sList(p) });`)).toHaveLength(1);
    });

    it('a fetch split across lines', () => {
      const src = `useQuery({ queryKey: ['pods'], queryFn: async () => (await fetch(
        '/api/kubernetes/api/v1/pods',
      )).json() });`;
      expect(unscoped(src)).toHaveLength(1);
      expect(literals(src)).toHaveLength(1);
    });

    it('a URL held in a constant or built from a cluster base', () => {
      const viaConst = `const K = '/api/kubernetes';
        export function f() { return fetch(\`\${K}/api/v1/pods\`); }`;
      expect(literals(viaConst)).toHaveLength(1);
      const viaConstInQuery = `const K = '/api/kubernetes';
        useQuery({ queryKey: ['pods'], queryFn: () => fetch(\`\${K}/api/v1/pods\`) });`;
      expect(unscoped(viaConstInQuery)).toHaveLength(1);
      const viaBase = `const url = \`\${clusterBase}\${apiPath}\`;
        useQuery({ queryKey: ['k8s', 'get', apiPath], queryFn: async () => (await fetch(url)).json() });`;
      expect(unscoped(viaBase)).toHaveLength(1);
      expect(literals(`const P = \`/api/prometheus/api/v1/query?q=\${q}\`;`)).toHaveLength(1);
    });

    it('useInfiniteQuery and useQueries', () => {
      expect(unscoped(`useInfiniteQuery({ queryKey: ['events'], queryFn: ({ pageParam }) => k8sList(p + pageParam), initialPageParam: '', getNextPageParam: () => undefined });`)).toHaveLength(1);
      expect(unscoped(`useQueries({ queries: paths.map((p) => ({ queryKey: ['k8s', p], queryFn: () => k8sGet(p) })) });`)).toHaveLength(1);
      expect(unscoped(`useQueries({ queries: paths.map((p) => ({ queryKey: ['k8s', p, clusterId], queryFn: () => k8sGet(p, clusterId) })) });`)).toEqual([]);
    });

    it('a named key bound to an array with the cluster id', () => {
      expect(unscoped(`const queryKey = ['k8s', 'list', apiPath, resolvedClusterId];
        useQuery({ queryKey, queryFn: () => k8sList(apiPath, undefined, resolvedClusterId) });`)).toEqual([]);
    });
  });
});
