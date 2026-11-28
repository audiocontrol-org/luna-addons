// The Add On follows LUNA's focused session: a switch stops the old session's app and builds
// a new one on the same claimed surface, so the controller is never released by the switch.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSurface } from '@/surface/runtime/create';
import { startAddOn, type Running } from '@/wiring';
import { appOf, prepare } from './fixtures/wiring-rig';

const READY = 'B6 1E 02';
const RELEASE = 'F0 00 20 29 02 15 02 00 F7';

let running: Running | undefined;

afterEach(async () => {
  if (running) await running.stop();
  running = undefined;
});

async function rig(sessions: readonly string[]) {
  const p = await prepare(sessions);
  running = await startAddOn({ luna: p.luna, bundle: p.bundle, createSurface, record: p.record });
  await p.settle();
  await p.receive(READY);
  return { ...p, running };
}

describe('session switching', () => {
  it('a focus switch rebuilds against the new session; the old app writes nothing; the surface stays claimed', async () => {
    const r = await rig(['abc', 'def']);
    expect(r.running.current()?.session.uid).toBe('abc');
    await appOf(r.running).targeting.choose('Vocal', 'effect_2');
    await r.settle();
    await r.receive('BF 0D 50');
    expect(r.valueOf('550_hf_freq', 'abc')).toBeCloseTo(80 / 127, 6);
    const oldApp = appOf(r.running);
    let changes = 0;
    r.running.onChange(() => { changes += 1; });

    r.engine.setValue('/sessions', 'focused_session', 'def');
    await r.settle();

    expect(r.running.current()?.session.uid).toBe('def');
    expect(appOf(r.running)).not.toBe(oldApp);
    expect(changes).toBeGreaterThan(0);
    expect(r.running.surface.status()).toEqual({ state: 'ready' });
    expect(r.sent()).not.toContain(RELEASE);
    // nothing is chosen in the new session yet, and the old app is gone
    await r.receive('BF 0D 20');
    expect(r.valueOf('550_hf_freq', 'abc')).toBeCloseTo(80 / 127, 6);
    expect(r.valueOf('550_hf_freq', 'def')).toBe(0.5);
    await appOf(r.running).targeting.choose('Vocal', 'effect_2');
    await r.settle();
    await r.receive('BF 0D 30');
    expect(r.valueOf('550_hf_freq', 'def')).toBeCloseTo(48 / 127, 6);
    expect(r.valueOf('550_hf_freq', 'abc')).toBeCloseTo(80 / 127, 6);
  });

  it('with no session open the Add On is on none and writes nothing; a session opened later gets an app', async () => {
    const r = await rig(['abc']);
    await appOf(r.running).targeting.choose('Vocal', 'effect_2');
    await r.settle();
    r.engine.removeNode('/sessions/abc');
    r.engine.setValue('/sessions', 'focused_session', '');
    await r.settle();
    expect(r.running.current()).toBeUndefined();
    expect(r.running.surface.status()).toEqual({ state: 'ready' });
    expect(r.sent()).not.toContain(RELEASE);
    r.engine.addSession('ghi', { tracks: ['Vocal'], name: 'Later' });
    await r.settle();
    expect(r.running.current()?.session.uid).toBe('ghi');
  });

  it('starting with no session open claims, and waits for one', async () => {
    const r = await rig([]);
    expect(r.running.current()).toBeUndefined();
    expect(r.running.surface.status()).toEqual({ state: 'ready' });
    r.engine.addSession('abc', { tracks: ['Vocal'], name: 'First' });
    await r.settle();
    expect(r.running.current()?.session.uid).toBe('abc');
  });

  it('a session the app cannot be built on leaves no app and says why', async () => {
    const r = await rig(['abc', 'def']);
    const def = r.luna.sessions.items.byId('def');
    if (!def) throw new Error('test: no def session');
    vi.spyOn(def, 'ready').mockRejectedValue(new Error('def would not load'));
    r.engine.setValue('/sessions', 'focused_session', 'def');
    await r.settle();
    expect(r.running.current()).toBeUndefined();
    expect(r.running.failure()).toBe('def would not load');
    expect(r.events).toContain('session-failed');
    r.engine.setValue('/sessions', 'focused_session', 'abc');
    await r.settle();
    expect(r.running.current()?.session.uid).toBe('abc');
    expect(r.running.failure()).toBeUndefined();
  });

  it('stop after a switch stops the current app and releases the surface once', async () => {
    const r = await rig(['abc', 'def']);
    r.engine.setValue('/sessions', 'focused_session', 'def');
    await r.settle();
    const current = r.running;
    running = undefined;
    await current.stop();
    await r.settle();
    expect(current.surface.status().state).toBe('released');
    expect(r.sent().filter((m) => m === RELEASE)).toHaveLength(1);
  });
});
