// Targeting signals probe (open question 1): a timeline of what LUNA reports while the
// operator walks the scenario. Each step waits for probes/results/next.
//   npm run probe -w probes -- src/targeting.ts
import { connectLive, requireSession } from '@/lib/connect';
import { waitForNext } from '@/lib/next';
import { writeResult } from '@/lib/results';
import type { Luna } from '@uaudio/luna-builder-sdk';

const STEPS = [
  'Select track A',
  "Open an insert editor on track A",
  "Select track B without closing A's editor",
  'Open an insert editor on track B',
  'Insert the same plugin twice on track B, then open the second one',
  "Replace the plugin in one of track B's slots with another plugin",
  'Delete an insert whose editor is open',
  'Close all editors',
];

interface Event {
  t: number;
  signal: string;
  value: unknown;
}

const start = Date.now();
const timeline: Event[] = [];
const log = (line: string): void => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${line}`);
const push = (signal: string, value: unknown): void => {
  timeline.push({ t: Date.now() - start, signal, value });
  log(`${signal} ${JSON.stringify(value)}`);
};

const luna = await connectLive();
const unsubscribes: Luna.Unsubscribe[] = [];
try {
  const session = await requireSession(luna);
  const describeSlots = (track: Luna.Track): unknown =>
    track.effects.items.filter((e) => e.pluginId.value).map((e) => ({ slot: e.insertType.value, pluginId: e.pluginId.value, uid: e.uid.value }));
  const watched = new Set<string>();
  const watchTrack = async (track: Luna.Track): Promise<void> => {
    if (watched.has(track.id)) return;
    watched.add(track.id);
    await track.effects.load();
    unsubscribes.push(track.effects.onChange(() => push('effects', { track: track.name.value, slots: describeSlots(track) })));
    for (const slot of track.effects.items) {
      unsubscribes.push(slot.pluginId.onChange(() => push('slot.pluginId', { track: track.name.value, slot: slot.insertType.value, pluginId: slot.pluginId.value })));
    }
  };
  for (const track of session.tracksInOrder) await watchTrack(track);
  unsubscribes.push(session.tracks.onChange(() => {
    push('tracks', session.tracksInOrder.map((t) => t.name.value));
    for (const track of session.tracksInOrder) void watchTrack(track);
  }));
  unsubscribes.push(session.focusedTrack.onChange(() => push('focusedTrack', session.focusedTrack.value?.name.value ?? null)));
  await luna.gui.watchPluginWindows();
  const windows = (): unknown =>
    (luna.gui.pluginWindows.value ?? []).map((w) => ({ track: session.tracks.byId(w.channelUid)?.name.value ?? w.channelUid, slot: w.slot }));
  unsubscribes.push(luna.gui.pluginWindows.onChange(() => push('pluginWindows', windows())));
  push('initial', { focusedTrack: session.focusedTrack.value?.name.value ?? null, pluginWindows: windows() });

  for (const [i, step] of STEPS.entries()) {
    await waitForNext(log, `ready for step ${i + 1}: ${step}`);
    push('step', `${i + 1}: ${step}`);
  }
  await waitForNext(log, 'done with the last step');
} finally {
  for (const u of unsubscribes) u();
  const path = await writeResult('targeting', { timeline });
  log(`Result: ${path}`);
  await luna.close();
}
