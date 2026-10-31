/**
 * Classify links that arrive from the agent (generated components, activity
 * feeds, table cells) so renderers can follow internal ones through the router,
 * open external ones safely, and refuse ones that lead nowhere.
 */
import { isExternalUrl, isKnownRoute } from './routeTable';

/**
 * Links older agents still emit for pages the UI has since moved. The
 * Incidents page became the Inbox activity tab; agents up to v2.36 send
 * `/incidents`, `/incidents?tab=actions` and `/incidents?tab=postmortems`.
 */
export function normalizeAgentLink(link: string): string {
  const trimmed = link.trim();
  if (/^\/incidents(?:[/?#]|$)/.test(trimmed)) return '/inbox?tab=activity';
  return trimmed;
}

export type AgentLink =
  | { kind: 'internal'; to: string }
  | { kind: 'external'; href: string }
  | { kind: 'invalid'; raw: string };

export function classifyAgentLink(link: unknown): AgentLink {
  if (typeof link !== 'string' || !link.trim()) return { kind: 'invalid', raw: String(link ?? '') };
  if (isExternalUrl(link)) return { kind: 'external', href: link.trim() };
  const to = normalizeAgentLink(link);
  return isKnownRoute(to) ? { kind: 'internal', to } : { kind: 'invalid', raw: link };
}

/** Tooltip for a link Pulse will not follow. */
export function invalidLinkTitle(raw: string): string {
  return `Pulse has no page at ${raw}`;
}

/** Open an external URL in a new tab without giving it access to this window. */
export function openExternal(href: string): void {
  window.open(href, '_blank', 'noopener,noreferrer');
}
