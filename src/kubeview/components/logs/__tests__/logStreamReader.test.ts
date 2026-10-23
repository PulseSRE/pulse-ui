import { describe, it, expect } from 'vitest';
import { readLogStream, appendCapped, withParam } from '../logStreamReader';

function streamOf(chunks: string[]): ReadableStreamDefaultReader<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return {
    read: async () => (i < chunks.length ? { done: false, value: enc.encode(chunks[i++]) } : { done: true, value: undefined }),
  } as unknown as ReadableStreamDefaultReader<Uint8Array>;
}

describe('readLogStream', () => {
  it('delivers every line, including ones split across chunks', async () => {
    const batches: string[][] = [];
    const res = await readLogStream(streamOf(['one\ntw', 'o\nthree\n', 'four']), (l) => batches.push(l));
    expect(batches.flat()).toEqual(['one', 'two', 'three', 'four']);
    expect(res.ended).toBe(true);
  });

  // Regression: the component cleared the batch array synchronously after
  // queuing a state update that read it, so the update saw an empty batch.
  it('hands each batch over as its own array, never reused', async () => {
    const batches: string[][] = [];
    await readLogStream(streamOf(['a\nb\n', 'c\n']), (l) => batches.push(l));
    expect(batches).toEqual([['a', 'b'], ['c']]);
    expect(batches[0]).not.toBe(batches[1]);
  });

  it('keeps multi-byte characters split across chunks intact', async () => {
    const enc = new TextEncoder();
    const bytes = enc.encode('héllo\n');
    let i = 0;
    const parts = [bytes.slice(0, 2), bytes.slice(2)];
    const reader = { read: async () => (i < 2 ? { done: false, value: parts[i++] } : { done: true, value: undefined }) } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    const out: string[] = [];
    await readLogStream(reader, (l) => out.push(...l));
    expect(out).toEqual(['héllo']);
  });

  it('reports an abort as not ended, so the UI does not claim the container stopped', async () => {
    const reader = { read: async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; } } as unknown as ReadableStreamDefaultReader<Uint8Array>;
    expect(await readLogStream(reader, () => {})).toEqual({ ended: false });
  });

  it('stops delivering once the view is no longer active', async () => {
    let active = true;
    const out: string[] = [];
    await readLogStream(streamOf(['a\n', 'b\n']), (l) => { out.push(...l); active = false; }, () => active);
    expect(out).toEqual(['a']);
  });
});

describe('appendCapped', () => {
  it('keeps the newest lines when over the cap', () => {
    expect(appendCapped([1, 2, 3], [4, 5], 3)).toEqual([3, 4, 5]);
  });
});

describe('withParam', () => {
  it('adds to an existing query string', () => {
    expect(withParam('/log?tailLines=10', 'previous', 'true')).toBe('/log?tailLines=10&previous=true');
  });
});
