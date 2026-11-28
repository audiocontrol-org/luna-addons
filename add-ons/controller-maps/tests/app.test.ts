// The app against Luna.MockEngine, with the bundled API Vision map and a fake Surface driven
// by intents. The surface is injected; the app never sees a surface definition.
import { afterEach, describe, expect, it } from 'vitest';
import { flush, forgetRunning, move, rig, stopRunning, UNMAPPED, VISION, visionMap } from './fixtures/app-rig';

describe('app', () => {
  afterEach(stopRunning);

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
    // The refused page is still announced, so the user sees where they are.
    expect(surface.announcements).toEqual(['560 EQ 2/2']);
  });

  it('a refused page does not trap the user: paging moves on to a page that binds (R11)', async () => {
    const { surface, valueOf, app } = await rig({ leaveOut: ['560_31hz'] });
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(app.state().resolution?.ok).toBe(false);
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2', 'Channel 1/2']);
    const r = app.state().resolution;
    expect(r?.ok && r.pageName).toBe('Channel');
    app.page(-1);
    await flush();
    app.page(1);
    await flush();
    expect(surface.announcements).toEqual(['560 EQ 2/2', 'Channel 1/2', '560 EQ 2/2', 'Channel 1/2']);
    move(surface, 'encoder_1_1', 0.61);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.61);
  });

  it('a move right after page.next reaches no old binding', async () => {
    const { engine, surface, slot, valueOf } = await rig();
    engine.touches.length = 0;
    surface.emit({ kind: 'role', role: 'page.next' });
    move(surface, 'encoder_1_1', 0.77);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.5);
    expect(engine.touches.filter((t) => t.startsWith(`${slot.path}/controls/550_hf_freq`))).toEqual([]);
  });

  it('a move right after the plugin is swapped reaches no old binding', async () => {
    const { engine, surface, slot, valueOf, app } = await rig();
    engine.touches.length = 0;
    // Subscribed after the app, so this runs right after the app sees the change.
    app.targeting.onChange(() => { move(surface, 'encoder_1_1', 0.88); });
    await slot.setPlugin(UNMAPPED);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.5);
    expect(engine.touches.filter((t) => t.startsWith(`${slot.path}/controls/550_hf_freq`))).toEqual([]);
  });

  it('a surface not ready at start: nothing is followed, labelled or announced until it is ready', async () => {
    const { surface, valueOf } = await rig({ status: { state: 'claiming', reason: 'fake claiming' } });
    expect(surface.follows).toEqual([]);
    expect(surface.labels).toEqual([]);
    expect(surface.announcements).toEqual([]);
    surface.setStatus({ state: 'ready' });
    await flush();
    expect(surface.follows.map((f) => f.control)).toContain('encoder_1_1');
    expect(surface.labels.length).toBeGreaterThan(0);
    move(surface, 'encoder_1_1', 0.42);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.42);
  });

  it('readiness lost while a rebuild waits for the load: the stale rebuild applies nothing', async () => {
    const { surface, valueOf, app } = await rig({ target: false });
    await app.targeting.choose('Vocal', 'effect_0');
    expect(app.state().resolution).toBeUndefined(); // the rebuild is still waiting for the load
    surface.setStatus({ state: 'suspended', reason: 'fake suspended' });
    await flush();
    expect(surface.follows).toEqual([]);
    expect(surface.labels).toEqual([]);
    move(surface, 'encoder_1_1', 0.33);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.5);
  });

  it('the target changing while a rebuild waits for the load: the stale rebuild applies nothing', async () => {
    const { surface, app } = await rig({ target: false });
    await app.targeting.choose('Vocal', 'effect_0');
    expect(app.state().resolution).toBeUndefined(); // the rebuild is still waiting for the load
    app.targeting.clear();
    await flush();
    expect(surface.labels).toEqual([]);
    expect(surface.follows).toEqual([]);
    expect(app.state().resolution).toBeUndefined();
  });

  it('two quick page changes: only the last one binds and announces', async () => {
    const { surface } = await rig();
    surface.labels.length = 0;
    surface.emit({ kind: 'role', role: 'page.next' });
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    expect(surface.announcements).toEqual(['Channel 1/2']);
    const first = visionMap().pages[0];
    if (!first) throw new Error('the API Vision map has no pages');
    expect(surface.labels).toEqual(first.assignments.map((a) => ({ control: a.control, text: a.parameter.name })));
  });

  it('swapping from an unmapped plugin back to a mapped one rebuilds with the map', async () => {
    const { surface, slot, valueOf, app } = await rig();
    await slot.setPlugin(UNMAPPED);
    await flush();
    expect(app.state().resolution?.ok).toBe(false);
    surface.labels.length = 0;
    await slot.setPlugin(VISION);
    await flush();
    const r = app.state().resolution;
    expect(r?.ok && r.pageName).toBe('Channel');
    expect(surface.labels.length).toBeGreaterThan(0);
    move(surface, 'encoder_1_1', 0.27);
    await flush();
    expect(valueOf('550_hf_freq')).toBe(0.27);
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
    forgetRunning();
    await flush();
    expect(engine.touches.at(-1)).toBe(`${slot.path}/controls/550_hf_freq:off`);
    expect(surface.listenerCount()).toBe(0);
    expect(surface.calls.release).toBe(0);
  });
});
