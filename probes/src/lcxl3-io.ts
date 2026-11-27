// LCXL3 ports, modes and feedback probe (open questions 2, 5 and 6). Stop the Rust
// midi-macro-bridge first: phase 3 claims the LCXL3's DAW mode.
//
//   npm run probe -w probes -- src/lcxl3-io.ts --midi-in "LCXL3 1 MIDI Out" --midi-out "LCXL3 1 MIDI In" \
//     --daw-in "LCXL3 1 DAW Out" --daw-out "LCXL3 1 DAW In"
//
// LUNA lists each port direction as its own device: the controller's "Out" ports are what the
// probe listens on (--midi-in, --daw-in), its "In" ports are what it sends to (--midi-out,
// --daw-out). Each phase waits for probes/results/next to appear (`touch` it), then deletes it.
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { connectLive } from '@/lib/connect';
import { findDevice } from '@/lib/devices';
import { writeResult } from '@/lib/results';
import { DAW_MODE_OFF, DAW_MODE_ON, decodeModeReport, MODE_CC, MODE_CHANNEL } from '@/lcxl3-protocol';

interface Seen {
  phase: string;
  t: number;
  port: string;
  type: string;
  channel: number;
  data1: number;
  data2: number;
  sysex: number[] | undefined;
  mode: ReturnType<typeof decodeModeReport>;
}

const argv = process.argv.slice(2);
const NEXT = join(process.cwd(), 'results', 'next');
const start = Date.now();
const log = (line: string): void => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${line}`);

async function waitForNext(prompt: string): Promise<void> {
  log(`WAITING: ${prompt}  (touch probes/results/next to continue)`);
  while (!existsSync(NEXT)) await new Promise((resolve) => setTimeout(resolve, 250));
  unlinkSync(NEXT);
}

const luna = await connectLive();
await luna.midiDevices.load();
const midiIn = findDevice(luna.midiDevices.items, requireArg(argv, 'midi-in'));
const midiOut = findDevice(luna.midiDevices.items, requireArg(argv, 'midi-out'));
const dawIn = findDevice(luna.midiDevices.items, requireArg(argv, 'daw-in'));
const dawOut = findDevice(luna.midiDevices.items, requireArg(argv, 'daw-out'));
const input = new Luna.MidiInput(luna);
const send = new Luna.SendMidi(luna);

const seen: Seen[] = [];
const notes: Record<string, unknown> = {};
let phase = 'standalone';
const record = (port: string) => (m: Luna.MidiInputMessage): void => {
  seen.push({ phase, t: Date.now() - start, port, type: m.type, channel: m.channel, data1: m.data1, data2: m.data2, sysex: m.sysex ? [...m.sysex] : undefined, mode: decodeModeReport(m) });
  log(`${port} ${m.type} ch${m.channel + 1} ${m.data1} ${m.data2}`);
};
const stops = [input.listen(midiIn, record('midi'), { sysex: true }), input.listen(dawIn, record('daw'), { sysex: true })];

let dawClaimed = false;
async function leaveDawMode(): Promise<void> {
  if (!dawClaimed) return;
  dawClaimed = false;
  await send.sendSysExToOutput(dawOut, DAW_MODE_OFF);
  log('sent DAW mode OFF');
}
process.on('SIGINT', () => void leaveDawMode().finally(() => process.exit(130)));
process.on('SIGTERM', () => void leaveDawMode().finally(() => process.exit(143)));

try {
  await waitForNext('ready to start phase 1 (standalone custom mode)');
  log('PHASE 1: turn knobs, move faders, press buttons, switch custom modes and pages on the device');
  await waitForNext('done with phase 1');

  phase = 'led';
  const button = [...seen].reverse().find((s) => s.type === 'controlChange' && (s.data2 === 127 || s.data2 === 0));
  if (button) {
    notes['ledControl'] = { cc: button.data1, channel: button.channel };
    log(`PHASE 2: LED test on CC ${button.data1} ch${button.channel + 1}: watch that button's LED`);
    for (const value of [5, 21, 45, 0, 127, 0]) {
      await send.sendControllerToOutput(midiOut, button.data1, value, button.channel);
      log(`  sent value ${value}`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } else {
    notes['ledControl'] = 'no button press seen in phase 1; LED test skipped';
    log('PHASE 2 skipped: no button press seen in phase 1');
  }
  await waitForNext('done watching the LED (tell Claude what you saw)');

  phase = 'daw';
  await send.sendSysExToOutput(dawOut, DAW_MODE_ON);
  dawClaimed = true;
  log('PHASE 3: sent DAW mode ON. Switch modes and custom modes on the device');
  await waitForNext('done switching modes by hand');
  phase = 'daw-host-select';
  await send.sendControllerToOutput(dawOut, MODE_CC, 0x06, MODE_CHANNEL);
  log('sent B6 1E 06 (select custom mode 1): does the device switch?');
  await waitForNext('done checking the host-selected mode');
} finally {
  await leaveDawMode();
  for (const stop of stops) stop();
  const path = await writeResult('lcxl3-io', { notes, seen });
  log(`Result: ${path}`);
  await luna.close();
}
