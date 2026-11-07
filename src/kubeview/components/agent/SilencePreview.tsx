/**
 * What a chat-proposed silence will do, in the confirmation card.
 *
 * Built from the agent's `confirm_request.preview` (computed as you, from the
 * code the tool runs: exact matchers, end time, who it is created as, what it
 * hides now). An older agent sends no preview; the card then shows the
 * model's input and says what it cannot show.
 */
import { cn } from '@/lib/utils';
import { formatTimestamp } from '../../engine/format';

interface PreviewMatcher { text?: string; name?: string; value?: string; isRegex?: boolean; isEqual?: boolean }
interface PreviewAlert { alertname?: string; severity?: string; namespace?: string }

function str(v: unknown): string {
  return typeof v === 'string' ? v : v == null ? '' : String(v);
}

function matcherText(m: PreviewMatcher): string {
  if (m.text) return m.text;
  const op = m.isRegex ? (m.isEqual === false ? '!~' : '=~') : (m.isEqual === false ? '!=' : '=');
  return `${m.name}${op}"${m.value}"`;
}

/** True when the agent has already said the write will be refused. */
export function silencePreviewInvalid(preview?: Record<string, unknown>): string | null {
  if (!preview || preview.valid !== false) return null;
  return str(preview.error) || 'Pulse will refuse this silence.';
}

export function SilencePreview({ tool, input, preview }: { tool: string; input: Record<string, unknown>; preview?: Record<string, unknown> }) {
  const invalid = silencePreviewInvalid(preview);
  if (tool === 'expire_silence') {
    const matchers = Array.isArray(preview?.matchers) ? (preview!.matchers as PreviewMatcher[]) : [];
    return (
      <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-1 text-xs" data-testid="silence-preview">
        <h4 className="font-medium text-slate-400">Silence to expire</h4>
        {invalid ? <p role="alert" className="text-red-300">{invalid}</p> : preview ? (
          <>
            <ul className="font-mono text-slate-300">{matchers.map((m, i) => <li key={i}>- {matcherText(m)}</li>)}</ul>
            <p className="text-slate-300">Created by {str(preview.createdBy) || 'unknown'}: {str(preview.comment) || 'no comment'}</p>
            <p className="text-slate-400">Its alerts start notifying again. To undo, create the silence again.</p>
          </>
        ) : (
          <p className="text-slate-400">Silence {str(input.silence_id)}. This agent sent no preview, so its matchers are not shown here; check Alerts › Silences.</p>
        )}
      </div>
    );
  }

  const matchers = Array.isArray(preview?.matchers) ? (preview!.matchers as PreviewMatcher[]) : null;
  const hides = preview && Array.isArray(preview.hides) ? (preview.hides as PreviewAlert[]) : null;
  return (
    <div className="rounded-sm bg-slate-900/50 border border-slate-700 px-3 py-2 space-y-2 text-xs" data-testid="silence-preview">
      <div>
        <h4 className="font-medium text-slate-400 mb-0.5">Matchers</h4>
        {matchers
          ? <ul className="font-mono text-green-300">{matchers.map((m, i) => <li key={i}>+ {matcherText(m)}</li>)}</ul>
          : <p className="font-mono text-slate-300">{str(input.matchers)}</p>}
      </div>
      {invalid && <p role="alert" className="text-red-300">Pulse will refuse this: {invalid}</p>}
      {!invalid && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-slate-400 font-medium">Duration</div>
              <div className="text-slate-200">
                {preview ? `${str(preview.duration)}, until ${formatTimestamp(str(preview.endsAt))}` : `${str(input.duration_minutes)} minutes`}
              </div>
            </div>
            <div>
              <div className="text-slate-400 font-medium">Created by</div>
              <div className="text-slate-200">{preview ? str(preview.createdBy) : 'you (the signed-in user)'}</div>
            </div>
          </div>
          <div>
            <div className="text-slate-400 font-medium">Comment</div>
            <div className="text-slate-200">{preview ? str(preview.comment) : str(input.comment)}</div>
          </div>
          <div>
            <div className="text-slate-400 font-medium">What it will hide now</div>
            {!preview ? (
              <p className="text-slate-400">This agent sent no preview, so what it hides is not shown. Check Alerts before approving.</p>
            ) : hides === null ? (
              <p className="text-amber-300">Could not check: {str(preview.hidesError) || 'the firing alerts could not be read'}</p>
            ) : hides.length === 0 ? (
              <p className="text-amber-300">No alert firing now matches; it only hides alerts that start later.</p>
            ) : (
              <ul className="space-y-0.5">
                {hides.map((a, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <span className={cn('px-1 rounded-sm', a.severity === 'critical' ? 'bg-red-900/50 text-red-300' : 'bg-amber-900/50 text-amber-300')}>{a.severity || '?'}</span>
                    <span className="text-slate-200">{a.alertname}</span>
                    {a.namespace && <span className="text-faint">{a.namespace}</span>}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-faint mt-0.5">Also any new alert with these matchers until it ends.</p>
          </div>
          <div>
            <div className="text-slate-400 font-medium">Undo</div>
            <div className="text-slate-300">Expire it any time in Alerts › Silences, or ask Pulse to expire it.</div>
          </div>
        </>
      )}
    </div>
  );
}
