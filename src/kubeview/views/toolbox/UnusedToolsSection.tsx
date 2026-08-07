import type { ToolInfo } from '../../store/toolUsageStore';

export function UnusedToolsSection({ tools, usedTools }: { tools: { sre: ToolInfo[]; security: ToolInfo[] }; usedTools: Array<{ tool_name: string; count: number }> }) {
  const usedNames = new Set((usedTools || []).map((t) => t.tool_name));
  const allTools: Array<{ name: string; category: string; mode: string }> = [];
  for (const t of (tools.sre || [])) allTools.push({ name: t.name, category: t.category || '', mode: 'sre' });
  for (const t of (tools.security || [])) {
    if (!allTools.some((x) => x.name === t.name)) allTools.push({ name: t.name, category: t.category || '', mode: 'security' });
  }

  const unused = allTools.filter((t) => !usedNames.has(t.name));
  const usedCount = allTools.length - unused.length;
  const usagePct = allTools.length > 0 ? Math.round((usedCount / allTools.length) * 100) : 0;

  const byCategory: Record<string, string[]> = {};
  for (const t of unused) {
    const cat = t.category || 'uncategorized';
    (byCategory[cat] ??= []).push(t.name);
  }

  return (
    <div className="bg-slate-900 border border-slate-800 rounded-lg p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-medium text-slate-300">Tool Coverage</h3>
        <span className="text-xs text-slate-500">{usedCount}/{allTools.length} used ({usagePct}%)</span>
      </div>

      <div className="h-2 bg-slate-800 rounded-full overflow-hidden mb-4" role="meter" aria-label={`Tool coverage: ${usagePct}%`} aria-valuenow={usagePct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-emerald-600/70 rounded-full" style={{ width: `${usagePct}%` }} />
      </div>

      {unused.length === 0 ? (
        <p className="text-xs text-emerald-400">All tools have been used</p>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-amber-400">{unused.length} tools never called</p>
          {Object.entries(byCategory).sort(([, a], [, b]) => b.length - a.length).map(([cat, names]) => (
            <div key={cat}>
              <div className="text-[11px] text-slate-400 mb-1">{cat} ({names.length})</div>
              <div className="flex flex-wrap gap-1">
                {names.map((n) => (
                  <span key={n} className="px-1.5 py-0.5 text-[10px] font-mono bg-slate-800 text-slate-500 rounded-sm border border-slate-700">{n}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
