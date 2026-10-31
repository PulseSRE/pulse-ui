/**
 * Links supplied by the agent. Internal paths go through the router (no full
 * reload, so the dock, chat and tabs survive); http(s) URLs open in a new tab
 * without access to this window; anything the router has no page for is shown
 * as plain text with a tooltip instead of bouncing the user somewhere else.
 */
import React, { useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { classifyAgentLink, invalidLinkTitle, openExternal, type AgentLink as AgentLinkTarget } from '../../engine/agentLinks';

export interface AgentLinkBehaviour {
  target: AgentLinkTarget;
  /** undefined when there is nothing to follow */
  onClick: (() => void) | undefined;
  /** tooltip explaining why a supplied link is not clickable */
  title: string | undefined;
}

/** For clickable cards: decide whether `link` can be followed, and how. */
export function useAgentLink(link: unknown): AgentLinkBehaviour {
  const navigate = useNavigate();
  const target = useMemo(() => classifyAgentLink(link), [link]);
  const hasLink = typeof link === 'string' && link.trim() !== '';
  const follow = useCallback(() => {
    if (target.kind === 'internal') navigate(target.to);
    else if (target.kind === 'external') openExternal(target.href);
  }, [navigate, target]);
  return {
    target,
    onClick: target.kind === 'invalid' ? undefined : follow,
    title: hasLink && target.kind === 'invalid' ? invalidLinkTitle(target.raw) : undefined,
  };
}

export function AgentLink({
  link,
  className,
  title,
  children,
}: {
  link: unknown;
  className?: string;
  title?: string;
  children: React.ReactNode;
}) {
  const target = classifyAgentLink(link);
  if (target.kind === 'internal') {
    // A link inside a clickable table row must not also trigger the row.
    return <Link to={target.to} className={className} title={title} onClick={(e) => e.stopPropagation()}>{children}</Link>;
  }
  if (target.kind === 'external') {
    return (
      <a href={target.href} target="_blank" rel="noopener noreferrer" className={className} title={title} onClick={(e) => e.stopPropagation()}>
        {children}
      </a>
    );
  }
  return (
    <span className={className} title={invalidLinkTitle(target.raw)} aria-disabled="true" data-invalid-link="">
      {children}
    </span>
  );
}
