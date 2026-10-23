/**
 * Reads a streamed (follow=true) pod log response into whole lines.
 *
 * Kept outside the component so the batching is testable. Two defects lived
 * here before: the component pushed a batch into an array, queued a state
 * update that read that array later, then cleared the array synchronously —
 * so React's updater saw an empty batch and lines were silently dropped; and
 * a chunk that ended mid-line could lose its tail when the stream closed.
 */

export interface LogStreamReadResult {
  /** True when the server closed the stream (container exited or restarted), false when aborted. */
  ended: boolean;
}

/**
 * Splits a byte stream into lines. Each call to `onLines` receives a fresh
 * array the caller may keep. Blank lines are dropped. The final partial line
 * is flushed when the stream ends.
 */
export async function readLogStream(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  onLines: (lines: string[]) => void,
  isActive: () => boolean = () => true,
): Promise<LogStreamReadResult> {
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    let chunk: ReadableStreamReadResult<Uint8Array>;
    try {
      chunk = await reader.read();
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return { ended: false };
      throw err;
    }
    if (!isActive()) return { ended: false };
    if (chunk.done) {
      buffer += decoder.decode();
      if (buffer.trim()) onLines([buffer]);
      return { ended: true };
    }
    buffer += decoder.decode(chunk.value, { stream: true });
    const parts = buffer.split('\n');
    buffer = parts.pop() ?? '';
    const lines = parts.filter((l) => l.trim());
    if (lines.length) onLines(lines);
  }
}

/** Appends a batch to existing lines, keeping only the newest `max`. */
export function appendCapped<T>(prev: T[], batch: T[], max: number): T[] {
  const combined = prev.concat(batch);
  return combined.length > max ? combined.slice(-max) : combined;
}

/** Adds a query parameter to a URL that may or may not already have a query string. */
export function withParam(url: string, key: string, value: string): string {
  return `${url}${url.includes('?') ? '&' : '?'}${key}=${encodeURIComponent(value)}`;
}
