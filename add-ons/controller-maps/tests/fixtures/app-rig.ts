// The app against Luna.MockEngine, with the bundled API Vision map and a fake Surface driven
// by intents: the set-up the app tests share.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Bundle } from '@/bundle/types';
import { createApp, type App } from '@/core/app';
import type { SurfaceControlInfo, SurfaceStatus } from '@/surface/api';
import { createFakeSurface, type FakeSurface, type FakeSurfaceOptions } from './fake-surface';
import { addParam } from './params';

const bundlePath = fileURLToPath(new URL('../../src/bundle/generated.json', import.meta.url));
export const bundle: Bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

export const VISION = 'uaudio_api_vision_ext';
export const UNMAPPED = 'com.uaudio.uadx.1176';

export function visionMap(): Bundle['maps'][string] {
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

export interface Rig {
  engine: Luna.MockEngine;
  session: Luna.Session;
  slot: Luna.Effect;
  surface: FakeSurface;
  app: App;
  events: Array<{ event: string; detail: unknown }>;
  valueOf(paramId: string): unknown;
}

export interface RigOptions {
  leaveOut?: string[];
  surface?: FakeSurfaceOptions;
  target?: boolean;
  status?: SurfaceStatus; // the surface's status before the app starts
}

let running: App | undefined;

// For afterEach: stops the app the last rig started, unless the test already did.
export async function stopRunning(): Promise<void> {
  if (running) await running.stop();
  running = undefined;
}

// For a test that stops the app itself.
export function forgetRunning(): void {
  running = undefined;
}

export const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 30));

export const move = (surface: FakeSurface, control: string, value: number): void => {
  surface.emit({ kind: 'move', control, value });
};

export async function rig(options: RigOptions = {}): Promise<Rig> {
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
  if (options.status !== undefined) surface.setStatus(options.status);
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
