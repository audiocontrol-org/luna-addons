// The generic surface runtime against Luna.MockEngine. Every case runs once on the bundled
// definition of a real device (exact bytes) and once on a fictional device, with no code change.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import type { Bundle, SurfaceDefinition } from '@/bundle/types';
import type { Intent, Role, Surface } from '@/surface/api';
import { ROLES } from '@/surface/roles';
import { createSurface } from '@/surface/runtime/create';
import { TEST_SURFACE } from './fixtures/test-surface';

const bundlePath = fileURLToPath(new URL('../src/bundle/generated.json', import.meta.url));
const bundle: Bundle = JSON.parse(readFileSync(bundlePath, 'utf8'));

function bundled(id: string): SurfaceDefinition {
  const definition = bundle.surfaces[id];
  if (!definition) throw new Error(`The bundle has no surface ${id}; run npm run bundle`);
  return definition;
}

interface Case {
  name: string;
  definition: SurfaceDefinition;
  claim: string[];
  readyReport: string;
  suspendedReport: string;
  unknownReport: string;
  unknownReason: string;
  move: { inbound: string; control: string; value: number };
  freeButton: string;
  next: { control: string; with: string };
  follow: { control: string; sent: string };
  nonFollow: string;
  label: { control: string; text: string; sent: string[] };
  announce: { text: string; sent: string[] };
  indicatePlay: string[];
  release: string[];
  bindingText: Record<Role, string | undefined>;
}

const CASES: Case[] = [
  {
    name: 'bundled lcxl3-daw',
    definition: bundled('lcxl3-daw'),
    claim: ['F0 00 20 29 02 15 02 7F F7', 'B6 1E 02', 'B6 45 00', 'B6 48 00', 'B6 49 00'],
    readyReport: 'B6 1E 02',
    suspendedReport: 'B6 1E 06',
    unknownReport: 'B6 1E 0C',
    unknownReason: 'Unrecognised mode report 12 from lcxl3-daw',
    move: { inbound: 'BF 0D 40', control: 'encoder_1_1', value: 64 / 127 },
    freeButton: 'button_top_1',
    next: { control: 'button_side', with: 'shift' },
    follow: { control: 'encoder_1_1', sent: 'BF 0D 40' },
    nonFollow: 'fader_1',
    label: {
      control: 'encoder_1_1',
      text: 'Gain',
      sent: ['F0 00 20 29 02 15 04 0D 62 F7', 'F0 00 20 29 02 15 06 0D 01 47 61 69 6E F7'],
    },
    announce: { text: 'Page 1', sent: ['F0 00 20 29 02 15 04 36 62 F7', 'F0 00 20 29 02 15 06 36 01 50 61 67 65 20 31 F7'] },
    indicatePlay: ['B0 74 21'],
    release: ['B0 74 00', 'F0 00 20 29 02 15 02 00 F7'],
    bindingText: { 'page.next': 'button_side', 'page.previous': 'shift + button_side', 'transport.play': 'play', 'transport.record': 'record' },
  },
  {
    name: 'fictional test-pad',
    definition: TEST_SURFACE,
    claim: ['B8 64 01', 'F0 7D 11 22 F7'],
    readyReport: 'B8 65 05',
    suspendedReport: 'B8 65 09',
    unknownReport: 'B8 65 0C',
    unknownReason: 'Unrecognised mode report 12 from test-pad',
    move: { inbound: 'B2 28 40', control: 'knob_a', value: 64 / 127 },
    freeButton: 'pad_free',
    next: { control: 'pad_next', with: 'fn' },
    follow: { control: 'knob_a', sent: 'F0 7D 20 03 28 40 F7' },
    nonFollow: 'knob_b',
    label: { control: 'knob_a', text: 'Gain', sent: ['F0 7D 30 28 47 61 69 6E F7'] },
    announce: { text: 'Page 1', sent: ['F0 7D 31 50 61 67 65 20 31 00 F7'] },
    indicatePlay: ['B1 3E 5A'],
    release: ['B1 3E 03', 'F0 7D 11 00 F7', 'B8 64 00'],
    bindingText: { 'page.next': 'pad_next', 'page.previous': 'fn + pad_next', 'transport.play': 'pad_play or fn + pad_alt', 'transport.record': undefined },
  },
];

const toHex = (bytes: readonly number[]): string => bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
const fromHex = (text: string): number[] => text.split(' ').map((t) => parseInt(t, 16));

interface Rig {
  engine: Luna.MockEngine;
  luna: Luna.Client;
  surface: Surface;
  intents: Intent[];
  definition: SurfaceDefinition;
  inputUid: string;
  settle(): Promise<void>;
  receive(...messages: string[]): Promise<void>;
  press(control: string, value: number): Promise<void>;
  sentSince(mark: number): string[];
  plug(options?: { outputOnly?: boolean; inputOnly?: boolean }): void;
  unplug(): void;
}

// One MIDI device per distinct port name, as LUNA lists them, with only the ports the profile uses.
async function rig(definition: SurfaceDefinition, options: { plugged?: boolean; others?: string[] } = {}): Promise<Rig> {
  const engine = new Luna.MockEngine();
  const { input, output } = definition.profile.ports;
  const names = input === output ? [input] : [input, output];
  const uidOf = (name: string): string => `dev_${names.indexOf(name)}`;
  for (const other of options.others ?? []) engine.addMidiDevice(other);
  const plug = (only: { outputOnly?: boolean; inputOnly?: boolean } = {}): void => {
    for (const name of names) {
      const hasInput = name === input && only.outputOnly !== true;
      const hasOutput = name === output && only.inputOnly !== true;
      if (hasInput || hasOutput) engine.addMidiDevice(name, { uid: uidOf(name), input: hasInput, output: hasOutput });
    }
  };
  const unplug = (): void => {
    for (const name of names) engine.removeNode(`/devices/${Luna.LUNA_DEVICE_UID}/midi/${uidOf(name)}`);
  };
  if (options.plugged !== false) plug();
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const surface = createSurface(luna, definition);
  const intents: Intent[] = [];
  surface.onIntent((intent) => intents.push(intent));
  const settle = async (): Promise<void> => {
    for (let i = 0; i < 4; i++) {
      await engine.settled();
      await luna.settled();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };
  const receive = async (...messages: string[]): Promise<void> => {
    engine.receiveMidi(uidOf(input), messages.map(fromHex));
    await settle();
  };
  const press = async (control: string, value: number): Promise<void> => {
    const found = definition.profile.controls.find((c) => c.id === control);
    if (!found) throw new Error(`test: no control ${control}`);
    engine.receiveMidi(uidOf(input), [[176 + found.address.channel - 1, found.address.cc, value]]);
    await settle();
  };
  const outputPort = `${uidOf(output)}_out`;
  const sentSince = (mark: number): string[] =>
    engine.midiSent.slice(mark).map((m) => {
      expect(m.outputPortUid).toBe(outputPort);
      return toHex(m.sysex ?? m.bytes);
    });
  return { engine, luna, surface, intents, definition, inputUid: uidOf(input), settle, receive, press, sentSince, plug, unplug };
}

async function ready(c: Case): Promise<Rig> {
  const r = await rig(c.definition);
  await r.surface.claim();
  await r.receive(c.readyReport);
  expect(r.surface.status()).toEqual({ state: 'ready' });
  return r;
}

describe.each(CASES)('surface runtime: $name', (c) => {
  it('claim sends the claim sequence in order', async () => {
    const r = await rig(c.definition);
    await r.surface.claim();
    await r.settle();
    expect(r.sentSince(0)).toEqual(c.claim);
  });

  it('claiming until a ready mode report', async () => {
    const r = await rig(c.definition);
    await r.surface.claim();
    expect(r.surface.status().state).toBe('claiming');
    await r.receive(c.move.inbound);
    expect(r.intents).toEqual([]);
    await r.receive(c.readyReport);
    expect(r.surface.status()).toEqual({ state: 'ready' });
    await r.receive(c.move.inbound);
    expect(r.intents).toEqual([{ kind: 'move', control: c.move.control, value: c.move.value }]);
  });

  it("a suspended mode value suspends with the profile's reason", async () => {
    const r = await ready(c);
    await r.receive(c.suspendedReport);
    const reason = c.definition.profile.protocol.mode?.suspended[0]?.reason;
    expect(r.surface.status()).toEqual({ state: 'suspended', reason });
    await r.receive(c.move.inbound);
    expect(r.intents).toEqual([]);
  });

  it('a mode value the profile does not list suspends', async () => {
    const r = await ready(c);
    await r.receive(c.unknownReport);
    expect(r.surface.status()).toEqual({ state: 'suspended', reason: c.unknownReason });
    await r.receive(c.move.inbound);
    expect(r.intents).toEqual([]);
  });

  it('a button no layout binding owns gives press and release', async () => {
    const r = await ready(c);
    await r.press(c.freeButton, 127);
    await r.press(c.freeButton, 0);
    expect(r.intents).toEqual([
      { kind: 'press', control: c.freeButton },
      { kind: 'release', control: c.freeButton },
    ]);
  });

  it('a layout binding emits its role', async () => {
    const r = await ready(c);
    await r.press(c.next.control, 127);
    await r.press(c.next.control, 0);
    expect(r.intents).toEqual([{ kind: 'role', role: 'page.next' }]);
    r.intents.length = 0;
    await r.press(c.next.with, 127);
    expect(r.intents).toEqual([]);
    await r.press(c.next.control, 127);
    await r.press(c.next.control, 0);
    await r.press(c.next.with, 0);
    expect(r.intents).toEqual([{ kind: 'role', role: 'page.previous' }]);
  });

  it('bindingText names the binding from the layout', async () => {
    const r = await rig(c.definition);
    for (const role of ROLES) expect(r.surface.bindingText(role)).toBe(c.bindingText[role]);
  });

  it('missing port', async () => {
    const r = await rig(c.definition, { plugged: false, others: ['Another Synth'] });
    r.plug({ inputOnly: true });
    await r.settle();
    await r.surface.claim();
    const status = r.surface.status();
    expect(status.state).toBe('disconnected');
    const reason = status.state === 'ready' ? '' : status.reason;
    expect(reason).toContain('Another Synth');
    expect(reason).toContain(c.definition.profile.ports.input);
    expect(r.sentSince(0)).toEqual([]);
  });

  it('reconnect re-claims', async () => {
    const r = await ready(c);
    r.unplug();
    await r.settle();
    expect(r.surface.status().state).toBe('disconnected');
    const mark = r.engine.midiSent.length;
    r.plug();
    // The re-claim runs from LUNA's device-list change, one message after another.
    await vi.waitFor(() => expect(r.sentSince(mark)).toEqual(c.claim));
    expect(r.surface.status().state).toBe('claiming');
    await r.receive(c.readyReport);
    expect(r.surface.status()).toEqual({ state: 'ready' });
  });

  it('follow, label, announce and indicate fill their templates', async () => {
    const r = await ready(c);
    const mark = r.engine.midiSent.length;
    await r.surface.follow(c.follow.control, 0.5);
    expect(r.sentSince(mark)).toEqual([c.follow.sent]);
    const labelMark = r.engine.midiSent.length;
    await r.surface.label(c.label.control, c.label.text);
    expect(r.sentSince(labelMark)).toEqual(c.label.sent);
    const announceMark = r.engine.midiSent.length;
    await r.surface.announce(c.announce.text);
    expect(r.sentSince(announceMark)).toEqual(c.announce.sent);
    const indicateMark = r.engine.midiSent.length;
    await r.surface.indicate('transport.play', 'active');
    expect(r.sentSince(indicateMark)).toEqual(c.indicatePlay);
  });

  it('follow clamps to the 7-bit range and refuses a control that does not follow', async () => {
    const r = await ready(c);
    const mark = r.engine.midiSent.length;
    await r.surface.follow(c.follow.control, 1.5);
    await r.surface.follow(c.follow.control, 1);
    const [over, top] = r.sentSince(mark);
    expect(over).toBe(top);
    await expect(r.surface.follow(c.nonFollow, 0.5)).rejects.toThrow(c.nonFollow);
    await expect(r.surface.label('no_such_control', 'x')).rejects.toThrow('no_such_control');
  });

  it('release clears indications, then sends the release sequence', async () => {
    const r = await ready(c);
    await r.surface.indicate('transport.play', 'active');
    const mark = r.engine.midiSent.length;
    await r.surface.release();
    expect(r.sentSince(mark)).toEqual(c.release);
    expect(r.surface.status().state).toBe('released');
    await r.receive(c.move.inbound);
    expect(r.intents).toEqual([]);
  });

  it('a mode report during or after release leaves the status released', async () => {
    const r = await ready(c);
    await r.surface.indicate('transport.play', 'active');
    const releasing = r.surface.release();
    // The release sequence provokes a mode report; it arrives while the sequence is still going out.
    r.engine.receiveMidi(r.inputUid, [fromHex(c.readyReport)]);
    await r.settle();
    await releasing;
    await r.receive(c.readyReport, c.move.inbound);
    expect(r.surface.status().state).toBe('released');
    expect(r.intents).toEqual([]);
  });

  it('a request with no template throws', async () => {
    const { protocol } = c.definition.profile;
    const stripped: SurfaceDefinition = { ...c.definition, profile: { ...c.definition.profile, protocol: { ...protocol, label: undefined } } };
    const r = await rig(stripped);
    await r.surface.claim();
    await r.receive(c.readyReport);
    const id = c.definition.profile.surface;
    await expect(r.surface.label(c.label.control, 'x')).rejects.toThrow(new RegExp(`${id}.*label`));
    await expect(r.surface.indicate('page.next', 'active')).rejects.toThrow(new RegExp(`page\\.next.*${id}|${id}.*page\\.next`));
    expect(r.sentSince(0)).toEqual(c.claim);
  });

  it('refuses a layout role the Add On does not implement', () => {
    const engine = new Luna.MockEngine();
    const layout = { ...c.definition.layout, bindings: [{ role: 'transport.loop', press: { control: c.freeButton } }] };
    return Luna.connect({ port_: engine.port() }).then((luna) => {
      expect(() => createSurface(luna, { ...c.definition, layout })).toThrow(/transport\.loop/);
    });
  });
});
