import { useState } from 'react';
import { X, Plus, Trash2, Loader2 } from 'lucide-react';
import { agentFetch } from '../../engine/safeQuery';

interface DraftPhase {
  id: string;
  skill_name: string;
  timeout_seconds: number;
  produces: string;
  required: boolean;
  approval_required: boolean;
  /** Comma-separated phase ids this one waits for. Empty = starts immediately. */
  depends_on: string;
  /** Finding key from a dependency whose value picks the skill. */
  branch_on: string;
  /** One "value: skill" pair per line, e.g. "oom: oom-investigator". */
  branches: string;
  /** incident_type of a whole plan to run as this phase (child workflow). */
  subplan: string;
}

const BLANK_PHASE: DraftPhase = {
  id: '',
  skill_name: 'sre',
  timeout_seconds: 120,
  produces: '',
  required: true,
  approval_required: false,
  depends_on: '',
  branch_on: '',
  branches: '',
  subplan: '',
};

/** "oom: oom-skill\nconfig: config-skill" -> { oom: ["oom-skill"], ... } */
function parseBranches(raw: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const line of raw.split('\n')) {
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    const skills = line.slice(sep + 1).split(',').map((s) => s.trim()).filter(Boolean);
    if (key && skills.length) out[key] = skills;
  }
  return out;
}

// Mirrors the server's validation so the error arrives while you are still
// typing rather than as a 400 after submitting.
const INCIDENT_TYPE_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function CreatePlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [incidentType, setIncidentType] = useState('');
  const [name, setName] = useState('');
  const [maxDuration, setMaxDuration] = useState(1800);
  const [phases, setPhases] = useState<DraftPhase[]>([{ ...BLANK_PHASE, id: 'triage' }]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const patchPhase = (idx: number, patch: Partial<DraftPhase>) => {
    setPhases((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  };

  const typeValid = INCIDENT_TYPE_RE.test(incidentType);
  const phasesValid = phases.length > 0 && phases.every((p) => p.id.trim() && p.skill_name.trim());
  const canSave = typeValid && phasesValid && !saving;

  const handleCreate = async () => {
    setSaving(true);
    setError('');
    try {
      const res = await agentFetch('/api/agent/plan-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          incident_type: incidentType,
          name: name.trim() || undefined,
          max_total_duration: maxDuration,
          phases: phases.map((p) => ({
            id: p.id.trim(),
            skill_name: p.skill_name.trim(),
            timeout_seconds: p.timeout_seconds,
            // The phase contract. phase_judge checks these are actually
            // returned, so an empty list means the phase promises nothing.
            produces: p.produces.split(',').map((s) => s.trim()).filter(Boolean),
            required: p.required,
            approval_required: p.approval_required,
            depends_on: p.depends_on.split(',').map((s) => s.trim()).filter(Boolean),
            ...(p.branch_on.trim() ? { branch_on: p.branch_on.trim() } : {}),
            ...(Object.keys(parseBranches(p.branches)).length ? { branches: parseBranches(p.branches) } : {}),
            ...(p.subplan.trim() ? { subplan: p.subplan.trim() } : {}),
          })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        onCreated();
      } else {
        setError(data.detail || `Failed to create plan (${res.status})`);
      }
    } catch {
      setError('Network error — could not reach agent');
    } finally {
      setSaving(false);
    }
  };

  const inputCls =
    'w-full px-3 py-1.5 text-xs bg-slate-800 border border-slate-700 rounded-md text-slate-200 placeholder:text-slate-600 focus:outline-hidden focus:ring-1 focus:ring-blue-500';

  return (
    <div className="bg-slate-900 border border-slate-700 rounded-lg p-5 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium text-slate-100">New investigation plan</h3>
        <button onClick={onClose} className="text-slate-500 hover:text-slate-300" aria-label="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Incident type</label>
          <input
            value={incidentType}
            onChange={(e) => setIncidentType(e.target.value)}
            placeholder="e.g. disk-pressure"
            className={inputCls}
          />
          {incidentType && !typeValid && (
            <div className="text-[10px] text-amber-400 mt-1">
              lowercase letters, numbers, - or _ (max 64)
            </div>
          )}
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Display name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="defaults from incident type"
            className={inputCls}
          />
        </div>
        <div>
          <label className="block text-[11px] text-slate-400 mb-1">Max duration (s)</label>
          <input
            type="number"
            min={60}
            value={maxDuration}
            onChange={(e) => setMaxDuration(Number(e.target.value) || 1800)}
            className={inputCls}
          />
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-slate-400">Phases (dependencies decide order; independent phases run in parallel)</span>
          <button
            onClick={() => setPhases((p) => [...p, { ...BLANK_PHASE }])}
            className="px-2 py-1 text-[11px] bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm border border-slate-700 flex items-center gap-1 transition-colors"
          >
            <Plus className="w-3 h-3" />
            Add phase
          </button>
        </div>

        {phases.map((phase, idx) => (
          <div key={idx} className="bg-slate-950/40 border border-slate-800 rounded-md p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-500">Phase {idx + 1}</span>
              {phases.length > 1 && (
                <button
                  onClick={() => setPhases((p) => p.filter((_, i) => i !== idx))}
                  className="text-slate-600 hover:text-red-400 transition-colors"
                  aria-label={`Remove phase ${idx + 1}`}
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <input
                value={phase.id}
                onChange={(e) => patchPhase(idx, { id: e.target.value })}
                placeholder="phase id (e.g. diagnose)"
                className={inputCls}
              />
              <input
                value={phase.skill_name}
                onChange={(e) => patchPhase(idx, { skill_name: e.target.value })}
                placeholder="skill (e.g. sre)"
                className={inputCls}
              />
              <input
                type="number"
                min={10}
                value={phase.timeout_seconds}
                onChange={(e) => patchPhase(idx, { timeout_seconds: Number(e.target.value) || 120 })}
                className={inputCls}
              />
            </div>
            <div>
              <input
                value={phase.produces}
                onChange={(e) => patchPhase(idx, { produces: e.target.value })}
                placeholder="produces: root_cause, confidence"
                className={inputCls}
              />
              <div className="text-[10px] text-slate-600 mt-1">
                Comma-separated. The phase is checked against this — a phase that
                does not return what it declares is marked partial instead of
                letting the plan advance on it.
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div>
                <input
                  value={phase.depends_on}
                  onChange={(e) => patchPhase(idx, { depends_on: e.target.value })}
                  placeholder="depends on: triage, logs"
                  className={inputCls}
                />
                <div className="text-[10px] text-slate-600 mt-1">
                  Phases with no unmet dependencies run together as one wave.
                </div>
              </div>
              <div>
                <input
                  value={phase.branch_on}
                  onChange={(e) => patchPhase(idx, { branch_on: e.target.value })}
                  placeholder="branch on finding: cause"
                  className={inputCls}
                />
                <div className="text-[10px] text-slate-600 mt-1">
                  A finding key from a dependency; its value picks the skill below.
                </div>
              </div>
              <div>
                <input
                  value={phase.subplan}
                  onChange={(e) => patchPhase(idx, { subplan: e.target.value })}
                  placeholder="sub-plan: oom-investigation"
                  className={inputCls}
                />
                <div className="text-[10px] text-slate-600 mt-1">
                  Runs that whole plan as this phase, with its own approvals and history.
                </div>
              </div>
            </div>
            {phase.branch_on.trim() && (
              <div>
                <textarea
                  value={phase.branches}
                  onChange={(e) => patchPhase(idx, { branches: e.target.value })}
                  placeholder={'oom: oom-investigator\nconfig: config-auditor'}
                  rows={2}
                  className={inputCls}
                />
                <div className="text-[10px] text-slate-600 mt-1">
                  One “value: skill” per line. An unmatched value keeps the phase’s own skill.
                </div>
              </div>
            )}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={phase.required}
                  onChange={(e) => patchPhase(idx, { required: e.target.checked })}
                  className="accent-cyan-600"
                />
                Required
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer">
                <input
                  type="checkbox"
                  checked={phase.approval_required}
                  onChange={(e) => patchPhase(idx, { approval_required: e.target.checked })}
                  className="accent-cyan-600"
                />
                Needs approval
              </label>
            </div>
          </div>
        ))}
      </div>

      {error && (
        <div className="px-3 py-2 text-xs rounded-md border bg-red-950/40 border-red-900/40 text-red-300">
          {error}
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={handleCreate}
          disabled={!canSave}
          className="px-3 py-1.5 text-xs bg-emerald-600/20 hover:bg-emerald-600/40 disabled:opacity-40 disabled:hover:bg-emerald-600/20 text-emerald-400 rounded-sm border border-emerald-800/30 flex items-center gap-1 transition-colors"
        >
          {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
          Create plan
        </button>
        <button
          onClick={onClose}
          className="px-3 py-1.5 text-xs bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-sm border border-slate-700 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
