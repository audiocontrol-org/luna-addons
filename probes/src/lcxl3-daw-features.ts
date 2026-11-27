// LCXL3 DAW-mode features probe: the control map in the Control and Mixer layouts, encoder
// position push (pickup), display text and LED colours. Stop the Rust bridge first.
//
//   npm run probe -w probes -- src/lcxl3-daw-features.ts --midi-in "LCXL3 1 MIDI Out" \
//     --daw-in "LCXL3 1 DAW Out" --daw-out "LCXL3 1 DAW In"
//
// Byte reference: audiocontrol's midi-macro-bridge research (lcxl3-cc-map.md,
// lcxl3-handshake-trace.md). Each phase waits for probes/results/next.
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { connectLive } from '@/lib/connect';
import { findDevice } from '@/lib/devices';
import { waitForNext as waitForMarker } from '@/lib/next';
import { writeResult } from '@/lib/results';
import { DAW_MODE_OFF, DAW_MODE_ON, MODE_CC, MODE_CHANNEL } from '@/lcxl3-protocol';

const CH1 = 0;
const CH16 = 15;
const NOVATION = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15];
const sysex = (...body: number[]): number[] => [...NOVATION, ...body, 0xf7];
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0) & 0x7f);

const argv = process.argv.slice(2);
const start = Date.now();
const log = (line: string): void => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${line}`);
const waitForNext = (prompt: string): Promise<void> => waitForMarker(log, prompt);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const luna = await connectLive();
await luna.midiDevices.load();
const midiIn = findDevice(luna.midiDevices.items, requireArg(argv, 'midi-in'));
const dawIn = findDevice(luna.midiDevices.items, requireArg(argv, 'daw-in'));
const dawOut = findDevice(luna.midiDevices.items, requireArg(argv, 'daw-out'));
const input = new Luna.MidiInput(luna);
const send = new Luna.SendMidi(luna);
const cc = (number: number, value: number, channel: number): Promise<void> => send.sendControllerToOutput(dawOut, number, value, channel);

let phase = 'setup';
const seen: Array<{ phase: string; t: number; port: string; type: string; channel: number; data1: number; data2: number; sysex: number[] | undefined }> = [];
const record = (port: string) => (m: Luna.MidiInputMessage): void => {
  seen.push({ phase, t: Date.now() - start, port, type: m.type, channel: m.channel, data1: m.data1, data2: m.data2, sysex: m.sysex ? [...m.sysex] : undefined });
  log(`${phase} ${port} ${m.type} ch${m.channel + 1} ${m.data1} ${m.data2}`);
};
const stops = [input.listen(midiIn, record('midi'), { sysex: true }), input.listen(dawIn, record('daw'), { sysex: true })];

let claimed = false;
const release = async (): Promise<void> => {
  if (!claimed) return;
  claimed = false;
  await send.sendSysExToOutput(dawOut, DAW_MODE_OFF);
  log('sent DAW mode OFF');
};
process.on('SIGINT', () => void release().finally(() => process.exit(130)));
process.on('SIGTERM', () => void release().finally(() => process.exit(143)));

try {
  await send.sendSysExToOutput(dawOut, DAW_MODE_ON);
  claimed = true;
  await cc(MODE_CC, 0x02, MODE_CHANNEL);
  for (const row of [0x45, 0x48, 0x49]) await cc(row, 0x00, MODE_CHANNEL);
  log('DAW mode on, Control layout selected, all encoder rows absolute');

  phase = 'map-control';
  await waitForNext('CONTROL layout: move every fader and knob, press every button incl. Play, Record, Page, Track');
  phase = 'map-mixer';
  await waitForNext('switch to the MIXER layout on the device, then repeat: every control');

  phase = 'push';
  await cc(MODE_CC, 0x02, MODE_CHANNEL);
  await cc(13, 64, CH16);
  log('Control layout reselected; pushed encoder 1 (row 1) to 64. Turn knob 1 one click clockwise');
  await waitForNext('done turning knob 1 one click');

  phase = 'display';
  await send.sendSysExToOutput(dawOut, sysex(0x04, 0x36, 0x62));
  await send.sendSysExToOutput(dawOut, sysex(0x06, 0x36, 0x01, ...ascii('LUNA PAGE 1')));
  log('sent overlay text "LUNA PAGE 1". In 3 s: encoder 1 text "Line Gain"');
  await pause(3000);
  await send.sendSysExToOutput(dawOut, sysex(0x04, 0x0d, 0x62));
  await send.sendSysExToOutput(dawOut, sysex(0x06, 0x0d, 0x01, ...ascii('Line Gain')));
  await waitForNext('what did the display show?');
  await send.sendSysExToOutput(dawOut, sysex(0x04, 0x36, 0x7f));

  phase = 'led';
  const leds: Array<[number, number, string]> = [[116, 0x21, 'Play green'], [118, 0x05, 'Record red'], [37, 0x2d, 'strip 1 top button blue'], [106, 0x0d, 'Page Up yellow']];
  for (const [control, colour, what] of leds) {
    await cc(control, colour, CH1);
    log(`LED: ${what} (B0 ${control} ${colour})`);
    await pause(1000);
  }
  await waitForNext('which LEDs lit, and in what colours?');
} finally {
  await release();
  for (const stop of stops) stop();
  const path = await writeResult('lcxl3-daw-features', { seen });
  log(`Result: ${path}`);
  await luna.close();
}
