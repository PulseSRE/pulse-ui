/**
 * Which containers a terminal can exec into, and which one to open by default.
 *
 * The pod terminal used to open `spec.containers[0]` with no way to switch.
 * On many pods that is a sidecar (oauth-proxy, istio-proxy), so the shell
 * landed in the wrong container; ephemeral debug containers added with the
 * Debug button were not reachable from the terminal at all.
 */
import { pickDefaultContainer } from '../components/logs/pickDefaultContainer';

export interface TerminalTarget {
  name: string;
  kind: 'container' | 'ephemeral';
  /** Only a running container accepts exec. */
  running: boolean;
}

interface ContainerStatus {
  name?: string;
  state?: { running?: unknown };
}

interface PodLike {
  spec?: {
    containers?: Array<{ name?: string }>;
    ephemeralContainers?: Array<{ name?: string }>;
  };
  status?: {
    containerStatuses?: ContainerStatus[];
    ephemeralContainerStatuses?: ContainerStatus[];
  };
}

function runningSet(statuses: ContainerStatus[] | undefined): Set<string> {
  return new Set((statuses ?? []).filter((s) => s.state?.running && s.name).map((s) => s.name as string));
}

export function terminalTargets(pod: PodLike | undefined | null): TerminalTarget[] {
  if (!pod) return [];
  const running = runningSet(pod.status?.containerStatuses);
  const ephRunning = runningSet(pod.status?.ephemeralContainerStatuses);
  const hasStatus = Boolean(pod.status?.containerStatuses);
  const out: TerminalTarget[] = [];
  for (const c of pod.spec?.containers ?? []) {
    if (c.name) out.push({ name: c.name, kind: 'container', running: hasStatus ? running.has(c.name) : true });
  }
  for (const c of pod.spec?.ephemeralContainers ?? []) {
    if (c.name) out.push({ name: c.name, kind: 'ephemeral', running: ephRunning.has(c.name) });
  }
  return out;
}

/** The app container if it is running, else any running container, else the app container. */
export function defaultTerminalTarget(targets: TerminalTarget[]): string {
  const regular = targets.filter((t) => t.kind === 'container');
  const runningRegular = regular.filter((t) => t.running).map((t) => t.name);
  return (
    pickDefaultContainer(runningRegular) ??
    pickDefaultContainer(regular.map((t) => t.name)) ??
    targets[0]?.name ??
    ''
  );
}
