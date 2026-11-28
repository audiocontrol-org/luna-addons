// The Add On wired as main.ts wires it: the bundled starter surface definition, the generic
// surface runtime and the app, against Luna.MockEngine with the surface's MIDI ports and an
// API Vision insert. The one core-facing test that sees bytes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bundle } from '@/bundle/types';
import { panelModel } from '@/core/panel/model';
import { watchChoices } from '@/core/panel/watch';
import { createSurface } from '@/surface/runtime/create';
import { loadBundle, startAddOn, surfaceIdOf, type Running } from '@/wiring';
import { addParam } from './fixtures/params';

const bundlePath = fileURLToPath(new URL('../src/bundle/generated.json', import.meta.url));
const raw: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'));

const VISION = 'uaudio_api_vision_ext';

const toHex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const fromHex = (text: string): number[] => text.split(' ').map((t) => parseInt(t, 16));

let running: Running | undefined;

afterEach(async () => {
  if (running) await running.stop();
  running = undefined;
});

async function rig() {
  const bundle = loadBundle(raw);
  const definition = bundle.surfaces[surfaceIdOf(bundle.maps)];
  if (!definition) throw new Error('test: the bundle has no surface for its maps');
  const { input, output } = definition.profile.ports;
  const engine = new Luna.MockEngine();
  engine.addMidiDevice(input, { uid: 'dev_in', input: true, output: false });
  engine.addMidiDevice(output, { uid: 'dev_out', input: false, output: true });
  engine.addSession('abc', { tracks: ['Vocal'], name: 'Demo' });
  engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await session.ready();
  await luna.plugins.load();
  const track = session.tracks.byId('Vocal');
  if (!track) throw new Error('test: no Vocal track');
  await track.effects.load();
  const slot = await track.insert(VISION, 'effect_2');
  if (!slot) throw new Error('test: insert failed');
  const map = bundle.maps[VISION];
  if (!map) throw new Error(`test: the bundle has no map for ${VISION}`);
  const seen = new Set<string>();
  for (const page of map.pages) {
    for (const a of page.assignments) {
      if (seen.has(a.parameter.id)) continue;
      seen.add(a.parameter.id);
      addParam(engine, `${slot.path}/controls/${a.parameter.id}`, a.parameter.name);
    }
  }
  await engine.settled();
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 6; i++) {
      await engine.settled();
      await luna.settled();
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  const receive = async (...messages: string[]): Promise<void> => {
    engine.receiveMidi('dev_in', messages.map(fromHex));
    await settle();
  };
  const events: string[] = [];
  running = await startAddOn({ luna, session, bundle, createSurface, record: (event) => { events.push(event); } });
  await settle();
  const sent = (): string[] => engine.midiSent.map((m) => toHex(m.sysex ?? m.bytes));
  const valueOf = (id: string): unknown => engine.value(`${slot.path}/controls/${id}`, 'normalized_value');
  return { engine, session, running, receive, settle, sent, valueOf, events };
}

describe('wiring', () => {
  it('claims on start; BF 0D 50 from the device writes 550_hf_freq once the insert is chosen', async () => {
    const r = await rig();
    expect(r.sent()[0]).toBe('F0 00 20 29 02 15 02 7F F7');
    expect(r.running.surface.status().state).toBe('claiming');
    await r.receive('B6 1E 02');
    expect(r.running.surface.status()).toEqual({ state: 'ready' });
    await r.running.app.targeting.choose('Vocal', 'effect_2');
    await r.settle();
    const model = panelModel(r.running.app.state(), r.session, r.running.surface);
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
