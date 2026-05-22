import { Bot, Loader2, AlertTriangle, Search } from 'lucide-react';
import { useAgentStore } from '../store/agentStore';
import { useInboxStore } from '../store/inboxStore';
import { useMonitorStore } from '../store/monitorStore';

export type AgentStatusType = 'streaming' | 'investigating' | 'findings' | 'connected' | 'offline';

export interface AgentStatus {
  type: AgentStatusType;
  text: string;
  icon: React.ElementType;
  color: string;
  findingsCount: number;
  criticalCount: number;
}

export function useAgentStatus(): AgentStatus {
  const streaming = useAgentStore((s) => s.streaming);
  const monitorConnected = useMonitorStore((s) => s.connected);
  const inboxStats = useInboxStore((s) => s.stats);
  const findingsCount = inboxStats?.needs_attention ?? 0;
  const criticalCount = inboxStats?.critical ?? 0;
  const activeSkill = useMonitorStore((s) => s.activeSkill);

  if (streaming) {
    return { type: 'streaming', text: 'Reasoning...', icon: Loader2, color: 'text-violet-400', findingsCount, criticalCount };
  }
  if (activeSkill) {
    return { type: 'investigating', text: `Investigating: ${activeSkill}`, icon: Search, color: 'text-violet-400', findingsCount, criticalCount };
  }
  if (findingsCount > 0) {
    const text = criticalCount > 0
      ? `${criticalCount} critical, ${findingsCount} total`
      : `${findingsCount} active finding${findingsCount !== 1 ? 's' : ''}`;
    return { type: 'findings', text, icon: AlertTriangle, color: criticalCount > 0 ? 'text-red-400' : 'text-amber-400', findingsCount, criticalCount };
  }
  if (monitorConnected) {
    return { type: 'connected', text: 'Scanning... all clear', icon: Bot, color: 'text-emerald-400', findingsCount, criticalCount };
  }
  return { type: 'offline', text: 'Offline', icon: Bot, color: 'text-slate-500', findingsCount, criticalCount };
}
