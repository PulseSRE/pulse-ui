/**
 * What to ask Pulse about a resource, by kind: the one map of suggested
 * questions for detail pages. A kind that is not listed gets the generic
 * questions (workloads: "why unhealthy"; anything else: "what is it for").
 *
 * The first question doubles as the free-text box's placeholder, so it is the
 * question someone opening this kind's page most often has.
 */
import { isWorkloadKind } from './workloadKinds';

export const ASK_PULSE_PROMPTS: Readonly<Record<string, readonly string[]>> = {
  ConfigMap: ['Who uses this and what restarts if I change it?', 'What changed recently?'],
  Secret: ['Who uses this and what restarts if I change it?', 'What changed recently?'],
  HorizontalPodAutoscaler: ['Why is this scaled the way it is?', 'Is it maxed out?', 'What changed recently?'],
  ClusterOperator: ["Why is this degraded and what's blocking it?", 'Is it blocking an upgrade?'],
  Node: ['Why is this node unhealthy?', 'Which pods would move if I drained it?', 'Is it running out of memory or disk?'],
  Route: ["Why can't this be reached?", 'Is its certificate valid?'],
  Service: ["Why can't this be reached?", 'Which pods are behind it?'],
  PersistentVolumeClaim: ['Why is this pending?', 'Is it filling up?', 'Who mounts it?'],
  InstallPlan: ['What does this change?', 'Is it safe to approve?'],
};

const WORKLOAD_PROMPTS = (kind: string) => [`Why is this ${kind} unhealthy?`, 'What changed recently?', 'How can I optimize this?'];
const GENERIC_PROMPTS = (kind: string) => [`What is this ${kind} for, and is anything wrong with it?`, 'What changed recently?'];

/** Suggested questions for a kind's detail page. */
export function askPulsePromptsFor(kind: string, isWorkload = isWorkloadKind(kind)): string[] {
  const own = ASK_PULSE_PROMPTS[kind];
  if (own) return [...own];
  return isWorkload ? WORKLOAD_PROMPTS(kind) : GENERIC_PROMPTS(kind);
}
