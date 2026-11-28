// The app against Luna.MockEngine, with the bundled API Vision map and a fake Surface driven
// by intents. The surface is injected; the app never sees a surface definition.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Bundle } from '@/bundle/types';
import { createApp, type App } from '@/core/app';
import type { SurfaceControlInfo } from '@/surface/api';
import { createFakeSurface, type FakeSurface, type FakeSurfaceOptions } from './fixtures/fake-surface';

const bundlePath = fileURLToPath(new URL('../src/bundle/generated.json', import.meta.url));
const bundle: Bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

const VISION = 'uaudio_api_vision_ext';
const UNMAPPED = 'com.uaudio.uadx.1176';

function visionMap(): Bundle['maps'][string] {
  const map = bundle.maps[VISION];
  if (!map) throw new Error(`The bundle has no map for ${VISION}; run npm run bundle`);
  return map;
}

// Every parameter the map names, once, as LUNA would report it.
function visionParams(): Array<{ id: string; name: string }> {
  const byId = new Map<string, string>();
  for (const page of visionMap().pages) for (const a of page.assignments) byId.set(a.parameter.id, a.parameter.name);
  return [...byId].map(([id, name]) => ({ id, name }));
}

function controls(): SurfaceControlInfo[] {
  const ids = new Set<string>();
  for (const page of visionMap().pages) for (const a of page.assignments) ids.add(a.control);
  return [...ids].map((id) => ({
    id,
    continuous: !id.startsWith('button'),
    follows: id.startsWith('encoder'),
  }));
}

function addParam(engine: Luna.MockEngine, path: string, name: string): void {
  engine.addNode(path, {
    properties: {
      uid: `ctl_${path.replaceAll('/', '_')}`,
      name,
      control_type: 'parameter',
      value: 0.5,
      real_value: 0.5,
      normalized_value: 0.5,
      string_value: '0.5',
      automatable: true,
      discrete: false,
      num_steps: 0,
      initialized: true,
      touch_count: 0,
      real_values: [],
      string_values: [],
      taper: null,
    },
    commands: {
      set_touch: (data, eng, nodePath) => {
        const on = typeof data === 'object' && data !== null && 'touch' in data && Boolean(data.touch);
        eng.touches.push(`${nodePath}:${on ? 'on' : 'off'}`);
        return null;
      },
    },
  });
}

interface Rig {
  engine: Luna.MockEngine;
  session: Luna.Session;
  slot: Luna.Effect;
  surface: FakeSurface;
  app: App;
  events: Array<{ event: string; detail: unknown }>;
  valueOf(paramId: string): unknown;
}

let running: App | undefined;

async function rig(options: { leaveOut?: string[]; surface?: FakeSurfaceOptions; target?: boolean } = {}): Promise<Rig> {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { tracks: ['Vocal'], name: 'Demo' });
  engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
  engine.addPlugin(UNMAPPED, { name: '1176' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await session.ready();
  const track = session.tracks.byId('Vocal');
  if (!track) throw new Error('no Vocal track');
  await track.effects.load();
  const slot = await track.insert(VISION, 'effect_0');
  if (!slot) throw new Error('insert failed');
  const leaveOut = new Set(options.leaveOut ?? []);
  for (const p of visionParams()) if (!leaveOut.has(p.id)) addParam(engine, `${slot.path}/controls/${p.id}`, p.name);
  await engine.settled();
  const surface = createFakeSurface(controls(), options.surface);
  const events: Array<{ event: string; detail: unknown }> = [];
  const app = createApp(session, bundle.maps, surface, (event, detail) => { events.push({ event, detail }); });
  running = app;
  await app.start();
  if (options.target !== false) {
    await app.targeting.choose('Vocal', 'effect_0');
    await flush();
  }
  const valueOf = (paramId: string): unknown => engine.value(`${slot.path}/controls/${paramId}`, 'normalized_value');
  return { engine, session, slot, surface, app, events, valueOf };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

const move = (surface: FakeSurface, control: string, value: number): void => {
  surface.emit({ kind: 'move', control, value });
};

describe('app', () => {
  afterEach(async () => {
    if (running) await running.stop();
    running = undefined;
  });

  it('a move writes the mapped parameter', async () => {
    const { surface, valueOf, app } = await rig();
    const state = app.state();
    expect(state.resolution?.ok).toBe(true);
    move(surface, 'encoder_1_1', 0.63);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.63);
  });

  it('page.next cycles the page and announces "560 EQ 2/2", releasing any open touch', async () => {
    const { engine, surface, slot, valueOf, app } = await rig();
    move(surface, 'encoder_1_1', 0.7);
    await flush();
    expect(engine.touches).toEqual([`${slot.path}/controls/550_hf_freq:on`]);
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(engine.touches).toEqual([`${slot.path}/controls/550_hf_freq:on`, `${slot.path}/controls/550_hf_freq:off`]);
    expect(surface.announcements).toEqual(['560 EQ 2/2']);
    const r = app.state().resolution;
    expect(r?.ok && r.pageName).toBe('560 EQ');
    move(surface, 'encoder_1_1', 0.2);
    await flush();
    expect(valueOf('560_16khz')).toBe(0.2);
    expect(valueOf('550_hf_freq')).toBe(0.7);
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2', 'Channel 1/2']);
  });

  it('page.previous goes back, and page(-1) and page(1) do the same as the roles', async () => {
    const { surface, app } = await rig();
    surface.emit({ kind: 'role', role: 'page.previous' });
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2']);
    surface.emit({ kind: 'role', role: 'page.previous' });
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2', 'Channel 1/2']);
    app.page(-1);
    await flush();
    app.page(1);
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2', 'Channel 1/2', '560 EQ 2/2', 'Channel 1/2']);
  });

  it('an unmapped insert keeps transport', async () => {
    const { engine, surface, slot, app } = await rig();
    await slot.setPlugin(UNMAPPED);
    await flush();
    const r = app.state().resolution;
    expect(r?.ok).toBe(false);
    surface.emit({ kind: 'role', role: 'page.next' });
    app.page(1);
    await flush();
    expect(surface.announcements).toEqual([]);
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true);
  });

  it('transport roles are left to the transport binding: one toggle per press', async () => {
    const { engine, surface } = await rig();
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(true);
    surface.emit({ kind: 'role', role: 'transport.play' });
    await flush();
    expect(engine.value('/sessions/abc', 'playing')).toBe(false);
  });

  it('release ends the touch and calls surface.release; reclaim calls surface.claim', async () => {
    const { engine, surface, slot, valueOf, app } = await rig();
    move(surface, 'encoder_1_1', 0.4);
    await flush();
    await app.release();
    await flush();
    expect(engine.touches.at(-1)).toBe(`${slot.path}/controls/550_hf_freq:off`);
    expect(surface.calls.release).toBe(1);
    // The panel (Task 10) renders "Released: Reclaim controller to use it again" from this.
    expect(app.state().surface.state).toBe('released');
    move(surface, 'encoder_1_1', 0.9);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.4);
    await app.reclaim();
    await flush();
    expect(surface.calls.claim).toBe(1);
    expect(app.state().surface.state).toBe('ready');
    move(surface, 'encoder_1_1', 0.9);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.9);
  });

  const lost: Array<'suspended' | 'disconnected'> = ['suspended', 'disconnected'];
  for (const state of lost) {
    it(`the surface going ${state} releases the touch and stops writes`, async () => {
      const { engine, surface, slot, valueOf, app } = await rig();
      move(surface, 'encoder_1_1', 0.3);
      await flush();
      surface.setStatus({ state, reason: `fake ${state}` });
      await flush();
      expect(engine.touches.at(-1)).toBe(`${slot.path}/controls/550_hf_freq:off`);
      expect(app.state().surface).toEqual({ state, reason: `fake ${state}` });
      move(surface, 'encoder_1_1', 0.8);
      await flush();
      expect(valueOf('550_hf_freq')).toBe(0.3);
    });
  }

  it('the surface becoming ready rebuilds the bindings: follows and labels again', async () => {
    const { surface } = await rig();
    surface.setStatus({ state: 'suspended', reason: 'fake suspended' });
    await flush();
    const follows = surface.follows.length;
    const labels = surface.labels.length;
    surface.setStatus({ state: 'ready' });
    await flush();
    expect(surface.follows.length).toBeGreaterThan(follows);
    expect(surface.labels.length).toBe(labels * 2);
  });

  it('a target swap to an unmapped plugin gives "No map for plugin …", and moves write nothing', async () => {
    const { engine, surface, slot, app } = await rig();
    await slot.setPlugin(UNMAPPED);
    await flush();
    expect(app.state().resolution).toEqual({ ok: false, reason: `No map for plugin ${UNMAPPED}`, mismatches: [] });
    const t = app.state().target;
    expect(t.state === 'ready' && t.pluginId).toBe(UNMAPPED);
    engine.touches.length = 0;
    move(surface, 'encoder_1_1', 0.11);
    await flush();
    expect(engine.touches).toEqual([]);
  });

  it('a refused page writes nothing and lists mismatches', async () => {
    const { engine, surface, valueOf, app } = await rig({ leaveOut: ['560_31hz'] });
    expect(app.state().resolution?.ok).toBe(true);
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    const r = app.state().resolution;
    expect(r?.ok).toBe(false);
    expect(r && !r.ok && r.mismatches).toEqual(['560_31hz: not reported by LUNA']);
    engine.touches.length = 0;
    move(surface, 'encoder_1_1', 0.12);
    await flush();
    expect(engine.touches).toEqual([]);
    expect(valueOf('560_16khz')).toBe(0.5);
    expect(valueOf('550_hf_freq')).toBe(0.5);
    // A refused page holds no paging; there is nothing to page from.
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(surface.announcements).toEqual([]);
  });

  it('assign labels each bound control with its parameter name', async () => {
    const { surface } = await rig();
    const first = visionMap().pages[0];
    if (!first) throw new Error('the API Vision map has no pages');
    const expected = first.assignments.map((a) => ({ control: a.control, text: a.parameter.name }));
    expect(surface.labels).toEqual(expected);
  });

  it('a surface that cannot label records label-failed and still binds', async () => {
    const { surface, valueOf, app, events } = await rig({ surface: { labelError: new Error('fake has no label template') } });
    expect(events.some((e) => e.event === 'label-failed')).toBe(true);
    move(surface, 'encoder_1_1', 0.66);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.66);
    const failures = app.state().failures;
    expect(failures.length).toBe(5);
    expect(failures.every((f) => f === 'label-failed: fake has no label template')).toBe(true);
  });

  it('failures keep the last five "-failed" events, forward every event, and notify', async () => {
    const { surface, app, events } = await rig({ surface: { announceError: new Error('no announce') } });
    let changes = 0;
    app.onChange(() => { changes += 1; });
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(events.some((e) => e.event === 'announce-failed')).toBe(true);
    expect(app.state().failures).toEqual(['announce-failed: no announce']);
    expect(changes).toBeGreaterThan(0);
    for (let i = 0; i < 6; i++) {
      surface.emit({ kind: 'role', role: 'page.next' });
      await flush();
    }
    expect(app.state().failures).toHaveLength(5);
  });

  it('no target: state says why, and moves write nothing', async () => {
    const { engine, surface, app } = await rig({ target: false });
    expect(app.state().target).toEqual({ state: 'none', reason: 'Choose a track and insert in the panel' });
    expect(app.state().resolution).toBeUndefined();
    engine.touches.length = 0;
    move(surface, 'encoder_1_1', 0.5);
    await flush();
    expect(engine.touches).toEqual([]);
  });

  it('stop unsubscribes from the surface and releases the touch; it does not release the surface', async () => {
    const { engine, surface, slot, app } = await rig();
    move(surface, 'encoder_1_1', 0.45);
    await flush();
    await app.stop();
    running = undefined;
    await flush();
    expect(engine.touches.at(-1)).toBe(`${slot.path}/controls/550_hf_freq:off`);
    expect(surface.listenerCount()).toBe(0);
    expect(surface.calls.release).toBe(0);
  });
});
