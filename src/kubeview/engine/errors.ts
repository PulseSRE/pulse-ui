/**
 * Structured error classification for Kubernetes API errors.
 * Provides user-friendly messages and actionable suggestions.
 */

import { useUIStore } from '../store/uiStore';

export type ErrorCategory =
  | 'permission'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'server'
  | 'network'
  | 'quota'
  | 'unknown';

interface ErrorContext {
  operation: string;
  resourceKind?: string;
  resourceName?: string;
  namespace?: string;
  apiPath?: string;
}

let errorIdCounter = 0;

export class PulseError extends Error {
  readonly category: ErrorCategory;
  readonly statusCode: number;
  readonly k8sReason: string;
  readonly context: ErrorContext;
  readonly userMessage: string;
  readonly suggestions: string[];
  readonly timestamp: number;
  readonly id: string;

  constructor(opts: {
    message: string;
    category: ErrorCategory;
    statusCode: number;
    k8sReason?: string;
    context: ErrorContext;
    userMessage: string;
    suggestions: string[];
  }) {
    super(opts.message);
    this.name = 'PulseError';
    this.category = opts.category;
    this.statusCode = opts.statusCode;
    this.k8sReason = opts.k8sReason || '';
    this.context = opts.context;
    this.userMessage = opts.userMessage;
    this.suggestions = opts.suggestions;
    this.timestamp = Date.now();
    this.id = `err-${++errorIdCounter}-${this.timestamp}`;
  }
}

interface K8sStatusResponse {
  kind?: string;
  apiVersion?: string;
  message?: string;
  reason?: string;
  code?: number;
  details?: {
    name?: string;
    kind?: string;
    causes?: Array<{ field?: string; message?: string; reason?: string }>;
  };
}

function isQuotaError(body: K8sStatusResponse): boolean {
  const msg = (body.message || '').toLowerCase();
  return (
    body.reason === 'Forbidden' &&
    (msg.includes('quota') || msg.includes('exceeded') || msg.includes('limit'))
  );
}

function classifyStatus(
  status: number,
  body: K8sStatusResponse,
  ctx: ErrorContext,
): { category: ErrorCategory; userMessage: string; suggestions: string[] } {
  const kind = ctx.resourceKind || 'resource';
  const name = ctx.resourceName || '';
  const ns = ctx.namespace || '';
  const op = ctx.operation || 'access';

  if (status === 403 && isQuotaError(body)) {
    return {
      category: 'quota',
      userMessage: ns
        ? `Resource quota exceeded in ${ns}`
        : 'Resource quota exceeded',
      suggestions: [
        'Clean up unused resources in this namespace',
        'Request a quota increase from your cluster admin',
      ],
    };
  }

  if (status === 401 || status === 403) {
    return {
      category: 'permission',
      userMessage: ns
        ? `You don't have permission to ${op} ${kind} in ${ns}`
        : `You don't have permission to ${op} ${kind}`,
      suggestions: [
        'Check your role bindings for this namespace',
        'Ask a cluster admin to grant the required permissions',
      ],
    };
  }

  if (status === 404) {
    return {
      category: 'not_found',
      userMessage: name
        ? `${kind} '${name}' was not found`
        : `${kind} was not found`,
      suggestions: [
        'It may have been deleted or moved',
        'Check that the namespace exists',
        'Return to the list view',
      ],
    };
  }

  if (status === 409) {
    return {
      category: 'conflict',
      userMessage: `This ${kind} was modified by someone else`,
      suggestions: ['Refresh the page and try again'],
    };
  }

  if (status === 422) {
    const causes = body.details?.causes;
    const fieldErrors = causes?.map(
      (c) => `${c.field}: ${c.message}`,
    );
    return {
      category: 'validation',
      userMessage: `The ${kind} spec is invalid`,
      suggestions: fieldErrors?.length
        ? fieldErrors
        : ['Check the resource YAML for syntax errors'],
    };
  }

  if (status >= 500) {
    return {
      category: 'server',
      userMessage: 'The cluster returned an internal error',
      suggestions: [
        'Check cluster health and API server status',
        'Try again in a few moments',
      ],
    };
  }

  return {
    category: 'unknown',
    userMessage: body.message || `Request failed (${status})`,
    suggestions: [],
  };
}

/**
 * Parse a non-OK fetch Response into a PulseError.
 * Reads the response body once and classifies the error.
 */
export async function parseK8sErrorResponse(
  response: Response,
  ctx: ErrorContext,
): Promise<PulseError> {
  if (response.status === 401) {
    useUIStore.getState().addDegradedReason('session_expired');
  }

  let body: K8sStatusResponse = {};
  let rawMessage = `${ctx.operation} failed: ${response.statusText}`;

  try {
    body = await response.json();
    rawMessage = body.message || rawMessage;
  } catch {
    // Response body wasn't JSON — use statusText
  }

  // Extract resource info from K8s status details
  const enrichedCtx: ErrorContext = {
    ...ctx,
    resourceKind: ctx.resourceKind || body.details?.kind,
    resourceName: ctx.resourceName || body.details?.name,
  };

  const { category, userMessage, suggestions } = classifyStatus(
    response.status,
    body,
    enrichedCtx,
  );

  return new PulseError({
    message: rawMessage,
    category,
    statusCode: response.status,
    k8sReason: body.reason,
    context: enrichedCtx,
    userMessage,
    suggestions,
  });
}

/**
 * Wrap a network-level error (fetch failure) into a PulseError.
 */
export function wrapNetworkError(
  error: unknown,
  ctx: ErrorContext,
): PulseError {
  const msg =
    error instanceof Error ? error.message : 'Network request failed';

  return new PulseError({
    message: msg,
    category: 'network',
    statusCode: 0,
    context: ctx,
    userMessage: 'Cannot reach the cluster API',
    suggestions: [
      'Check your network connection',
      'The API server may be down or restarting',
      'Verify oc proxy is running if in dev mode',
    ],
  });
}

/**
 * Classify an existing error. If it's already a PulseError, return it.
 * Otherwise wrap it as unknown.
 */
export function classifyError(
  error: unknown,
  ctx: ErrorContext,
): PulseError {
  if (error instanceof PulseError) return error;

  // Network errors (fetch failures)
  if (error instanceof TypeError && (error.message.includes('fetch') || error.message.includes('network'))) {
    return wrapNetworkError(error, ctx);
  }

  const msg = error instanceof Error ? error.message : String(error);
  return new PulseError({
    message: msg,
    category: 'unknown',
    statusCode: 0,
    context: ctx,
    userMessage: msg,
    suggestions: [],
  });
}
