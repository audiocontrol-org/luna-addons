import { describe, expect, it } from 'vitest';
import { bindTransport } from '@/core/transport';
import { createFakeSurface } from './fixtures/fake-surface';

async function rig(): Promise<{ engine: Luna.MockEngine; session: Luna.Session }> {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { tracks: ['Vocal'], name: 'Demo' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await session.ready();
  return { engine, session };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
const last = (s: ReturnType<typeof createFakeSurface>, role: 'transport.play' | 'transport.record') =>
  s.indications.filter((i) => i.role === role).at(-1)?.state;

describe('bindTransport', () => {
  it('a transport.play role toggles the transport; transport.record calls toggleRecord', async () => {
    const { engine, session } = await rig();
    const surface = createFakeSurface([]);
    bindTransport(session, surface, () => undefined);
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true);
    surface.emit({ kind: 'role', role: 'transport.record' });
    await flush();
    expect(engine.value('/sessions/abc', 'record_enabled')).toBe(true);
  });

  it('ignores press intents and other roles', async () => {
    const { engine, session } = await rig();
    const surface = createFakeSurface([]);
    bindTransport(session, surface, () => undefined);
    surface.emit({ kind: 'press', control: 'play' });
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).not.toBe(true);
    expect(engine.value('/sessions/abc', 'record_enabled')).not.toBe(true);
  });

  it('indication follows the transport', async () => {
    const { engine, session } = await rig();
    const surface = createFakeSurface([]);
    bindTransport(session, surface, () => undefined);
    expect(last(surface, 'transport.play')).toBe('inactive');
    expect(last(surface, 'transport.record')).toBe('inactive');
    engine.setValue('/sessions/abc', 'playing', true);
    engine.setValue('/sessions/abc', 'record_enabled', true);
    await flush();
    expect(last(surface, 'transport.play')).toBe('active');
    expect(last(surface, 'transport.record')).toBe('active');
    engine.setValue('/sessions/abc', 'playing', false);
    await flush();
    expect(last(surface, 'transport.play')).toBe('inactive');
  });

  it('indicates the current state when the surface becomes ready after binding', async () => {
    const { engine, session } = await rig();
    engine.setValue('/sessions/abc', 'playing', true);
    await flush();
    const surface = createFakeSurface([]);
    surface.setStatus({ state: 'claiming', reason: 'claiming' });
    bindTransport(session, surface, () => undefined);
    surface.indications.length = 0;
    surface.setStatus({ state: 'ready' });
    expect(surface.indications).toContainEqual({ role: 'transport.play', state: 'active' });
    expect(surface.indications).toContainEqual({ role: 'transport.record', state: 'inactive' });
  });

  it('unsubscribe removes every listener', async () => {
    const { engine, session } = await rig();
    const surface = createFakeSurface([]);
    const off = bindTransport(session, surface, () => undefined);
    off();
    expect(surface.listenerCount()).toBe(0);
    surface.emit({ kind: 'role', role: 'transport.play' });
    const before = surface.indications.length;
    engine.setValue('/sessions/abc', 'playing', true);
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true); // set by the test only
    expect(surface.indications.length).toBe(before);
  });

  it('transport works with no target', async () => {
    const { engine, session } = await rig();
    const surface = createFakeSurface([]);
    bindTransport(session, surface, () => undefined); // no targeting exists at all
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true);
  });

  it('records transport-failed when a toggle rejects', async () => {
    const { engine, session } = await rig();
    engine.fail('/sessions/abc/playing', 'uasrv.busy');
    const events: Array<[string, unknown]> = [];
    const surface = createFakeSurface([]);
    bindTransport(session, surface, (e, d) => events.push([e, d]));
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(events.map(([e]) => e)).toContain('transport-failed');
  });

  it('records indicate-failed when indicate rejects', async () => {
    const { session } = await rig();
    const events: Array<[string, unknown]> = [];
    const surface = { ...createFakeSurface([]), indicate: () => Promise.reject(new Error('boom')) };
    bindTransport(session, surface, (e, d) => events.push([e, d]));
    await flush();
    expect(events.map(([e]) => e)).toContain('indicate-failed');
  });
});
