import { afterEach, describe, expect, it, vi } from 'vitest';
import { createParameterWriter, type BoundParameter, type ParameterWriter } from '@/core/writer/writer';
import type { ResolvedBinding } from '@/core/resolve';
import { createFakeSurface, type FakeSurface } from './fixtures/fake-surface';

const PLUGIN = 'com.uaudio.uadx.1176';
const IDLE = 250;

async function rig(): Promise<{ engine: Luna.MockEngine; input: Luna.Control; bypass: Luna.Control; surface: FakeSurface }> {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { tracks: ['Vocal'], name: 'Demo' });
  engine.addPlugin(PLUGIN, { name: 'UA 1176' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  const track = session.tracks.byId('Vocal');
  if (!track) throw new Error('no Vocal track');
  await track.effects.load();
  const slot = await track.insert(PLUGIN);
  if (!slot) throw new Error('insert failed');
  await slot.controls.load();
  const input = slot.controls.byId('input');
  const bypass = slot.controls.byId('bypass');
  if (!input || !bypass) throw new Error('1176 controls missing');
  const surface = createFakeSurface([
    { id: 'knob', continuous: true, follows: true },
    { id: 'slider', continuous: true, follows: false },
    { id: 'pad', continuous: false, follows: false },
  ]);
  // Fake timers only once connected: the SDK's own scheduling needs real ones to connect.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  return { engine, input, bypass, surface };
}

const bind = (control: string, param: Luna.Control, mode?: 'toggle' | 'momentary'): BoundParameter => {
  const binding: ResolvedBinding = { control, paramId: param.id, label: param.id };
  if (mode !== undefined) binding.mode = mode;
  return { binding, param };
};

// The app routes the surface's intents to the writer; the helper does the same.
function make(surface: FakeSurface, record: (event: string, detail: unknown) => void = () => undefined): ParameterWriter {
  const writer = createParameterWriter(surface, IDLE, record);
  surface.onIntent((intent) => { writer.handle(intent); });
  return writer;
}

// Fake timers drive the SDK's scheduling and the mock engine's replies.
const settle = async (_engine?: Luna.MockEngine): Promise<void> => {
  for (let i = 0; i < 5; i++) await vi.advanceTimersByTimeAsync(1);
};

describe('parameter writer', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('a move writes inside one touch', async () => {
    const { engine, input, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('knob', input)]);
    engine.touches.length = 0;
    for (const value of [0.2, 0.4, 0.6]) surface.emit({ kind: 'move', control: 'knob', value });
    await settle(engine);
    expect(engine.touches).toEqual([`${input.path}:on`]);
    expect(engine.value(input.path, 'normalized_value')).toBe(0.6);
    vi.advanceTimersByTime(IDLE);
    await settle(engine);
    expect(engine.touches).toEqual([`${input.path}:on`, `${input.path}:off`]);
  });

  it('assign follows each "follows" control to its parameter\'s value', async () => {
    const { engine, input, bypass, surface } = await rig();
    engine.setValue(input.path, 'normalized_value', 0.25);
    await settle(engine);
    const writer = make(surface);
    writer.assign([bind('knob', input), bind('slider', bypass)]);
    expect(surface.follows).toEqual([{ control: 'knob', value: 0.25 }]);
  });

  it('pickup for a control that does not follow', async () => {
    const { engine, input, surface } = await rig();
    engine.setValue(input.path, 'normalized_value', 0.5);
    await settle(engine);
    const writer = make(surface);
    writer.assign([bind('slider', input)]);
    surface.emit({ kind: 'move', control: 'slider', value: 0.1 });
    surface.emit({ kind: 'move', control: 'slider', value: 0.3 });
    await settle(engine);
    expect(input.normalized.value).toBe(0.5);
    surface.emit({ kind: 'move', control: 'slider', value: 0.52 });
    surface.emit({ kind: 'move', control: 'slider', value: 0.7 });
    await settle(engine);
    expect(input.normalized.value).toBe(0.7);
    expect(surface.follows).toEqual([]);
  });

  it('assign mid-gesture releases the old touch and drops later intents for the old binding', async () => {
    const { engine, input, bypass, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('knob', input)]);
    surface.emit({ kind: 'move', control: 'knob', value: 0.3 });
    await settle(engine);
    writer.assign([bind('knob', bypass)]);
    await settle(engine);
    expect(engine.touches).toContain(`${input.path}:off`);
    const before = engine.value(input.path, 'normalized_value');
    surface.emit({ kind: 'move', control: 'knob', value: 0.9 });
    await settle(engine);
    expect(engine.value(input.path, 'normalized_value')).toBe(before);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(0.9);
  });

  it('a parameter changed in LUNA re-follows the control, or re-arms pickup', async () => {
    const { engine, input, bypass, surface } = await rig();
    engine.setValue(input.path, 'normalized_value', 0.5);
    await settle(engine);
    const writer = make(surface);
    writer.assign([bind('knob', input), bind('slider', bypass)]);
    surface.follows.length = 0;
    // our own write does not echo back as a follow
    surface.emit({ kind: 'move', control: 'knob', value: 0.4 });
    await settle(engine);
    expect(surface.follows).toEqual([]);
    vi.advanceTimersByTime(IDLE); // the drag has ended
    await settle(engine);
    // an outside change does
    engine.setValue(input.path, 'normalized_value', 0.8);
    await settle(engine);
    expect(surface.follows).toEqual([{ control: 'knob', value: 0.8 }]);
    // pickup: let it pick up, then an outside change re-arms it
    engine.setValue(bypass.path, 'normalized_value', 0.5);
    await settle(engine);
    surface.emit({ kind: 'move', control: 'slider', value: 0.5 });
    await settle(engine);
    vi.advanceTimersByTime(IDLE);
    engine.setValue(bypass.path, 'normalized_value', 0.9);
    await settle(engine);
    surface.emit({ kind: 'move', control: 'slider', value: 0.2 });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(0.9);
  });

  it('toggle button flips once per press', async () => {
    const { engine, bypass, surface } = await rig();
    engine.setValue(bypass.path, 'normalized_value', 0);
    await settle(engine);
    const writer = make(surface);
    writer.assign([bind('pad', bypass, 'toggle')]);
    surface.emit({ kind: 'press', control: 'pad' });
    surface.emit({ kind: 'release', control: 'pad' });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(1);
    surface.emit({ kind: 'press', control: 'pad' });
    surface.emit({ kind: 'release', control: 'pad' });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(0);
  });

  it('momentary writes 1 on press and 0 on release', async () => {
    const { engine, bypass, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('pad', bypass, 'momentary')]);
    surface.emit({ kind: 'press', control: 'pad' });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(1);
    surface.emit({ kind: 'release', control: 'pad' });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(0);
  });

  it('a button binding without a mode writes nothing', async () => {
    const { engine, bypass, surface } = await rig();
    const events: string[] = [];
    const writer = make(surface, (event) => events.push(event));
    writer.assign([bind('pad', bypass)]);
    engine.touches.length = 0;
    surface.emit({ kind: 'press', control: 'pad' });
    surface.emit({ kind: 'release', control: 'pad' });
    await settle(engine);
    expect(engine.touches).toEqual([]);
    expect(events).toContain('ignored');
  });

  it('ignores intents for a control with no binding', async () => {
    const { engine, input, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('knob', input)]);
    engine.touches.length = 0;
    surface.emit({ kind: 'move', control: 'slider', value: 0.5 });
    writer.handle({ kind: 'press', control: 'pad' });
    await settle(engine);
    expect(engine.touches).toEqual([]);
  });

  it('throws naming a bound control the surface does not report', async () => {
    const { input, surface } = await rig();
    const writer = make(surface);
    expect(() => writer.assign([bind('ghost', input)])).toThrow(/ghost/);
  });

  it('release ends an open touch', async () => {
    const { engine, input, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('knob', input)]);
    surface.emit({ kind: 'move', control: 'knob', value: 0.3 });
    await settle(engine);
    writer.release('surface disconnected');
    await settle(engine);
    expect(engine.touches).toEqual([`${input.path}:on`, `${input.path}:off`]);
  });

  it('late or out-of-order echoes of its own writes during a drag are not outside changes', async () => {
    const { engine, input, bypass, surface } = await rig();
    engine.setValue(bypass.path, 'normalized_value', 0.5);
    await settle(engine);
    const writer = make(surface);
    writer.assign([bind('knob', input), bind('slider', bypass)]);
    surface.follows.length = 0;
    for (const value of [0.2, 0.4, 0.6]) surface.emit({ kind: 'move', control: 'knob', value });
    // stale notifications for earlier writes arrive after the later ones
    engine.setValue(input.path, 'normalized_value', 0.2);
    await settle(engine);
    engine.setValue(input.path, 'normalized_value', 0.4);
    await settle(engine);
    expect(surface.follows).toEqual([]);
    vi.advanceTimersByTime(IDLE);
    for (const value of [0.5, 0.52, 0.7]) surface.emit({ kind: 'move', control: 'slider', value });
    engine.setValue(bypass.path, 'normalized_value', 0.52);
    await settle(engine);
    expect(surface.follows).toEqual([]);
    // pickup did not re-arm: the next move still writes
    surface.emit({ kind: 'move', control: 'slider', value: 0.1 });
    await settle(engine);
    expect(engine.value(bypass.path, 'normalized_value')).toBe(0.1);
  });

  it('assign that throws partway leaves the old bindings working and follows nothing', async () => {
    const { engine, input, bypass, surface } = await rig();
    const writer = make(surface);
    writer.assign([bind('knob', input)]);
    surface.follows.length = 0;
    const missing: Luna.Control = Object.create(bypass, { normalized: { value: { value: undefined, onChange: () => () => undefined } } });
    expect(() => writer.assign([bind('knob', bypass), bind('slider', missing)])).toThrow(/slider/);
    expect(surface.follows).toEqual([]);
    surface.emit({ kind: 'move', control: 'knob', value: 0.3 });
    await settle(engine);
    expect(engine.value(input.path, 'normalized_value')).toBe(0.3);
    expect(engine.value(bypass.path, 'normalized_value')).not.toBe(0.3);
  });
});
