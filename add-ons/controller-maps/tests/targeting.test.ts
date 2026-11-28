import { describe, expect, it, vi } from 'vitest';
import { createTargeting } from '@/core/targeting';

const VISION = 'com.uaudio.uadx.api.vision';
const COMP = 'com.uaudio.uadx.1176';

async function rig(): Promise<{ session: Luna.Session; vocal: Luna.Track; bass: Luna.Track }> {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { tracks: ['Vocal', 'Bass'], name: 'Demo' });
  engine.addPlugin(VISION, { name: 'API Vision' });
  engine.addPlugin(COMP, { name: '1176' });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  const session = await luna.session();
  await session.ready();
  const vocal = session.tracks.byId('Vocal');
  const bass = session.tracks.byId('Bass');
  if (!vocal || !bass) throw new Error('tracks missing');
  await Promise.all([vocal.effects.load(), bass.effects.load()]);
  return { session, vocal, bass };
}

function slotOf(track: Luna.Track, id: string): Luna.Effect {
  const slot = track.effects.byId(id);
  if (!slot) throw new Error(`no slot ${id}`);
  return slot;
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

describe('targeting', () => {
  it('is none until chosen', async () => {
    const { session } = await rig();
    const targeting = createTargeting(session);
    expect(targeting.current()).toEqual({ state: 'none', reason: 'Choose a track and insert in the panel' });
  });

  it('is ready with the slot pluginId', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    const target = targeting.current();
    expect(target.state).toBe('ready');
    if (target.state !== 'ready') return;
    expect(target.pluginId).toBe(VISION);
    expect(target.track.id).toBe('Vocal');
    expect(target.slot.id).toBe('effect_0');
  });

  it('replacing the plugin updates pluginId and notifies', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    const listener = vi.fn();
    targeting.onChange(listener);
    await slotOf(vocal, 'effect_0').setPlugin(COMP);
    await flush();
    const target = targeting.current();
    expect(target.state === 'ready' && target.pluginId).toBe(COMP);
    expect(listener).toHaveBeenCalled();
  });

  it('clearing the slot gives none', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    const listener = vi.fn();
    targeting.onChange(listener);
    await slotOf(vocal, 'effect_0').clear();
    await flush();
    expect(targeting.current()).toEqual({ state: 'none', reason: 'The chosen insert is now empty' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('deleting the track gives none', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    const listener = vi.fn();
    targeting.onChange(listener);
    await vocal.delete();
    await flush();
    expect(targeting.current()).toEqual({ state: 'none', reason: 'The chosen track was deleted' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('an empty slot cannot be chosen', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    await expect(targeting.choose('Vocal', 'effect_1')).rejects.toThrow('Track "Vocal" slot effect_1 is empty');
    const target = targeting.current();
    expect(target.state === 'ready' && target.slot.id).toBe('effect_0');
  });

  it('an unknown track or slot is rejected by id', async () => {
    const { session } = await rig();
    const targeting = createTargeting(session);
    await expect(targeting.choose('Nope', 'effect_0')).rejects.toThrow('Nope');
    await expect(targeting.choose('Vocal', 'effect_99')).rejects.toThrow('effect_99');
  });

  it('two copies of one plugin on a track stay apart', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_1');
    await vocal.insert(VISION, 'effect_2');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_2');
    const target = targeting.current();
    expect(target.state === 'ready' && target.slot.id).toBe('effect_2');
    const listener = vi.fn();
    targeting.onChange(listener);
    await slotOf(vocal, 'effect_1').setPlugin(COMP);
    await flush();
    const after = targeting.current();
    expect(after.state === 'ready' && [after.slot.id, after.pluginId]).toEqual(['effect_2', VISION]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('clear returns to none and stops listening', async () => {
    const { session, vocal } = await rig();
    await vocal.insert(VISION, 'effect_0');
    const targeting = createTargeting(session);
    await targeting.choose('Vocal', 'effect_0');
    targeting.clear();
    expect(targeting.current()).toEqual({ state: 'none', reason: 'Choose a track and insert in the panel' });
    const listener = vi.fn();
    targeting.onChange(listener);
    await slotOf(vocal, 'effect_0').setPlugin(COMP);
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });
});
