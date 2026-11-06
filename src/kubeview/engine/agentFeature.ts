/**
 * "This agent does not have that endpoint" is an answer, not an error.
 *
 * The UI ships independently of the agent. A route an older agent lacks
 * answers 404 (FastAPI's own `{"detail": "Not Found"}`) or 405 (a sibling
 * route with another method matched the path). Pages that use a newer agent
 * endpoint catch this and hide the feature with a sentence saying why,
 * instead of showing an error or, worse, an empty result.
 */
export class AgentFeatureUnavailable extends Error {
  constructor(public readonly feature: string) {
    super(`${feature} is not available on this Pulse agent; it needs a newer agent version.`);
    this.name = 'AgentFeatureUnavailable';
  }
}

export function isAgentFeatureUnavailable(e: unknown): e is AgentFeatureUnavailable {
  return e instanceof AgentFeatureUnavailable;
}

/** A failed agent response with the server's own reason when it gave one. */
export class AgentRequestError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'AgentRequestError';
  }
}

export async function readAgentError(res: Response, what: string): Promise<AgentRequestError> {
  let detail = '';
  try {
    const body = await res.json();
    if (body && typeof body.detail === 'string') detail = body.detail;
  } catch {
    // Not JSON: fall back to the status line.
  }
  return new AgentRequestError(res.status, `${what}: ${detail || `${res.status} ${res.statusText}`.trim()}`);
}
