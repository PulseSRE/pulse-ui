import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { FolderKanban, HelpCircle, Loader2, Shield, Globe, Server } from 'lucide-react';
import { cn } from '@/lib/utils';
import { k8sList } from '../../engine/query';
import type { ArgoAppProject } from '../../engine/types';
import { Card } from '../../components/primitives/Card';

export function ProjectsTab() {
  const { data: projects = [], isLoading, error } = useQuery({
    queryKey: ['argocd-appprojects'],
    queryFn: () => k8sList<ArgoAppProject>('/apis/argoproj.io/v1alpha1/appprojects'),
    refetchInterval: 30_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <HelpCircle className="w-10 h-10 text-red-500 mx-auto mb-2" />
          <p className="text-sm text-red-400">Failed to load AppProjects</p>
          <p className="text-xs text-slate-500 mt-1">{error instanceof Error ? error.message : 'Unknown error'}</p>
        </div>
      </div>
    );
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="text-center">
          <FolderKanban className="w-10 h-10 text-slate-600 mx-auto mb-2" />
          <p className="text-slate-400 text-sm">No AppProjects found</p>
          <p className="text-slate-500 text-xs mt-1">ArgoCD uses AppProjects to group applications and enforce access policies</p>
        </div>
      </div>
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
          <Card key={project.metadata.uid || project.metadata.name} className={cn('p-4', isDefault && 'border-violet-800/50')}>
            <div className="flex items-start justify-between mb-2">
              <div className="flex items-center gap-2">
                <FolderKanban className={cn('w-4 h-4', isDefault ? 'text-violet-400' : 'text-slate-400')} />
                <span className="text-sm font-medium text-slate-200">{project.metadata.name}</span>
                {isDefault && (
                  <span className="text-xs px-1.5 py-0.5 rounded-sm bg-violet-900/50 text-violet-300">default</span>
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
