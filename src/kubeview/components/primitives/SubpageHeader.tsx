import React from 'react';
import { PageHeader, type PageHeaderBack, type PageHeaderCrumb } from './PageHeader';
import { cn } from '@/lib/utils';
import { isMultiCluster } from '../../engine/clusterConnection';
import { clusterDisplayName } from '../../engine/pendingCluster';
import {
  detailPath, domainForGvrUrl, kindInSentence, listPath, pluralLabel,
} from '../../engine/subpageLinks';

export interface SubpageResource {
  /** URL form of the GVR: `apps~v1~deployments`, `v1~pods`. */
  gvrUrl: string;
  /** Display kind: `Deployment`. */
  kind: string;
  namespace?: string;
  /** The object's name. Omitted on Create, where the parent is the kind's list. */
  name?: string;
}

export interface SubpageHeaderProps {
  /** The subpage's name, the last crumb: "Logs", "Metrics", "YAML", "Create", "Node logs". */
  subpage: string;
  resource: SubpageResource;
  /** In-app navigation for a plain click: `useNavigateTab()`'s `go(path, title)`. */
  go: (path: string, title: string) => void;
  /** The `<h1>`. Defaults to "<Subpage>: <name>" ("Create <Kind>" when there is no name). */
  title?: React.ReactNode;
  icon?: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Extra badges after the namespace and cluster. */
  meta?: React.ReactNode;
  actions?: React.ReactNode;
  /** Replaces the default back (the parent resource, or the kind's list on Create). */
  back?: PageHeaderBack;
  /**
   * The cluster this subpage shows. Named in the header when more than one
   * cluster is connected, so the page says which cluster the links open on.
   */
  clusterId?: string;
  className?: string;
}

const BADGE = 'px-2 py-0.5 rounded-sm bg-slate-800 text-slate-300';

/**
 * The header for a page under one resource: a breadcrumb
 * (domain › kinds › name › subpage), the page's one `<h1>`, and a back link
 * to the parent named for where it goes ("Back to pod web-1").
 *
 * Built on PageHeader, so crumbs and back are real `<a href>` links: a plain
 * click navigates in the app (opening a tab), a modified or middle click is
 * left to the browser.
 */
export function SubpageHeader({
  subpage, resource, go, title, icon, subtitle, meta, actions, back, clusterId, className,
}: SubpageHeaderProps) {
  const { gvrUrl, kind, namespace, name } = resource;
  const domain = domainForGvrUrl(gvrUrl);
  const kinds = pluralLabel(kind);
  const listHref = listPath(gvrUrl, namespace);
  const listTitle = namespace ? `${kinds} (${namespace})` : kinds;

  const crumbs: PageHeaderCrumb[] = [];
  if (domain) crumbs.push({ label: domain.label, href: domain.path, onClick: () => go(domain.path, domain.label) });
  crumbs.push({ label: kinds, href: listHref, onClick: () => go(listHref, listTitle) });
  let parent: PageHeaderBack;
  if (name) {
    const href = detailPath(gvrUrl, namespace, name);
    crumbs.push({ label: name, href, onClick: () => go(href, name) });
    parent = { label: `${kindInSentence(kind)} ${name}`, href, onClick: () => go(href, name) };
  } else {
    parent = { label: kinds, href: listHref, onClick: () => go(listHref, listTitle) };
  }
  crumbs.push({ label: subpage });

  const showCluster = clusterId !== undefined && isMultiCluster();
  const hasMeta = Boolean(namespace) || showCluster || Boolean(meta);

  return (
    <PageHeader
      size="subpage"
      className={cn('px-4 py-3 border-b border-slate-700 shrink-0', className)}
      breadcrumb={crumbs}
      back={back ?? parent}
      icon={icon}
      title={title ?? (name ? `${subpage}: ${name}` : `${subpage} ${kind}`)}
      subtitle={subtitle}
      meta={hasMeta ? (
        <>
          {namespace && <span className={BADGE} title="Namespace">{namespace}</span>}
          {showCluster && <span className={cn(BADGE, 'text-blue-300')} title="Cluster">{clusterDisplayName(clusterId)}</span>}
          {meta}
        </>
      ) : undefined}
      actions={actions}
    />
  );
}
