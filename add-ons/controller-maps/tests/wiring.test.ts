// The Add On wired as main.ts wires it: the bundled starter surface definition, the generic
// surface runtime and the app, against Luna.MockEngine with the surface's MIDI ports and an
// API Vision insert. The one core-facing test that sees bytes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Bundle } from '@/bundle/types';
import { panelModel } from '@/core/panel/model';
import { watchChoices } from '@/core/panel/watch';
import { createSurface } from '@/surface/runtime/create';
import { loadBundle, startAddOn, surfaceIdOf, type Running } from '@/wiring';
import { appOf, prepare, raw, VISION } from './fixtures/wiring-rig';

let running: Running | undefined;

afterEach(async () => {
  if (running) await running.stop();
  running = undefined;
});

async function rig() {
  const p = await prepare();
  running = await startAddOn({ luna: p.luna, bundle: p.bundle, createSurface, record: p.record });
  await p.settle();
  return { ...p, running };
}

describe('wiring', () => {
  it('claims on start; BF 0D 50 from the device writes 550_hf_freq once the insert is chosen', async () => {
    const r = await rig();
    expect(r.sent()[0]).toBe('F0 00 20 29 02 15 02 7F F7');
    expect(r.running.surface.status().state).toBe('claiming');
    await r.receive('B6 1E 02');
    expect(r.running.surface.status()).toEqual({ state: 'ready' });
    await appOf(r.running).targeting.choose('Vocal', 'effect_2');
    await r.settle();
    const model = panelModel(appOf(r.running).state(), r.firstSession(), r.running.surface);
    expect(model.status).toBe('Ready');
    expect(model.target).toBe('Vocal · effect_2 · API Vision Channel Strip');
    expect(model.page).toBe('Channel (1 of 2)');
    await r.receive('BF 0D 50');
    expect(r.valueOf('550_hf_freq')).toBeCloseTo(80 / 127, 6);
  });

  it('stop ends the app, then releases the surface with its release sequence', async () => {
    const r = await rig();
    await r.receive('B6 1E 02');
    const current = r.running;
    running = undefined;
    await current.stop();
    await r.settle();
    expect(current.surface.status().state).toBe('released');
    expect(r.sent().at(-1)).toBe('F0 00 20 29 02 15 02 00 F7');
    await r.receive('BF 0D 50');
    expect(r.valueOf('550_hf_freq')).toBe(0.5);
  });

  it('a failure after the claim stops the app and releases the surface, then rejects with it', async () => {
    const p = await prepare();
    let claimed: Running | undefined;
    const failing = startAddOn({
      luna: p.luna,
      bundle: p.bundle,
      createSurface,
      record: p.record,
      afterClaim: async (r) => {
        claimed = r;
        await p.receive('B6 1E 02');
        await appOf(r).targeting.choose('Vocal', 'effect_2');
        await p.settle();
        throw new Error('the panel could not be shown');
      },
    });
    await expect(failing).rejects.toThrow('the panel could not be shown');
    await p.settle();
    if (!claimed) throw new Error('test: afterClaim never ran');
    expect(claimed.surface.status().state).toBe('released');
    expect(p.sent().at(-1)).toBe('F0 00 20 29 02 15 02 00 F7');
    const count = p.sent().length;
    await claimed.stop(); // a later stop (pagehide) does not release twice
    await p.settle();
    expect(p.sent().length).toBe(count);
    await p.receive('BF 0D 50');
    expect(p.valueOf('550_hf_freq')).toBe(0.5);
  });
});

describe('watchChoices', () => {
  it('loads every track and tells when a track or an insert changes', async () => {
    const engine = new Luna.MockEngine();
    engine.addSession('abc', { tracks: ['Vocal', 'Bass'], name: 'Demo' });
    engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
    await engine.settled();
    const luna = await Luna.connect({ port_: engine.port() });
    const session = await luna.session();
    await session.ready();
    await luna.plugins.load();
    let changes = 0;
    const off = await watchChoices(session, () => { changes += 1; }, (error) => { throw error; });
    const flush = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) {
        await engine.settled();
        await luna.settled();
        await new Promise((r) => setTimeout(r, 10));
      }
    };
    const bass = session.tracks.byId('Bass');
    if (!bass) throw new Error('test: no Bass track');
    const before = changes;
    await bass.insert(VISION, 'effect_1');
    await flush();
    expect(changes).toBeGreaterThan(before);
    const choices = (): string[] => panelModel(
      { surface: { state: 'ready' }, target: { state: 'none', reason: 'x' }, resolution: undefined, failures: [] },
      session,
      { bindingText: () => undefined },
    ).choices.flatMap((c) => c.slots.map((s) => `${c.trackId}/${s.slotId}`));
    expect(choices()).toEqual(['Bass/effect_1']);
    off();
    const after = changes;
    await bass.insert(VISION, 'effect_3');
    await flush();
    expect(changes).toBe(after);
  });
});

describe('watchChoices on a failing load', () => {
  it('a track whose inserts fail to load on the first sync goes to failed; the others still load', async () => {
    const engine = new Luna.MockEngine();
    engine.addSession('abc', { tracks: ['Vocal', 'Bass'], name: 'Demo' });
    engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
    await engine.settled();
    const luna = await Luna.connect({ port_: engine.port() });
    const session = await luna.session();
    await session.ready();
    await luna.plugins.load();
    const vocal = session.tracks.byId('Vocal');
    const bass = session.tracks.byId('Bass');
    if (!vocal || !bass) throw new Error('test: tracks missing');
    await bass.effects.load();
    await bass.insert(VISION, 'effect_0');
    await engine.settled();
    vi.spyOn(vocal.effects, 'load').mockRejectedValue(new Error('Vocal inserts unavailable'));
    const failures: unknown[] = [];
    let changes = 0;
    const off = await watchChoices(session, () => { changes += 1; }, (error) => { failures.push(error); });
    expect(failures.map((e) => (e instanceof Error ? e.message : String(e)))).toEqual(['Vocal inserts unavailable']);
    const before = changes;
    await bass.insert(VISION, 'effect_1');
    for (let i = 0; i < 4; i++) {
      await engine.settled();
      await luna.settled();
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(changes).toBeGreaterThan(before);
    off();
  });
});

describe('surfaceIdOf', () => {
  const map = (surface: string): Bundle['maps'][string] => ({ source: `${surface}.yaml`, name: surface, surface, pages: [] });

  it('gives the one surface every map names', () => {
    expect(surfaceIdOf({ a: map('pad-x'), b: map('pad-x') })).toBe('pad-x');
  });

  it('throws naming them when the maps name more than one surface', () => {
    expect(() => surfaceIdOf({ a: map('pad-x'), b: map('pad-y') })).toThrow(/pad-x.*pad-y/);
  });

  it('throws when there are no maps', () => {
    expect(() => surfaceIdOf({})).toThrow(/no maps/i);
  });
});

describe('loadBundle', () => {
  it('accepts the generated bundle', () => {
    expect(loadBundle(raw).contract).toBe(2);
  });

  it('refuses another contract, or a bundle without surfaces or maps', () => {
    expect(() => loadBundle({ contract: 1, audiocontrolRevision: 'r', surfaces: {}, maps: {} })).toThrow(/contract 1/);
    expect(() => loadBundle({ contract: 2, audiocontrolRevision: 'r', maps: {} })).toThrow(/surfaces/);
    expect(() => loadBundle({ contract: 2, audiocontrolRevision: 'r', surfaces: {} })).toThrow(/maps/);
    expect(() => loadBundle('nope')).toThrow(/not an object/);
  });
});
