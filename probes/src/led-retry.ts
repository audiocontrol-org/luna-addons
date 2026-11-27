// LED retry for the Task 6 probe: one CC, each value held 3 s, first to the MIDI port, then
// to the DAW port.
//   npm run probe -w probes -- src/led-retry.ts --cc 52 --channel 0 --midi-out "LCXL3 1 MIDI In" --daw-out "LCXL3 1 DAW In"
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { connectLive } from '@/lib/connect';
import { findDevice } from '@/lib/devices';

const argv = process.argv.slice(2);
const cc = Number(requireArg(argv, 'cc'));
const channel = Number(requireArg(argv, 'channel'));
const luna = await connectLive();
await luna.midiDevices.load();
const ports: Array<[string, Luna.MidiDevice]> = [['MIDI', findDevice(luna.midiDevices.items, requireArg(argv, 'midi-out'))]];
const send = new Luna.SendMidi(luna);
const start = Date.now();
for (const [label, device] of ports) {
  for (const value of [5, 0, 21, 0, 45, 0]) {
    console.log(`[${((Date.now() - start) / 1000).toFixed(0)}s] ${label} port: CC ${cc} ch${channel + 1} = ${value}`);
    await send.sendControllerToOutput(device, cc, value, channel);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}
await luna.close();
