/**
 * Parse a (possibly multi-document) Kubernetes manifest and work out where
 * each document is created.
 *
 * Import YAML used to POST the whole text to the pods endpoint, whatever it
 * contained, and found the namespace with the first `namespace:` anywhere in
 * the text (a container env var or a RoleBinding subject would do). Each
 * document is now parsed, its kind resolved to a GVR, and its own
 * `metadata.namespace` used — never one for a cluster-scoped kind.
 */
import { loadAll, dump, CORE_SCHEMA } from 'js-yaml';
import { resolveKind, gvrSegment } from './kindRegistry';

export interface ManifestDocument {
  index: number;
  apiVersion: string;
  kind: string;
  name: string;
  /** Namespace the object is created in; undefined for cluster-scoped kinds. */
  namespace?: string;
  /** Whether the kind is namespaced, when discovery or the known table says. */
  namespaced?: boolean;
  /** Collection path to POST to. */
  createPath: string;
  /** `group~version~plural` for /r/ links. */
  gvrUrl: string;
  object: Record<string, unknown>;
  /** The document re-serialised, for dry runs. */
  yaml: string;
}

export interface ManifestParse {
  documents: ManifestDocument[];
  errors: string[];
}

function collectionPath(group: string, version: string, plural: string, namespace?: string): string {
  const base = group ? `/apis/${group}/${version}` : `/api/${version}`;
  return namespace ? `${base}/namespaces/${namespace}/${plural}` : `${base}/${plural}`;
}

/**
 * @param defaultNamespace used for a namespaced document that names none
 *   (the namespace the user is working in).
 */
export function parseManifest(text: string, defaultNamespace = 'default'): ManifestParse {
  const errors: string[] = [];
  const documents: ManifestDocument[] = [];
  let raw: unknown[];
  try {
    // CORE_SCHEMA (YAML 1.2 core): the default schema turns an unquoted
    // `2024-01-15` into a Date ("2024-01-15T00:00:00.000Z" once serialised).
    // Strings such as yes/no/on/off stay strings.
    raw = loadAll(text, undefined, { schema: CORE_SCHEMA });
  } catch (err) {
    const msg = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { documents, errors: [/tab/i.test(msg) ? `YAML uses tabs for indentation (use spaces instead): ${msg}` : `Invalid YAML: ${msg}`] };
  }

  // A `List` (e.g. `oc get -o yaml` output) carries its objects in `items`.
  const objects: unknown[] = [];
  for (const doc of raw) {
    if (doc && typeof doc === 'object' && !Array.isArray(doc) && typeof (doc as { kind?: unknown }).kind === 'string'
      && /List$/.test((doc as { kind: string }).kind) && Array.isArray((doc as { items?: unknown }).items)) {
      objects.push(...(doc as { items: unknown[] }).items);
    } else if (doc !== null && doc !== undefined) {
      objects.push(doc);
    }
  }

  const label = (i: number) => (objects.length > 1 ? `Document ${i + 1}: ` : '');
  objects.forEach((doc, i) => {
    if (!doc || typeof doc !== 'object' || Array.isArray(doc)) {
      errors.push(`${label(i)}Does not look like a Kubernetes object (no key: value pairs found)`);
      return;
    }
    const obj = doc as Record<string, unknown>;
    const metadata = (obj.metadata && typeof obj.metadata === 'object' ? obj.metadata : {}) as Record<string, unknown>;
    const apiVersion = typeof obj.apiVersion === 'string' ? obj.apiVersion : '';
    const kind = typeof obj.kind === 'string' ? obj.kind : '';
    const name = typeof metadata.name === 'string' ? metadata.name : '';
    if (!apiVersion) errors.push(`${label(i)}Missing apiVersion`);
    if (!kind) errors.push(`${label(i)}Missing kind`);
    if (!apiVersion || !kind) return;

    const r = resolveKind(kind, apiVersion);
    const declaredNs = typeof metadata.namespace === 'string' && metadata.namespace ? metadata.namespace : undefined;
    let namespace: string | undefined;
    if (r.namespaced === false) {
      namespace = undefined;
    } else if (r.namespaced === true) {
      namespace = declaredNs ?? defaultNamespace;
    } else {
      // Unknown scope (a CRD discovery has not seen): trust what the document says.
      namespace = declaredNs;
    }

    documents.push({
      index: i,
      apiVersion,
      kind,
      name: name || String(metadata.generateName ?? ''),
      namespace,
      namespaced: r.namespaced,
      createPath: collectionPath(r.group, r.version, r.plural, namespace),
      gvrUrl: gvrSegment(r),
      object: obj,
      // The default dump schema quotes anything a YAML 1.1 reader (the API
      // server's) could take for a date or boolean, so values survive.
      yaml: dump(obj, { lineWidth: -1, noRefs: true }),
    });
  });

  if (objects.length === 0 && errors.length === 0) errors.push('Empty input');
  return { documents, errors };
}

/** "Deployment" for one document, "3 resources" for several. */
export function describeManifest(docs: ManifestDocument[]): string {
  if (docs.length === 1) return docs[0].kind;
  return `${docs.length} resources`;
}
