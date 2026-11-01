/**
 * Alert rule detail: the expression, its `for` duration, labels and
 * annotations, the PrometheusRule object that defines it (when the rule comes
 * from one), and ways to act on it — edit the object, silence it, or ask
 * Pulse to investigate.
 */
import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bot, Copy, FileCode, VolumeX } from 'lucide-react';
import { k8sList } from '../../engine/query';
import { METRICS_CLUSTER_ID } from '../../components/metrics/prometheus';
import { askPulse } from '../../engine/askPulse';
import { copyToClipboard } from '../../engine/clipboard';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import { Button } from '../../components/primitives/Button';
import { Badge } from '../../components/primitives/Badge';

export interface RuleDetail {
  name: string;
  group: string;
  state: string;
  severity: string;
  query: string;
  alertCount: number;
  duration?: number;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

interface PrometheusRuleObject {
  metadata: { name: string; namespace: string };
  spec?: { groups?: Array<{ name: string; rules?: Array<{ alert?: string; record?: string }> }> };
}

/** The PrometheusRule that defines `alert` in `group`, if one does. */
export function findPrometheusRule(rules: PrometheusRuleObject[], group: string, alert: string): PrometheusRuleObject | undefined {
  return rules.find((r) => (r.spec?.groups ?? []).some((g) => g.name === group && (g.rules ?? []).some((x) => x.alert === alert)));
}

function formatFor(seconds?: number): string {
  if (!seconds) return 'immediately';
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

export function RuleDetailDrawer({ rule, onClose, go, onSilence }: {
  rule: RuleDetail;
  onClose: () => void;
  go: (path: string, title: string) => void;
  onSilence: (labels: Record<string, string>) => void;
}) {
  // Rules are evaluated by the local cluster's Prometheus; its PrometheusRules live there too.
  const { data: promRules, error } = useQuery<PrometheusRuleObject[]>({
    queryKey: ['alerts', 'prometheusrules', METRICS_CLUSTER_ID],
    queryFn: () => k8sList<PrometheusRuleObject>('/apis/monitoring.coreos.com/v1/prometheusrules', undefined, METRICS_CLUSTER_ID),
    staleTime: 120000,
    retry: false,
  });
  const owner = promRules ? findPrometheusRule(promRules, rule.group, rule.name) : undefined;

  return (
    <DrawerShell title={rule.name} onClose={onClose}>
      <div className="space-y-5 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <Badge size="sm" variant={rule.severity === 'critical' ? 'error' : rule.severity === 'info' ? 'info' : 'warning'}>{rule.severity}</Badge>
          <Badge size="sm" variant={rule.alertCount > 0 ? 'error' : 'success'}>{rule.alertCount > 0 ? `${rule.alertCount} firing` : rule.state || 'inactive'}</Badge>
          <span className="text-xs text-slate-500">group {rule.group} · fires after {formatFor(rule.duration)}</span>
        </div>

        <section>
          <h3 className="text-xs font-semibold text-slate-400 mb-1">Expression</h3>
          <pre className="text-xs font-mono text-slate-200 bg-slate-900 border border-slate-800 rounded p-3 whitespace-pre-wrap break-all" aria-label="Rule expression">{rule.query}</pre>
        </section>

        <section>
          <h3 className="text-xs font-semibold text-slate-400 mb-1">Labels</h3>
          {Object.keys(rule.labels).length === 0 ? <p className="text-xs text-slate-500">None</p> : (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
              {Object.entries(rule.labels).map(([k, v]) => (<Fragment key={k}><dt className="text-slate-500 font-mono">{k}</dt><dd className="text-slate-300 font-mono break-all">{v}</dd></Fragment>))}
            </dl>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold text-slate-400 mb-1">Annotations</h3>
          {Object.keys(rule.annotations).length === 0 ? <p className="text-xs text-slate-500">None</p> : (
            <dl className="space-y-2 text-xs">
              {Object.entries(rule.annotations).map(([k, v]) => (
                <div key={k}><dt className="text-slate-500 font-mono">{k}</dt><dd className="text-slate-300 whitespace-pre-wrap break-words">{v}</dd></div>
              ))}
            </dl>
          )}
        </section>

        <section>
          <h3 className="text-xs font-semibold text-slate-400 mb-1">Defined in</h3>
          {error ? (
            <p className="text-xs text-slate-500">PrometheusRule objects could not be listed ({error instanceof Error ? error.message : String(error)}).</p>
          ) : !promRules ? (
            <p className="text-xs text-slate-500">Looking up the PrometheusRule…</p>
          ) : owner ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="link" onClick={() => go(`/r/monitoring.coreos.com~v1~prometheusrules/${owner.metadata.namespace}/${owner.metadata.name}`, owner.metadata.name)}>
                PrometheusRule {owner.metadata.namespace}/{owner.metadata.name}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => go(`/yaml/monitoring.coreos.com~v1~prometheusrules/${owner.metadata.namespace}/${owner.metadata.name}`, `Edit ${owner.metadata.name}`)}>
                <FileCode className="w-3.5 h-3.5" /> Edit rule YAML
              </Button>
            </div>
          ) : (
            <p className="text-xs text-slate-500">No PrometheusRule object defines this rule — it comes from Prometheus configuration, so it cannot be edited here.</p>
          )}
        </section>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-slate-800">
          <Button size="sm" onClick={() => askPulse(`Investigate the alert rule ${rule.name} (group ${rule.group}, severity ${rule.severity}). Expression: ${rule.query}. ${rule.alertCount > 0 ? `It is firing for ${rule.alertCount} series — find the cause.` : 'It is not firing — explain what it watches and whether its threshold is sensible.'}`)}>
            <Bot className="w-3.5 h-3.5" /> Investigate with Pulse
          </Button>
          <Button size="sm" variant="secondary" onClick={() => { onSilence({ alertname: rule.name }); onClose(); }}>
            <VolumeX className="w-3.5 h-3.5" /> Silence this rule
          </Button>
          <Button size="sm" variant="ghost" onClick={() => copyToClipboard(rule.query, 'PromQL copied')}>
            <Copy className="w-3.5 h-3.5" /> Copy PromQL
          </Button>
        </div>
      </div>
    </DrawerShell>
  );
}
