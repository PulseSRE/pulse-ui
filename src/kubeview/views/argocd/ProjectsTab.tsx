import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Loader2, Shield, Globe, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../../engine/query';
import type { ArgoAppProject } from '../../engine/types';
import { Card } from '../../components/primitives/Card';
import { LoadError } from '../../components/primitives/LoadError';
import { EmptyState } from '../../components/primitives/EmptyState';
import { useActiveClusterId } from '../../hooks/useClusterBase';

export function ProjectsTab() {
  const clusterId = useActiveClusterId();
  const { data: projects = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: ['argocd-appprojects', clusterId],
    queryFn: () => k8sList<ArgoAppProject>('/apis/argoproj.io/v1alpha1/appprojects', undefined, clusterId),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 h-48 text-sm text-slate-400" role="status" aria-live="polite">
        <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
        Checking AppProjects…
      </div>
    );
  }

  // A failed or forbidden read is not "no AppProjects".
  if (isError) {
    return <LoadError title="AppProjects could not be loaded" error={error} onRetry={() => { void refetch(); }} />;
  }

  if (projects.length === 0) {
    return (
      <EmptyState
        icon={<FolderKanban className="w-8 h-8" />}
        title="No AppProjects"
        description="Argo CD uses AppProjects to group applications and limit where they deploy. Create one with argocd proj create or an AppProject manifest; apps without one use the default project."
      />
    );
  }

  // Sort so "default" project appears first
  const sorted = [...projects].sort((a, b) => {
    if (a.metadata.name === 'default') return -1;
    if (b.metadata.name === 'default') return 1;
    return a.metadata.name.localeCompare(b.metadata.name);
  });

  return (
    <div className="space-y-3">
      {sorted.map((project) => {
        const isDefault = project.metadata.name === 'default';
        const sourceRepos = project.spec?.sourceRepos || [];
        const destinations = project.spec?.destinations || [];
        const roles = project.spec?.roles || [];
        const description = project.spec?.description;

        return (
          <Card key={project.metadata.uid || project.metadata.name} className={cn('p-4', isDefault && 'border-blue-800/50')}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <FolderKanban className={cn('w-4 h-4', isDefault ? 'text-blue-400' : 'text-slate-400')} />
                <span className="text-sm font-medium text-slate-200">{project.metadata.name}</span>
                {isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded-sm bg-blue-900/50 text-blue-300">default</span>
                )}
              </div>
              {roles.length > 0 && (
                <span className="text-xs text-slate-500 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> {roles.length} role{roles.length !== 1 ? 's' : ''}
                </span>
              )}
            </div>

            {description && (
              <p className="text-xs text-slate-400 mb-3">{description}</p>
            )}

            <div className="space-y-2">
              {/* Source repos */}
              <div>
                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Globe className="w-3 h-3" /> Source Repositories
                </div>
                {sourceRepos.length === 0 ? (
                  <span className="text-xs text-slate-600">None configured</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {sourceRepos.slice(0, 6).map((repo, i) => (
                      <span key={i} className="text-xs font-mono px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400 truncate max-w-xs" title={repo}>
                        {repo === '*' ? '* (all)' : repo.replace(/^https?:\/\//, '').replace(/\.git$/, '')}
                      </span>
                    ))}
                    {sourceRepos.length > 6 && (
                      <span className="text-xs text-slate-600">+{sourceRepos.length - 6} more</span>
                    )}
                  </div>
                )}
              </div>

              {/* Destinations */}
              <div>
                <div className="text-xs text-slate-500 mb-1 flex items-center gap-1">
                  <Server className="w-3 h-3" /> Destinations
                </div>
                {destinations.length === 0 ? (
                  <span className="text-xs text-slate-600">None configured</span>
                ) : (
                  <div className="flex flex-wrap gap-1.5">
                    {destinations.slice(0, 8).map((dest, i) => {
                      const label = [
                        dest.namespace || '*',
                        dest.server ? `@ ${dest.server.replace(/^https?:\/\//, '')}` : dest.name ? `@ ${dest.name}` : '',
                      ].filter(Boolean).join(' ');
                      return (
                        <span key={i} className="text-xs font-mono px-1.5 py-0.5 rounded-sm bg-slate-800 text-slate-400" title={`${dest.server || dest.name || ''} / ${dest.namespace || '*'}`}>
                          {label}
                        </span>
                      );
                    })}
                    {destinations.length > 8 && (
                      <span className="text-xs text-slate-600">+{destinations.length - 8} more</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
