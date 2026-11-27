import type { Luna } from '@uaudio/luna-builder-sdk';

/**
 * The physical MIDI device whose name is exactly `name`. Never matches part of a name and
 * never picks a device on its own: when there is no exact match it throws, listing the names
 * LUNA reports, so the operator can pass the right one.
 */
export function findDevice(devices: readonly Luna.MidiDevice[], name: string): Luna.MidiDevice {
  const physical = devices.filter((d) => d.isPhysical);
  const match = physical.find((d) => d.name.value === name);
  if (match) return match;
  const seen = physical.map((d) => d.name.value ?? d.id).join(', ');
  throw new Error(`No MIDI device named "${name}"; LUNA sees: ${seen}`);
}
