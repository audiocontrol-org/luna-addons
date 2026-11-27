// First live spike (throwaway): two LCXL3 controls drive two parameters on one explicitly
// chosen insert, with an explicit touch lifecycle. Use a disposable session.
//   npm run probe -w probes -- src/spike-write.ts --device "LCXL3 1 MIDI Out" --track "TRACK" --slot effect_1 \
//     --cc 13 --param "Mic Pre" --cc2 14 --param2 "Pre-Low"
// Ends when probes/results/next appears.
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { connectLive, requireSession } from '@/lib/connect';
import { findDevice } from '@/lib/devices';
import { createGestures, type GestureTarget } from '@/lib/gesture';
import { waitForNext } from '@/lib/next';
import { writeResult } from '@/lib/results';

const IDLE_MS = 250;
const argv = process.argv.slice(2);
const start = Date.now();
const events: Array<{ t: number; event: string; detail: unknown }> = [];
const log = (line: string): void => console.log(`[${((Date.now() - start) / 1000).toFixed(2)}s] ${line}`);
const record = (event: string, detail: unknown): void => {
  events.push({ t: Date.now() - start, event, detail });
  log(`${event} ${JSON.stringify(detail)}`);
};

function exactParam(slot: Luna.Effect, name: string): Luna.Control {
  const matches = slot.params.filter((p) => p.name.value === name);
  const [only] = matches;
  if (matches.length > 1) throw new Error(`Parameter name "${name}" is ambiguous on this insert (${matches.length} matches)`);
  if (!only) throw new Error(`No parameter named "${name}"; this insert has: ${slot.params.map((p) => p.name.value).join(', ')}`);
  return only;
}

const luna = await connectLive();
const session = await requireSession(luna);
await luna.midiDevices.load();
const device = findDevice(luna.midiDevices.items, requireArg(argv, 'device'));
const trackName = requireArg(argv, 'track');
const track = session.tracksInOrder.find((t) => t.name.value === trackName);
if (!track) throw new Error(`No track named "${trackName}"`);
await track.effects.load();
const slotName = requireArg(argv, 'slot');
const slot = track.effects.byId(slotName);
if (!slot || !slot.pluginId.value) throw new Error(`Track "${trackName}" has no plugin in slot ${slotName}`);
await slot.controls.load();

const targets = new Map<number, GestureTarget>();
const flagPairs: Array<[string, string]> = [['cc', 'param'], ['cc2', 'param2']];
for (const [ccFlag, paramFlag] of flagPairs) {
  const cc = Number(requireArg(argv, ccFlag));
  const name = requireArg(argv, paramFlag);
  const control = exactParam(slot, name);
  record('bound', { cc, param: name, id: control.id, normalized: control.normalized.value, touchable: control.touchable });
  control.normalized.onChange(() => record('value', { param: name, normalized: control.normalized.value, display: control.display.value }));
  targets.set(cc, {
    name,
    begin: () => control.begin(),
    end: () => control.end(),
    write: (normalized) => control.normalized.set(normalized),
  });
}
const gestures = createGestures(IDLE_MS, record);
const endGesture = (why: string): void => gestures.release(why);

const input = new Luna.MidiInput(luna);
const stop = input.onControlChange(device, (cc, value) => {
  const target = targets.get(cc);
  if (target) gestures.move(target, value / 127);
});

const shutdown = (code: number): void => {
  endGesture('signal');
  stop();
  void writeResult('spike-write', { events }).finally(() => luna.close().finally(() => process.exit(code)));
};
process.on('SIGINT', () => shutdown(130));
process.on('SIGTERM', () => shutdown(143));

await waitForNext(log, 'turn the bound knobs; touch probes/results/next to finish');
endGesture('finish');
stop();
const path = await writeResult('spike-write', { events });
log(`Result: ${path}`);
await luna.close();
