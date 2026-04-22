import { useState, useEffect } from 'react';
import {
  Clock, User, Calendar, Tag, Bot, Loader2,
  ArrowRight, RotateCcw, Archive, Search, CheckCircle2, ShieldCheck,
  ChevronDown, ChevronRight, Play, SkipForward, XCircle, AlertTriangle,
  MessageSquare, RefreshCw,
} from 'lucide-react';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { Tooltip } from '../../components/primitives/Tooltip';
import { formatRelativeTime } from '../../engine/formatters';
import {
  fetchInboxInvestigation,
  type InboxItem,
  type InvestigationReport,
} from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';
import { InboxLifecycleStepper } from './InboxLifecycle';

// ---- Types ----

interface ActionPlanStep {
  title: string;
  description: string;
  tool: string | null;
  tool_input: Record<string, unknown> | null;
  risk: 'low' | 'medium' | 'high';
  status: 'pending' | 'running' | 'complete' | 'failed' | 'skipped';
}

// ---- Helpers ----

function formatDueDate(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildInvestigatePrompt(item: InboxItem): string {
  const resources = item.resources.map((r) => `${r.kind}/${r.name}`).join(', ');
  const ns = item.namespace ? ` in namespace ${item.namespace}` : '';
  return `Investigate: ${item.title}${ns}. ${item.summary || ''} Resources: ${resources}`.trim();
}

function buildStepPrompt(item: InboxItem, step: ActionPlanStep): string {
  const base = `Execute action plan step for "${item.title}": ${step.title}. ${step.description}`;
  if (step.tool && step.tool_input) {
    return `${base} Use tool ${step.tool} with input: ${JSON.stringify(step.tool_input)}`;
  }
  return base;
}

// ---- Collapsible Section ----

function CollapsibleSection({
  title,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  subtitle: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 text-left group"
      >
        {open
          ? <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          : <ChevronRight className="w-3.5 h-3.5 text-slate-500 shrink-0" />
        }
        <div className="min-w-0">
          <span className="text-xs font-medium text-slate-300 group-hover:text-slate-100 transition-colors">
            {title}
          </span>
          <p className="text-[10px] text-slate-600 leading-tight">{subtitle}</p>
        </div>
      </button>
      {open && <div className="mt-2 ml-5">{children}</div>}
    </div>
  );
}

// ---- Risk Badge ----

function RiskBadge({ risk }: { risk: 'low' | 'medium' | 'high' }) {
  const variant = risk === 'high' ? 'error' : risk === 'medium' ? 'warning' : 'success';
  return <Badge variant={variant} size="sm">{risk}</Badge>;
}

// ---- Step Status Icon ----

function StepStatusIcon({ status }: { status: ActionPlanStep['status'] }) {
  switch (status) {
    case 'complete':
      return <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />;
    case 'failed':
      return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
    case 'running':
      return <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />;
    case 'skipped':
      return <SkipForward className="w-4 h-4 text-slate-600 shrink-0" />;
    default:
      return <div className="w-4 h-4 rounded-full border-2 border-slate-600 shrink-0" />;
  }
}

// ---- Action Plan Section ----

function ActionPlanSection({
  steps,
  item,
  onClose,
}: {
  steps: ActionPlanStep[];
  item: InboxItem;
  onClose: () => void;
}) {
  const [stepStatuses, setStepStatuses] = useState<Record<number, ActionPlanStep['status']>>({});

  const getStatus = (idx: number) => stepStatuses[idx] || steps[idx]?.status || 'pending';
  const setStatus = (idx: number, status: ActionPlanStep['status']) => {
    setStepStatuses((prev) => ({ ...prev, [idx]: status }));
  };

  const advanceToInProgress = () => {
    if (item.status === 'claimed') {
      useInboxStore.getState().advanceStatus(item.id, 'in_progress');
    }
  };

  const openAgentWithPrompt = (prompt: string, stepIdx: number) => {
    setStatus(stepIdx, 'running');
    advanceToInProgress();
    useAgentStore.getState().connectAndSend(prompt);
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
    onClose();
  };

  return (
    <div className="rounded-lg border border-emerald-800/50 bg-emerald-950/20 p-3 space-y-3">
      <div>
        <div className="flex items-center gap-2 text-xs font-medium text-emerald-400">
          <Play className="w-3.5 h-3.5" />
          Action Plan
        </div>
        <p className="text-[10px] text-slate-600 mt-0.5 ml-5">How to fix it</p>
      </div>

      <ol className="space-y-2">
        {steps.map((step, idx) => {
          const status = getStatus(idx);
          const isDone = status === 'complete' || status === 'skipped';
          const isFailed = status === 'failed';
          const isRunning = status === 'running';
          const canAct = status === 'pending';

          return (
            <li
              key={idx}
              className={`rounded-md border p-2.5 space-y-1.5 ${
                isFailed
                  ? 'border-red-800/50 bg-red-950/10'
                  : isDone
                    ? 'border-slate-700/30 bg-slate-900/30 opacity-60'
                    : isRunning
                      ? 'border-blue-800/50 bg-blue-950/10'
                      : 'border-slate-700/50 bg-slate-900/50'
              }`}
            >
              <div className="flex items-start gap-2">
                <span className="text-xs font-mono text-slate-600 mt-0.5 shrink-0 w-4 text-right">
                  {idx + 1}.
                </span>
                <StepStatusIcon status={status} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-sm font-medium ${isDone ? 'text-slate-500 line-through' : 'text-slate-200'}`}>
                      {step.title}
                    </span>
                    <RiskBadge risk={step.risk} />
                    {step.tool && (
                      <Tooltip content={`Tool: ${step.tool}`}>
                        <Badge variant="outline" size="sm" className="font-mono">
                          {step.tool}
                        </Badge>
                      </Tooltip>
                    )}
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">{step.description}</p>
                </div>
              </div>

              {canAct && (
                <div className="flex items-center gap-1.5 ml-10">
                  {step.tool ? (
                    <Tooltip content="Open agent chat with tool context pre-filled">
                      <Button
                        size="sm"
                        onClick={() => openAgentWithPrompt(buildStepPrompt(item, step), idx)}
                      >
                        <Play className="w-3 h-3" />
                        Execute
                      </Button>
                    </Tooltip>
                  ) : (
                    <Tooltip content="Ask the agent to help with this step">
                      <Button
                        size="sm"
                        onClick={() => openAgentWithPrompt(buildStepPrompt(item, step), idx)}
                      >
                        <MessageSquare className="w-3 h-3" />
                        Ask Agent
                      </Button>
                    </Tooltip>
                  )}
                  <Tooltip content="Skip this step">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setStatus(idx, 'skipped');
                        useUIStore.getState().addToast({ type: 'success', title: `Skipped: ${step.title}` });
                      }}
                    >
                      <SkipForward className="w-3 h-3" />
                      Skip
                    </Button>
                  </Tooltip>
                </div>
              )}
            </li>
          );
        })}
      </ol>

      <div className="text-[10px] text-slate-600 flex items-center gap-1">
        <span>{steps.filter((_, i) => getStatus(i) === 'complete').length}/{steps.length} steps complete</span>
      </div>
    </div>
  );
}

// ---- Investigation Card ----

function InvestigationCard({ report }: { report: InvestigationReport }) {
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const confidencePct = Math.round(report.confidence * 100);

  return (
    <div className="rounded-lg border border-blue-800/50 bg-blue-950/20 p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-blue-400">
        <Search className="w-3.5 h-3.5" />
        Investigation Results
        <span className="ml-auto text-slate-500">{confidencePct}% confidence</span>
      </div>
      <div className="w-full bg-slate-800 rounded-full h-1.5">
        <div
          className="bg-blue-500 h-1.5 rounded-full transition-all"
          style={{ width: `${confidencePct}%` }}
        />
      </div>
      {report.summary && (
        <p className="text-sm text-slate-300">{report.summary}</p>
      )}
      {report.suspected_cause && (
        <div className="text-sm">
          <span className="text-slate-500">Suspected cause: </span>
          <span className="text-amber-300">{report.suspected_cause}</span>
        </div>
      )}
      {report.recommended_fix && (
        <div className="text-sm">
          <span className="text-slate-500">Recommended: </span>
          <span className="text-emerald-300">{report.recommended_fix}</span>
        </div>
      )}
      {report.evidence?.length > 0 && (
        <div>
          <button
            onClick={() => setEvidenceOpen(!evidenceOpen)}
            className="text-xs text-slate-500 hover:text-slate-300 transition-colors"
          >
            {evidenceOpen ? 'Hide' : 'Show'} evidence ({report.evidence.length})
          </button>
          {evidenceOpen && (
            <ul className="mt-1 space-y-1 text-xs text-slate-400">
              {report.evidence.map((e, i) => (
                <li key={i} className="flex items-start gap-1.5">
                  <span className="text-slate-600 mt-0.5">&#8226;</span>
                  <span>{e}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ---- Main Component ----

export function TaskDetailDrawer({
  item,
  onClose,
}: {
  item: InboxItem;
  onClose: () => void;
}) {
  const resolve = useInboxStore((s) => s.resolve);
  const claim = useInboxStore((s) => s.claim);
  const dismiss = useInboxStore((s) => s.dismiss);
  const restore = useInboxStore((s) => s.restore);
  const advanceStatus = useInboxStore((s) => s.advanceStatus);
  const refresh = useInboxStore((s) => s.refresh);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);

  const [investigation, setInvestigation] = useState<InvestigationReport | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (item.metadata?.investigation_id) {
      fetchInboxInvestigation(item.id)
        .then((report) => { if (!cancelled) setInvestigation(report); })
        .catch(() => { if (!cancelled) setInvestigation(null); });
    } else {
      setInvestigation(null);
    }
    return () => { cancelled = true; };
  }, [item.id, item.metadata?.investigation_id]);

  const triaged = !!item.metadata?.triaged;
  const triageAssessment = String(item.metadata?.triage_assessment || '');
  const triageAction = String(item.metadata?.triage_action || 'monitor');
  const triageUrgency = String(item.metadata?.triage_urgency || 'can-wait');
  const dismissReason = String(item.metadata?.dismiss_reason || '');
  const actionPlan = (item.metadata?.action_plan ?? null) as ActionPlanStep[] | null;
  const blastRadius = item.metadata?.blast_radius as Record<string, unknown> | undefined;
  const agentError = String(item.metadata?.agent_error || '');

  const handleInvestigate = () => {
    if (item.status === 'claimed') advanceStatus(item.id, 'in_progress');
    useAgentStore.getState().connectAndSend(buildInvestigatePrompt(item));
    onClose();
    const uiState = useUIStore.getState();
    uiState.expandAISidebar();
    uiState.setAISidebarMode('chat');
    if (window.innerWidth < 1200) {
      uiState.setActiveTab('agent');
    }
  };

  const handleAdvance = (status: string) => advanceStatus(item.id, status);

  return (
    <DrawerShell title={item.title} onClose={onClose}>
      <div className="space-y-4 p-4">
        <InboxLifecycleStepper itemType={item.item_type} status={item.status} />

        {item.view_id && (
          <a
            href={`/custom/${item.view_id}`}
            onClick={() => {
              if (item.status === 'claimed') advanceStatus(item.id, 'in_progress');
            }}
            className="flex items-center gap-2 w-full rounded-lg border border-blue-800/50 bg-blue-950/30 px-3 py-2.5 text-sm font-medium text-blue-300 hover:bg-blue-900/30 transition-colors"
          >
            <Search className="w-4 h-4" />
            Open Investigation View
            <ArrowRight className="w-4 h-4 ml-auto" />
          </a>
        )}

        {String(item.metadata?.view_status || '') === 'generating' && !item.view_id && (
          <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/50 px-3 py-2.5 text-sm text-slate-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            Building investigation view...
          </div>
        )}

        {String(item.metadata?.view_status || '') === 'failed' && !item.view_id && (
          <div className="flex items-center justify-between rounded-lg border border-red-800/50 bg-red-950/20 px-3 py-2.5 text-sm text-red-400">
            <span>View generation failed</span>
            <Button size="sm" variant="ghost" onClick={() => { advanceStatus(item.id, 'acknowledged'); claim(item.id); }}>
              Retry
            </Button>
          </div>
        )}

        {item.status === 'agent_cleared' && dismissReason && (
          <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-slate-400 mb-1">
              <ShieldCheck className="w-3.5 h-3.5" />
              Agent cleared this item
            </div>
            <p className="text-sm text-slate-300">{dismissReason}</p>
          </div>
        )}

        {item.status === 'agent_reviewing' && (
          <div className="rounded-lg border border-violet-800/50 bg-violet-950/30 p-3 flex items-center gap-3">
            <Loader2 className="w-4 h-4 text-violet-400 animate-spin" />
            <span className="text-sm text-violet-300">Agent is investigating this item...</span>
          </div>
        )}

        {item.status === 'agent_review_failed' && (
          <div className="rounded-lg border border-red-800/50 bg-red-950/30 p-3 space-y-2">
            <div className="flex items-center gap-2 text-xs font-medium text-red-400">
              <AlertTriangle className="w-3.5 h-3.5" />
              Agent analysis failed
            </div>
            {agentError && (
              <p className="text-sm text-slate-400">{agentError}</p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {item.namespace && (
            <Badge variant="outline">
              <Tag className="w-3 h-3 mr-1" />
              {item.namespace}
            </Badge>
          )}
        </div>

        {/* AI Triage — collapsible */}
        {triaged && (
          <CollapsibleSection
            title="AI Triage"
            subtitle="How urgent is this?"
          >
            <div className="rounded-lg border border-violet-800/50 bg-violet-950/30 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-violet-400">
                <Bot className="w-3.5 h-3.5" />
                AI Triage
              </div>
              {triageAssessment && (
                <p className="text-sm text-slate-300">{triageAssessment}</p>
              )}
              <div className="flex items-center gap-3 text-xs">
                <Badge variant={
                  triageAction === 'investigate' ? 'warning' :
                  triageAction === 'dismiss' ? 'info' : 'default'
                }>
                  {triageAction}
                </Badge>
                <Badge variant={
                  triageUrgency === 'immediate' ? 'error' :
                  triageUrgency === 'soon' ? 'warning' : 'default'
                }>
                  {triageUrgency}
                </Badge>
              </div>
            </div>
          </CollapsibleSection>
        )}

        {/* Investigation — collapsible */}
        {investigation && (
          <CollapsibleSection
            title="Investigation"
            subtitle="What's the root cause?"
          >
            <InvestigationCard report={investigation} />
          </CollapsibleSection>
        )}

        {/* Action Plan — always expanded when present */}
        {actionPlan && actionPlan.length > 0 && (
          <ActionPlanSection steps={actionPlan} item={item} onClose={onClose} />
        )}

        {/* Blast Radius — collapsible */}
        {blastRadius && (
          <CollapsibleSection
            title="Blast Radius"
            subtitle="What else could be affected?"
          >
            <div className="rounded-lg border border-amber-800/50 bg-amber-950/20 p-3 space-y-2">
              <div className="flex items-center gap-2 text-xs font-medium text-amber-400">
                <AlertTriangle className="w-3.5 h-3.5" />
                Blast Radius
              </div>
              {typeof blastRadius.summary === 'string' && blastRadius.summary && (
                <p className="text-sm text-slate-300">{blastRadius.summary}</p>
              )}
              {Array.isArray(blastRadius.affected) && blastRadius.affected.length > 0 && (
                <ul className="space-y-1 text-xs text-slate-400">
                  {(blastRadius.affected as Array<{ kind?: string; name?: string }>).map((a, i) => (
                    <li key={i} className="flex items-start gap-1.5">
                      <span className="text-amber-600 mt-0.5">&#8226;</span>
                      <span>{a.kind ? `${a.kind}/` : ''}{a.name || String(a)}</span>
                    </li>
                  ))}
                </ul>
              )}
              {blastRadius.score != null && (
                <div className="text-xs text-slate-500">
                  Impact score: <span className="text-amber-300">{String(blastRadius.score)}</span>
                </div>
              )}
            </div>
          </CollapsibleSection>
        )}

        {item.summary && !triageAssessment && (
          <p className="text-sm text-slate-400 leading-relaxed">{item.summary}</p>
        )}

        <div className="space-y-2 text-sm text-slate-500">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>Created {formatRelativeTime(item.created_at * 1000)}</span>
          </div>
          {item.due_date && (
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>Due {formatDueDate(item.due_date)}</span>
            </div>
          )}
          {item.claimed_by && (
            <div className="flex items-center gap-2">
              <User className="w-4 h-4" />
              <span>Claimed by {item.claimed_by}</span>
            </div>
          )}
        </div>

        {item.resources.length > 0 && (
          <div>
            <h3 className="text-xs font-medium text-slate-500 uppercase mb-2">Resources</h3>
            <div className="space-y-1">
              {item.resources.map((r, i) => (
                <div key={i} className="text-sm text-slate-400">
                  {r.kind}/{r.name}
                  {r.namespace && <span className="text-slate-600 ml-1">({r.namespace})</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Forward buttons — simplified lifecycle */}
        <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-800">
          {item.status === 'new' && (
            <Button size="sm" onClick={handleInvestigate}>
              <Bot className="w-4 h-4 mr-1" />
              Investigate with AI
            </Button>
          )}

          {item.status === 'agent_reviewing' && (
            <>
              <Button size="sm" variant="ghost" onClick={() => { advanceStatus(item.id, 'triaged'); claim(item.id); }}>
                <CheckCircle2 className="w-4 h-4 mr-1" />
                Skip AI — Claim Now
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                <Archive className="w-4 h-4 mr-1" />
                Dismiss
              </Button>
            </>
          )}

          {item.status === 'agent_review_failed' && (
            <>
              <Button size="sm" onClick={() => handleAdvance('new')}>
                <RefreshCw className="w-4 h-4 mr-1" />
                Retry Agent Analysis
              </Button>
              <Button size="sm" variant="ghost" onClick={handleInvestigate}>
                <MessageSquare className="w-4 h-4 mr-1" />
                Investigate Manually
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                <Archive className="w-4 h-4 mr-1" />
                Dismiss
              </Button>
            </>
          )}

          {item.status === 'agent_cleared' && (
            <>
              <Button size="sm" onClick={() => restore(item.id)}>
                <RotateCcw className="w-4 h-4 mr-1" />
                Restore to Inbox
              </Button>
              <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                <Archive className="w-4 h-4 mr-1" />
                Archive
              </Button>
            </>
          )}

          {item.status === 'triaged' && (
            <>
              <Tooltip content="Take ownership — the agent will generate an investigation view for you">
                <Button size="sm" onClick={() => claim(item.id)}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Claim
                </Button>
              </Tooltip>
              <Tooltip content="Open the agent chat to investigate interactively">
                <Button size="sm" variant="ghost" onClick={handleInvestigate}>
                  <Bot className="w-4 h-4 mr-1" />
                  Deep Dive
                </Button>
              </Tooltip>
              <Tooltip content="Archive — will be deleted after 30 days">
                <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                  <Archive className="w-4 h-4 mr-1" />
                  Dismiss
                </Button>
              </Tooltip>
            </>
          )}

          {item.status === 'claimed' && (
            <>
              <Tooltip content="Open the agent chat to investigate interactively">
                <Button size="sm" onClick={handleInvestigate}>
                  <Bot className="w-4 h-4 mr-1" />
                  Deep Dive
                </Button>
              </Tooltip>
              <Tooltip content="Mark as resolved">
                <Button size="sm" variant="ghost" onClick={() => resolve(item.id)}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Resolve
                </Button>
              </Tooltip>
              <Tooltip content="Archive — will be deleted after 30 days">
                <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                  <Archive className="w-4 h-4 mr-1" />
                  Dismiss
                </Button>
              </Tooltip>
            </>
          )}

          {item.status === 'in_progress' && (
            <>
              <Tooltip content="Mark this item as resolved">
                <Button size="sm" onClick={() => resolve(item.id)}>
                  <CheckCircle2 className="w-4 h-4 mr-1" />
                  Resolve
                </Button>
              </Tooltip>
              <Tooltip content="Open the agent chat for help">
                <Button size="sm" variant="ghost" onClick={handleInvestigate}>
                  <Bot className="w-4 h-4 mr-1" />
                  Deep Dive
                </Button>
              </Tooltip>
              <Tooltip content="Archive — will be deleted after 30 days">
                <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
                  <Archive className="w-4 h-4 mr-1" />
                  Dismiss
                </Button>
              </Tooltip>
            </>
          )}

          {item.status === 'resolved' && (
            <Button size="sm" variant="ghost" onClick={() => dismiss(item.id)}>
              <Archive className="w-4 h-4 mr-1" />
              Archive
            </Button>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}
