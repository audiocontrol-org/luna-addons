import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';
import { findDevice } from '@/lib/devices';

async function mockDevices(names: string[]): Promise<readonly Luna.MidiDevice[]> {
  const engine = new Luna.MockEngine();
  for (const name of names) engine.addMidiDevice(name);
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.midiDevices.load();
  return luna.midiDevices.items;
}

describe('findDevice', () => {
  it('names the missing device and lists what LUNA sees', async () => {
    const devices = await mockDevices(['Launch Control XL 3 DAW Out', 'IAC Bus 1']);
    expect(() => findDevice(devices, 'LCXL3 1 MIDI')).toThrow(
      'No MIDI device named "LCXL3 1 MIDI"; LUNA sees: Launch Control XL 3 DAW Out, IAC Bus 1',
    );
  });

  it('never matches a partial name', async () => {
    const devices = await mockDevices(['Launch Control XL 3 MIDI']);
    expect(() => findDevice(devices, 'Launch Control')).toThrow();
  });

  it('returns the device whose name matches exactly', async () => {
    const devices = await mockDevices(['IAC Bus 1', 'Launch Control XL 3 MIDI']);
    expect(findDevice(devices, 'Launch Control XL 3 MIDI').name.value).toBe('Launch Control XL 3 MIDI');
  });
});
