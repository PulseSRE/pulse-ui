import React, { useState } from 'react';
import {
  FileText, ChevronDown, ChevronUp, AlertTriangle, CheckCircle,
  Target, Clock, Shield, Activity, Copy, Bot,
} from 'lucide-react';
import { Card } from '../../../components/primitives/Card';
import { formatRelativeTime } from '../../../engine/formatters';
import { useUIStore } from '../../../store/uiStore';
import type { Postmortem } from '../../../hooks/useIncidentLifecycle';

export type { Postmortem };

const INCIDENT_TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  crashloop: AlertTriangle,
  oom: Activity,
  security: Shield,
  node: Target,
};

export function PostmortemCard({
  postmortem,
  onInvestigate,
}: {
  postmortem: Postmortem;
  onInvestigate?: (query: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const IconComponent = INCIDENT_TYPE_ICONS[postmortem.incident_type] || FileText;

  const handleCopyMarkdown = () => {
    const md = [
      `# Postmortem: ${postmortem.incident_type}`,
      `**Plan:** ${postmortem.plan_id}`,
      `**Confidence:** ${Math.round(postmortem.confidence * 100)}%`,
      '',
      '## Timeline',
      postmortem.timeline || 'N/A',
      '',
      '## Root Cause',
      postmortem.root_cause || 'N/A',
      '',
      '## Contributing Factors',
      ...postmortem.contributing_factors.map((f) => `- ${f}`),
      '',
      '## Impact / Blast Radius',
      ...postmortem.blast_radius.map((r) => `- \`${r}\``),
      '',
      '## Actions Taken',
      ...postmortem.actions_taken.map((a) => `- ${a}`),
      '',
      '## Prevention Recommendations',
      ...postmortem.prevention.map((p) => `- ${p}`),
      '',
      '## Metrics Impact',
      postmortem.metrics_impact || 'N/A',
    ].join('\n');
    navigator.clipboard.writeText(md);
    useUIStore.getState().addToast({ type: 'success', title: 'Copied postmortem as Markdown' });
  };

  const handleInvestigate = () => {
    const query = `Investigate further: the postmortem for ${postmortem.incident_type} (plan ${postmortem.plan_id}) identified root cause "${postmortem.root_cause}". What else should we check or prevent?`;
    onInvestigate?.(query);
  };

  return (
    <Card>
      <button
        onClick={() => setExpanded((prev) => !prev)}
        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-slate-800/30 transition-colors text-left"
      >
        <IconComponent className="w-5 h-5 text-violet-400 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className="text-sm font-medium text-slate-200">
              {postmortem.incident_type.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
            </span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-800 text-slate-400 rounded-sm">
              {postmortem.plan_id}
            </span>
            {postmortem.confidence >= 0.8 && (
              <span className="text-xs px-1.5 py-0.5 bg-emerald-900/50 text-emerald-300 rounded-sm flex items-center gap-1">
                <CheckCircle className="w-3 h-3" />
                High confidence
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 line-clamp-2">
            {postmortem.root_cause || 'Root cause analysis pending...'}
          </p>
          <span className="text-xs text-slate-600 mt-1 inline-block">
            <Clock className="w-3 h-3 inline mr-1" />
            {formatRelativeTime(postmortem.generated_at)}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
        )}
      </button>
      {expanded && (
        <div className="px-4 pb-4 border-t border-slate-800 pt-3 space-y-4">
          {/* Action buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleCopyMarkdown}
              className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm transition-colors"
            >
              <Copy className="w-3 h-3" />
              Copy as Markdown
            </button>
            {onInvestigate && (
              <button
                onClick={handleInvestigate}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs bg-violet-600/20 hover:bg-violet-600/30 text-violet-300 rounded-sm transition-colors"
              >
                <Bot className="w-3 h-3" />
                Investigate Further
              </button>
            )}
          </div>

          {postmortem.timeline && (
            <Section title="Timeline" icon={Clock}>
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{postmortem.timeline}</p>
            </Section>
          )}

          {postmortem.root_cause && (
            <Section title="Root Cause" icon={Target}>
              <p className="text-xs text-slate-300 whitespace-pre-wrap">{postmortem.root_cause}</p>
            </Section>
          )}

          {postmortem.contributing_factors.length > 0 && (
            <Section title="Contributing Factors" icon={AlertTriangle}>
              <ul className="space-y-1">
                {postmortem.contributing_factors.map((f, i) => (
                  <li key={i} className="text-xs text-slate-400 flex items-start gap-1.5">
                    <span className="text-amber-500 mt-0.5">-</span>
                    {f}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {postmortem.blast_radius.length > 0 && (
            <Section title="Impact / Blast Radius" icon={Activity}>
              <div className="flex flex-wrap gap-1">
                {postmortem.blast_radius.map((r, i) => (
                  <span key={i} className="text-xs font-mono px-1.5 py-0.5 bg-red-900/30 text-red-300 rounded-sm border border-red-800/30">
                    {r}
                  </span>
                ))}
              </div>
            </Section>
          )}

          {postmortem.actions_taken.length > 0 && (
            <Section title="Actions Taken" icon={CheckCircle}>
              <ul className="space-y-1">
                {postmortem.actions_taken.map((a, i) => (
                  <li key={i} className="text-xs text-emerald-300 flex items-start gap-1.5">
                    <CheckCircle className="w-3 h-3 text-emerald-500 shrink-0 mt-0.5" />
                    {a}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {postmortem.prevention.length > 0 && (
            <Section title="Prevention Recommendations" icon={Shield}>
              <ul className="space-y-1">
                {postmortem.prevention.map((p, i) => (
                  <li key={i} className="text-xs text-slate-300 flex items-start gap-1.5">
                    <span className="text-violet-400 mt-0.5">-</span>
                    {p}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {postmortem.metrics_impact && (
            <Section title="Metrics Impact" icon={Activity}>
              <p className="text-xs text-slate-400">{postmortem.metrics_impact}</p>
            </Section>
          )}
        </div>
      )}
    </Card>
  );
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
        <Icon className="w-3 h-3" />
        {title}
      </h3>
      {children}
    </div>
  );
}
