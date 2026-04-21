import { Clock, User, Calendar, Tag, ArrowUpCircle, Bot } from 'lucide-react';
import { DrawerShell } from '../../components/primitives/DrawerShell';
import { Badge } from '../../components/primitives/Badge';
import { Button } from '../../components/primitives/Button';
import { formatRelativeTime } from '../../engine/formatters';
import { escalateInboxItem } from '../../engine/inboxApi';
import type { InboxItem } from '../../engine/inboxApi';
import { useInboxStore } from '../../store/inboxStore';
import { useAgentStore } from '../../store/agentStore';
import { useUIStore } from '../../store/uiStore';

function formatDueDate(ts: number): string {
  const date = new Date(ts * 1000);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function buildInvestigatePrompt(item: InboxItem): string {
  const resources = item.resources.map((r) => `${r.kind}/${r.name}`).join(', ');
  const ns = item.namespace ? ` in namespace ${item.namespace}` : '';
  return `Investigate: ${item.title}${ns}. ${item.summary || ''} Resources: ${resources}`.trim();
}

export function TaskDetailDrawer({
  item,
  onClose,
}: {
  item: InboxItem;
  onClose: () => void;
}) {
  const resolve = useInboxStore((s) => s.resolve);
  const claim = useInboxStore((s) => s.claim);
  const refresh = useInboxStore((s) => s.refresh);
  const setSelectedItem = useInboxStore((s) => s.setSelectedItem);

  const handleEscalate = async () => {
    try {
      const result = await escalateInboxItem(item.id);
      refresh();
      if (result.finding_id) {
        setSelectedItem(result.finding_id);
      }
    } catch {
      /* handled by toast */
    }
  };

  const handleInvestigate = () => {
    const prompt = buildInvestigatePrompt(item);
    useAgentStore.getState().connectAndSend(prompt);
    useUIStore.getState().expandAISidebar();
    useUIStore.getState().setAISidebarMode('chat');
    onClose();
  };

  return (
    <DrawerShell title={item.title} onClose={onClose}>
      <div className="space-y-4 p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge variant="outline" className="capitalize">{item.status.replace('_', ' ')}</Badge>
          {item.namespace && (
            <Badge variant="outline">
              <Tag className="w-3 h-3 mr-1" />
              {item.namespace}
            </Badge>
          )}
        </div>

        {item.summary && (
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

        <div className="flex flex-wrap gap-2 pt-4 border-t border-slate-800">
          <Button size="sm" onClick={handleInvestigate}>
            <Bot className="w-4 h-4 mr-1" />
            Investigate with AI
          </Button>
          {!item.claimed_by && (
            <Button size="sm" variant="ghost" onClick={() => claim(item.id)}>Claim</Button>
          )}
          {item.item_type === 'assessment' && item.status === 'acknowledged' && (
            <Button size="sm" variant="ghost" onClick={handleEscalate}>
              <ArrowUpCircle className="w-4 h-4 mr-1" />
              Escalate to Incident
            </Button>
          )}
          {item.item_type !== 'assessment' && item.status !== 'resolved' && item.status !== 'escalated' && (
            <Button size="sm" variant="ghost" onClick={() => resolve(item.id)}>Mark Resolved</Button>
          )}
        </div>
      </div>
    </DrawerShell>
  );
}
