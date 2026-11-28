// The Add On wired as main.ts wires it: the bundled starter surface definition, the generic
// surface runtime and the app, against Luna.MockEngine with the surface's MIDI ports and an
// API Vision insert on track Vocal, slot effect_2, in each session named.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { App } from '@/core/app';
import { loadBundle, surfaceIdOf, type Running } from '@/wiring';
import { addParam } from './params';

const bundlePath = fileURLToPath(new URL('../../src/bundle/generated.json', import.meta.url));
export const raw: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'));

export const VISION = 'uaudio_api_vision_ext';

const toHex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const fromHex = (text: string): number[] => text.split(' ').map((t) => parseInt(t, 16));

// The app of the session the Add On is on; throws when it is on none.
export function appOf(running: Running): App {
  const current = running.current();
  if (current === undefined) throw new Error('test: the Add On is on no session');
  return current.app;
}

// `sessions` are created in order; the first is focused.
export async function prepare(sessions: readonly string[] = ['abc']) {
  const bundle = loadBundle(raw);
  const definition = bundle.surfaces[surfaceIdOf(bundle.maps)];
  if (!definition) throw new Error('test: the bundle has no surface for its maps');
  const { input, output } = definition.profile.ports;
  const engine = new Luna.MockEngine();
  engine.addMidiDevice(input, { uid: 'dev_in', input: true, output: false });
  engine.addMidiDevice(output, { uid: 'dev_out', input: false, output: true });
  sessions.forEach((uid, i) => { engine.addSession(uid, { tracks: ['Vocal'], name: `Demo ${uid}`, focused: i === 0 }); });
  engine.addPlugin(VISION, { name: 'API Vision Channel Strip' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.sessions.ready();
  await luna.plugins.load();
  const map = bundle.maps[VISION];
  if (!map) throw new Error(`test: the bundle has no map for ${VISION}`);
  const slots = new Map<string, string>();
  for (const uid of sessions) {
    const session = luna.sessions.items.byId(uid);
    if (!session) throw new Error(`test: no session ${uid}`);
    await session.ready();
    const track = session.tracks.byId('Vocal');
    if (!track) throw new Error('test: no Vocal track');
    await track.effects.load();
    const slot = await track.insert(VISION, 'effect_2');
    if (!slot) throw new Error('test: insert failed');
    slots.set(uid, slot.path);
    const seen = new Set<string>();
    for (const page of map.pages) {
      for (const a of page.assignments) {
        if (seen.has(a.parameter.id)) continue;
        seen.add(a.parameter.id);
        addParam(engine, `${slot.path}/controls/${a.parameter.id}`, a.parameter.name);
      }
    }
  }
  await engine.settled();
  const [first] = sessions;
  const firstSession = (): Luna.Session => {
    const found = first === undefined ? undefined : luna.sessions.items.byId(first);
    if (!found) throw new Error('test: no first session');
    return found;
  };
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
  const record = (event: string): void => { events.push(event); };
  const sent = (): string[] => engine.midiSent.map((m) => toHex(m.sysex ?? m.bytes));
  // The parameter's value in session `uid` (the first session by default).
  const valueOf = (id: string, uid: string = first ?? ''): unknown => {
    const path = slots.get(uid);
    if (path === undefined) throw new Error(`test: no insert in session ${uid}`);
    return engine.value(`${path}/controls/${id}`, 'normalized_value');
  };
  return { engine, luna, firstSession, bundle, record, receive, settle, sent, valueOf, events };
}
