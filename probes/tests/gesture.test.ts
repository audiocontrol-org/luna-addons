import { describe, expect, it } from 'vitest';
import { createGestures, type GestureTarget } from '@/lib/gesture';

function target(name: string, write: (v: number) => Promise<void>): GestureTarget & { calls: string[] } {
  const calls: string[] = [];
  return {
    name,
    calls,
    begin: () => { calls.push('begin'); },
    end: () => { calls.push('end'); },
    write: (v) => { calls.push(`write ${v}`); return write(v); },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createGestures', () => {
  it('opens one touch per gesture and releases it when another control moves', () => {
    const events: string[] = [];
    const gestures = createGestures(10_000, (event) => events.push(event));
    const a = target('a', () => Promise.resolve());
    const b = target('b', () => Promise.resolve());
    gestures.move(a, 0.1);
    gestures.move(a, 0.2);
    gestures.move(b, 0.3);
    gestures.release('finish');
    expect(a.calls).toEqual(['begin', 'write 0.1', 'write 0.2', 'end']);
    expect(b.calls).toEqual(['begin', 'write 0.3', 'end']);
    expect(events).toContain('end');
  });

  it('releases the touch when LUNA rejects a write', async () => {
    const events: Array<{ event: string; detail: unknown }> = [];
    const gestures = createGestures(10_000, (event, detail) => events.push({ event, detail }));
    const a = target('a', () => Promise.reject(new Error('socket closed')));
    gestures.move(a, 0.5);
    await flush();
    expect(a.calls).toEqual(['begin', 'write 0.5', 'end']);
    expect(events.map((e) => e.event)).toEqual(['begin', 'write-failed', 'end']);
    expect(JSON.stringify(events[1]?.detail)).toContain('socket closed');
  });
});
