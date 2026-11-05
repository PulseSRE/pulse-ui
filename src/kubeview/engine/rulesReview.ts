/**
 * Effective permissions of another subject, computed by impersonating it.
 *
 * A SelfSubjectRulesReview answers "what can I do in this namespace?". Sent
 * with Impersonate-User it answers for that user. It is read-only (a review
 * creates nothing) but needs `impersonate` permission.
 *
 * Groups: the browser cannot send the repeated Impersonate-Group lines the
 * API server needs for several groups, so the review runs once as the user
 * alone and once as the user in each group, and the rules are combined.
 * RBAC only adds, so the union is what the user has with all of them.
 * A ServiceAccount gets its service-account groups from the API server when
 * none are named, so it needs one review.
 */
import { k8sFetchAs } from './query';
import { parseK8sErrorResponse } from './errors';
import type { SubjectRef } from './subjectAccess';
import { usernameOf } from './subjectAccess';

export interface ResourceRule { verbs: string[]; apiGroups?: string[]; resources?: string[]; resourceNames?: string[] }
export interface NonResourceRule { verbs: string[]; nonResourceURLs?: string[] }

export interface RulesReview {
  namespace: string;
  resourceRules: ResourceRule[];
  nonResourceRules: NonResourceRule[];
  /** The API server could not evaluate every rule (e.g. a webhook authorizer); the list may be short. */
  incomplete: boolean;
  evaluationError?: string;
  /** Which identities were impersonated, in order. */
  ranAs: Array<{ user: string; group?: string }>;
}

/** The identities to impersonate for a subject: the user alone, then once per group. */
export function impersonationsFor(ref: SubjectRef, groups: string[]): Array<{ user: string; group?: string }> {
  const user = usernameOf(ref);
  if (ref.kind === 'ServiceAccount') return [{ user }];
  return [{ user }, ...[...new Set(groups)].filter((g) => g !== 'system:authenticated').map((group) => ({ user, group }))];
}

const key = (r: unknown) => JSON.stringify(r);

/** Union of rule lists, without duplicates, in first-seen order. */
function union<T>(lists: T[][]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const list of lists) for (const r of list) { const k = key(r); if (!seen.has(k)) { seen.add(k); out.push(r); } }
  return out;
}

export async function rulesReviewAs(clusterId: string, namespace: string, ref: SubjectRef, groups: string[]): Promise<RulesReview> {
  const ranAs = impersonationsFor(ref, groups);
  const path = '/apis/authorization.k8s.io/v1/selfsubjectrulesreviews';
  const results = await Promise.all(ranAs.map(async (as) => {
    const res = await k8sFetchAs(clusterId, path, as, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectRulesReview', spec: { namespace } }),
    });
    if (!res.ok) throw await parseK8sErrorResponse(res, { operation: 'create', apiPath: path });
    return (await res.json()) as { status?: { resourceRules?: ResourceRule[]; nonResourceRules?: NonResourceRule[]; incomplete?: boolean; evaluationError?: string } };
  }));
  const errors = results.map((r) => r.status?.evaluationError).filter((e): e is string => !!e);
  return {
    namespace,
    resourceRules: union(results.map((r) => r.status?.resourceRules ?? [])),
    nonResourceRules: union(results.map((r) => r.status?.nonResourceRules ?? [])),
    incomplete: results.some((r) => r.status?.incomplete === true),
    evaluationError: errors.length ? [...new Set(errors)].join('; ') : undefined,
    ranAs,
  };
}
