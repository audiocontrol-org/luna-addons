// Resends the LCXL3 display test while lcxl3-daw-features.ts holds DAW mode.
//   npm run probe -w probes -- src/display-retry.ts --daw-out "LCXL3 1 DAW In"
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { connectLive } from '@/lib/connect';
import { findDevice } from '@/lib/devices';

const NOVATION = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15];
const sysex = (...body: number[]): number[] => [...NOVATION, ...body, 0xf7];
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0) & 0x7f);
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const start = Date.now();
const log = (line: string): void => console.log(`[${((Date.now() - start) / 1000).toFixed(1)}s] ${line}`);

const luna = await connectLive();
try {
  await luna.midiDevices.load();
  const out = findDevice(luna.midiDevices.items, requireArg(process.argv.slice(2), 'daw-out'));
  const send = new Luna.SendMidi(luna);
  await send.sendSysExToOutput(out, sysex(0x04, 0x36, 0x62));
  await send.sendSysExToOutput(out, sysex(0x06, 0x36, 0x01, ...ascii('LUNA PAGE 1')));
  log('overlay: "LUNA PAGE 1"');
  await pause(4000);
  await send.sendSysExToOutput(out, sysex(0x04, 0x0d, 0x62));
  await send.sendSysExToOutput(out, sysex(0x06, 0x0d, 0x01, ...ascii('Line Gain')));
  log('encoder 1: "Line Gain"');
  await pause(4000);
  await send.sendSysExToOutput(out, sysex(0x04, 0x35, 0x62));
  await send.sendSysExToOutput(out, sysex(0x06, 0x35, 0x01, ...ascii('Controller Maps')));
  log('permanent: "Controller Maps"');
} finally {
  await luna.close();
}
