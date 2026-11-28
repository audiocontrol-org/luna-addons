// The panel model: each AppState gives the text the panel shows. Runs against Luna.MockEngine
// for the session, and the bundled starter layout for the paging text.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Bundle } from '@/bundle/types';
import type { AppState } from '@/core/app';
import { panelModel } from '@/core/panel/model';
import { panelButtons } from '@/core/panel/render';
import { resolve } from '@/core/resolve';
import type { Target } from '@/core/targeting';
import type { Surface, SurfaceStatus } from '@/surface/api';
import { createSurface } from '@/surface/runtime/create';

const bundlePath = fileURLToPath(new URL('../src/bundle/generated.json', import.meta.url));
const bundle: Bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

const VISION = 'uaudio_api_vision_ext';
const UNMAPPED = 'com.uaudio.uadx.1176';
const READY: SurfaceStatus = { state: 'ready' };

let session: Luna.Session;
let target: Target;
let surface: Pick<Surface, 'bindingText'>;

function visionParams(): Array<{ id: string; name: string }> {
  const map = bundle.maps[VISION];
  if (!map) throw new Error(`The bundle has no map for ${VISION}; run npm run bundle`);
  const byId = new Map<string, string>();
  for (const page of map.pages) for (const a of page.assignments) byId.set(a.parameter.id, a.parameter.name);
  return [...byId].map(([id, name]) => ({ id, name }));
}

function state(over: Partial<AppState>): AppState {
  return { surface: READY, target, resolution: undefined, failures: [], ...over };
}

beforeAll(async () => {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { tracks: ['Vocal', 'Bass', 'Keys'], name: 'Demo' });
  engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
  engine.addPlugin(UNMAPPED, { name: '1176' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  session = await luna.session();
  await session.ready();
  await luna.plugins.load();
  const vocal = session.tracks.byId('Vocal');
  const bass = session.tracks.byId('Bass');
  const keys = session.tracks.byId('Keys');
  if (!vocal || !bass || !keys) throw new Error('test: tracks missing');
  for (const track of [vocal, bass, keys]) await track.effects.load();
  const slot = await vocal.insert(VISION, 'effect_2');
  if (!slot) throw new Error('test: insert failed');
  await bass.insert(UNMAPPED, 'effect_0');
  await engine.settled();
  target = { state: 'ready', track: vocal, slot, pluginId: VISION };
  const starter = bundle.surfaces['lcxl3-daw'];
  if (!starter) throw new Error('The bundle has no surface lcxl3-daw; run npm run bundle');
  surface = createSurface(luna, starter);
});

describe('panel model', () => {
  it('a claiming surface shows "Controller: " and its reason, with no device wording', () => {
    const model = panelModel(state({ surface: { state: 'claiming', reason: 'Claiming pad-x; waiting for its mode report' } }), session, surface);
    expect(model.status).toBe('Controller: Claiming pad-x; waiting for its mode report');
    expect(model.controller).toBe('release');
  });

  it('a suspended or disconnected surface shows its reason the same way', () => {
    const states: Array<'suspended' | 'disconnected'> = ['suspended', 'disconnected'];
    for (const s of states) {
      const model = panelModel(state({ surface: { state: s, reason: `pad-x is ${s}` } }), session, surface);
      expect(model.status).toBe(`Controller: pad-x is ${s}`);
      expect(model.controller).toBe('release');
    }
  });

  it('a released surface asks for Reclaim, and the button reclaims', () => {
    const model = panelModel(state({ surface: { state: 'released', reason: 'pad-x was released' } }), session, surface);
    expect(model.status).toBe('Released: Reclaim controller to use it again');
    expect(model.controller).toBe('reclaim');
  });

  it('no target shows the targeting reason', () => {
    const model = panelModel(state({ target: { state: 'none', reason: 'Choose a track and insert in the panel' } }), session, surface);
    expect(model.status).toBe('Choose a track and insert in the panel');
    expect(model.target).toBe('');
    expect(model.rows).toEqual([]);
  });

  it('a plugin with no map shows "No map for plugin …"', () => {
    const resolution = resolve(bundle.maps, UNMAPPED, 0, []);
    const model = panelModel(state({ resolution }), session, surface);
    expect(model.status).toBe(`No map for plugin ${UNMAPPED}`);
    expect(model.rows).toEqual([]);
    expect(model.page).toBe('');
  });

  it('lists the mismatches, then the latest failures', () => {
    const params = visionParams().filter((p) => p.id !== '550_hf_freq');
    const resolution = resolve(bundle.maps, VISION, 0, params);
    const model = panelModel(state({ resolution, failures: ['label-failed: no port'] }), session, surface);
    expect(model.status).toBe('Page "Channel" does not match LUNA');
    expect(model.problems).toEqual(['550_hf_freq: not reported by LUNA', 'label-failed: no port']);
    expect(model.rows).toEqual([]);
  });

  it('a resolved page: one row per binding, the target, the page and the paging text', () => {
    const resolution = resolve(bundle.maps, VISION, 1, visionParams());
    if (!resolution.ok) throw new Error('test: the 560 EQ page should resolve');
    const model = panelModel(state({ resolution }), session, surface);
    expect(model.status).toBe('Ready');
    expect(model.target).toBe('Vocal · effect_2 · API Vision Channel Strip');
    expect(model.page).toBe('560 EQ (2 of 2)');
    expect(model.paging).toBe('Next: button_side · Previous: shift + button_side');
    expect(model.rows).toEqual(resolution.bindings.map((b) => ({ control: b.control, parameter: b.label })));
    expect(model.rows.length).toBe(13);
    expect(model.problems).toEqual([]);
  });

  it('a target whose map is still loading says so', () => {
    const model = panelModel(state({}), session, surface);
    expect(model.status).toBe('Loading the map for API Vision Channel Strip');
  });

  it('choices: each track with its non-empty slots', () => {
    const model = panelModel(state({}), session, surface);
    expect(model.choices).toEqual([
      { trackId: 'Vocal', trackName: 'Vocal', slots: [{ slotId: 'effect_2', label: 'effect_2 · API Vision Channel Strip' }] },
      { trackId: 'Bass', trackName: 'Bass', slots: [{ slotId: 'effect_0', label: 'effect_0 · 1176' }] },
    ]);
  });

  it('a layout without paging bindings gives no paging text', () => {
    const model = panelModel(state({}), session, { bindingText: () => undefined });
    expect(model.paging).toBe('');
  });
});

describe('panel buttons', () => {
  const app = () => ({ page: vi.fn(), release: vi.fn(async () => {}), reclaim: vi.fn(async () => {}) });

  it('Previous and Next call app.page; Release releases', async () => {
    const a = app();
    const model = panelModel(state({}), session, surface);
    const buttons = panelButtons(model, a);
    expect(buttons.map((b) => b.label)).toEqual(['Previous', 'Next', 'Release controller']);
    for (const b of buttons) await b.run();
    expect(a.page.mock.calls).toEqual([[-1], [1]]);
    expect(a.release).toHaveBeenCalledOnce();
    expect(a.reclaim).not.toHaveBeenCalled();
  });

  it('a released surface offers Reclaim', async () => {
    const a = app();
    const model = panelModel(state({ surface: { state: 'released', reason: 'x' } }), session, surface);
    const buttons = panelButtons(model, a);
    expect(buttons.map((b) => b.label)).toEqual(['Previous', 'Next', 'Reclaim controller']);
    const last = buttons[2];
    if (!last) throw new Error('test: no third button');
    await last.run();
    expect(a.reclaim).toHaveBeenCalledOnce();
  });
});
