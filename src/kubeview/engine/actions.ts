/**
 * Resource Action Registry
 * Defines and executes actions on Kubernetes resources.
 */

import type { QueryClient } from '@tanstack/react-query';
import type { ResourceType } from './discovery';
import type { K8sResource } from './renderers/index';
import { k8sPatch, k8sDelete, k8sSubresource } from './query';
import { kindToPlural } from './renderers/index';

export interface ResourceAction {
  id: string;
  label: string;
  icon?: string;  // lucide icon name
  category: 'quick' | 'navigate' | 'danger';
  available: (resource: K8sResource, resourceType: ResourceType) => boolean;
  execute: (resource: K8sResource, context: ActionContext) => Promise<ActionResult>;
  shortcut?: string;
}

export interface ActionContext {
  navigate: (path: string) => void;
  addToast: (toast: ToastData) => void;
  queryClient: QueryClient;
  openDock: (panel: 'logs' | 'terminal' | 'events') => void;
}

export interface ToastData {
  type: 'success' | 'error' | 'warning' | 'undo';
  title: string;
  detail?: string;
}

export interface ActionResult {
  success: boolean;
  message: string;
  undo?: () => Promise<void>;
}

/**
 * Get API path for a resource
 */
function getResourcePath(resource: K8sResource): string {
  const [group, version] = resource.apiVersion.split('/').length === 2
    ? resource.apiVersion.split('/')
    : ['', resource.apiVersion];

  let path = group ? `/apis/${resource.apiVersion}` : `/api/${version}`;

  if (resource.metadata.namespace) {
    path += `/namespaces/${resource.metadata.namespace}`;
  }

  // Convert kind to plural (simple heuristic)
  const plural = kindToPlural(resource.kind);
  path += `/${plural}/${resource.metadata.name}`;

  return path;
}

/**
 * Built-in actions
 */

const deleteAction: ResourceAction = {
  id: 'delete',
  label: 'Delete',
  icon: 'Trash2',
  category: 'danger',
  available: (resource, resourceType) => resourceType.verbs.includes('delete'),
  execute: async (resource, context) => {
    const path = getResourcePath(resource);

    try {
      await k8sDelete(path);

      context.addToast({
        title: 'Resource deleted',
        detail: `${resource.kind} ${resource.metadata.name} has been deleted`,
        type: 'success',
      });

      return {
        success: true,
        message: `Deleted ${resource.kind} ${resource.metadata.name}`,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      context.addToast({
        title: 'Delete failed',
        detail: message,
        type: 'error',
      });

      return {
        success: false,
        message,
      };
    }
  },
};

const editYamlAction: ResourceAction = {
  id: 'edit-yaml',
  label: 'Edit YAML',
  icon: 'FileEdit',
  category: 'navigate',
  available: (resource, resourceType) => resourceType.verbs.includes('update'),
  execute: async (resource, context) => {
    const gvrUrl = `${resource.apiVersion}~${kindToPlural(resource.kind)}`.replace(/\//g, '~');
    const ns = resource.metadata.namespace || '_';
    context.navigate(`/yaml/${gvrUrl}/${ns}/${resource.metadata.name}`);

    return {
      success: true,
      message: 'Navigated to YAML editor',
    };
  },
  shortcut: 'e',
};

const viewLogsAction: ResourceAction = {
  id: 'view-logs',
  label: 'View Logs',
  icon: 'ScrollText',
  category: 'navigate',
  available: (resource) => resource.kind === 'Pod',
  execute: async (resource, context) => {
    context.openDock('logs');

    return {
      success: true,
      message: 'Opened logs panel',
    };
  },
  shortcut: 'l',
};

const openTerminalAction: ResourceAction = {
  id: 'open-terminal',
  label: 'Open Terminal',
  icon: 'Terminal',
  category: 'navigate',
  available: (resource) => {
    if (resource.kind !== 'Pod') return false;

    // Check if pod has at least one running container
    const status = resource.status as { phase?: string } | undefined;
    return status?.phase === 'Running';
  },
  execute: async (resource, context) => {
    context.openDock('terminal');

    return {
      success: true,
      message: 'Opened terminal',
    };
  },
  shortcut: 't',
};

const scaleAction: ResourceAction = {
  id: 'scale',
  label: 'Scale',
  icon: 'Scale',
  category: 'quick',
  available: (resource) => {
    return ['Deployment', 'StatefulSet', 'ReplicaSet'].includes(resource.kind);
  },
  execute: async (resource, context) => {
    // Scale is handled by the DetailView UI with +/- buttons.
    // The action registry should not auto-scale — navigating to the resource instead.
    const gvrUrl = `${resource.apiVersion}~${kindToPlural(resource.kind)}`.replace(/\//g, '~');
    const ns = resource.metadata.namespace || '_';
    context.navigate(`/r/${gvrUrl}/${ns}/${resource.metadata.name}`);

    return {
      success: true,
      message: 'Navigated to resource for scaling',
    };
  },
};

const restartRolloutAction: ResourceAction = {
  id: 'restart-rollout',
  label: 'Restart Rollout',
  icon: 'RotateCw',
  category: 'quick',
  available: (resource) => resource.kind === 'Deployment',
  execute: async (resource, context) => {
    const path = getResourcePath(resource);

    try {
      // Add a restart annotation to trigger rollout
      const restartedAt = new Date().toISOString();

      await k8sPatch(path, {
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': restartedAt,
              },
            },
          },
        },
      });

      context.addToast({
        title: 'Rollout restarted',
        detail: `${resource.kind} ${resource.metadata.name} rollout has been restarted`,
        type: 'success',
      });

      return {
        success: true,
        message: 'Rollout restarted',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      context.addToast({
        title: 'Restart failed',
        detail: message,
        type: 'error',
      });

      return {
        success: false,
        message,
      };
    }
  },
};

const cordonAction: ResourceAction = {
  id: 'cordon',
  label: 'Cordon',
  icon: 'Ban',
  category: 'quick',
  available: (resource) => {
    if (resource.kind !== 'Node') return false;

    const spec = resource.spec as { unschedulable?: boolean } | undefined;
    return !spec?.unschedulable;
  },
  execute: async (resource, context) => {
    const path = getResourcePath(resource);

    try {
      await k8sPatch(path, {
        spec: {
          unschedulable: true,
        },
      });

      context.addToast({
        title: 'Node cordoned',
        detail: `${resource.metadata.name} has been marked unschedulable`,
        type: 'success',
      });

      return {
        success: true,
        message: 'Node cordoned',
        undo: async () => {
          await k8sPatch(path, {
            spec: {
              unschedulable: false,
            },
          });
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      context.addToast({
        title: 'Cordon failed',
        detail: message,
        type: 'error',
      });

      return {
        success: false,
        message,
      };
    }
  },
};

const uncordonAction: ResourceAction = {
  id: 'uncordon',
  label: 'Uncordon',
  icon: 'CheckCircle',
  category: 'quick',
  available: (resource) => {
    if (resource.kind !== 'Node') return false;

    const spec = resource.spec as { unschedulable?: boolean } | undefined;
    return spec?.unschedulable === true;
  },
  execute: async (resource, context) => {
    const path = getResourcePath(resource);

    try {
      await k8sPatch(path, {
        spec: {
          unschedulable: false,
        },
      });

      context.addToast({
        title: 'Node uncordoned',
        detail: `${resource.metadata.name} is now schedulable`,
        type: 'success',
      });

      return {
        success: true,
        message: 'Node uncordoned',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      context.addToast({
        title: 'Uncordon failed',
        detail: message,
        type: 'error',
      });

      return {
        success: false,
        message,
      };
    }
  },
};

const drainAction: ResourceAction = {
  id: 'drain',
  label: 'Drain',
  icon: 'Droplet',
  category: 'danger',
  available: (resource) => resource.kind === 'Node',
  execute: async (resource, context) => {
    // Draining a node requires evicting all pods
    // This is a complex operation that should show a confirmation dialog
    const path = getResourcePath(resource);

    try {
      // First cordon the node
      await k8sPatch(path, {
        spec: {
          unschedulable: true,
        },
      });

      // Note: Full drain requires listing and evicting all pods on the node.
      // This only cordons the node (marks unschedulable). Use `oc adm drain` for full drain.

      context.addToast({
        title: 'Node cordoned',
        detail: `${resource.metadata.name} marked unschedulable. Use "oc adm drain ${resource.metadata.name}" for full drain.`,
        type: 'warning',
      });

      return {
        success: true,
        message: 'Node drain initiated',
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      context.addToast({
        title: 'Drain failed',
        detail: message,
        type: 'error',
      });

      return {
        success: false,
        message,
      };
    }
  },
};

/**
 * All built-in actions
 */
const BUILT_IN_ACTIONS: ResourceAction[] = [
  editYamlAction,
  viewLogsAction,
  openTerminalAction,
  scaleAction,
  restartRolloutAction,
  cordonAction,
  uncordonAction,
  drainAction,
  deleteAction, // Delete should be last (danger category)
];

/**
 * Get all available actions for a resource
 */
export function getActionsForResource(
  resource: K8sResource,
  resourceType: ResourceType
): ResourceAction[] {
  return BUILT_IN_ACTIONS.filter((action) =>
    action.available(resource, resourceType)
  );
}

/**
 * Get actions by category
 */
export function getActionsByCategory(
  resource: K8sResource,
  resourceType: ResourceType,
  category: 'quick' | 'navigate' | 'danger'
): ResourceAction[] {
  return getActionsForResource(resource, resourceType).filter(
    (action) => action.category === category
  );
}

/**
 * Find action by ID
 */
export function findAction(
  resource: K8sResource,
  resourceType: ResourceType,
  actionId: string
): ResourceAction | undefined {
  const actions = getActionsForResource(resource, resourceType);
  return actions.find((action) => action.id === actionId);
}

/**
 * Execute an action by ID
 */
export async function executeAction(
  resource: K8sResource,
  resourceType: ResourceType,
  actionId: string,
  context: ActionContext
): Promise<ActionResult> {
  const action = findAction(resource, resourceType, actionId);

  if (!action) {
    return {
      success: false,
      message: `Action ${actionId} not found`,
    };
  }

  return action.execute(resource, context);
}
