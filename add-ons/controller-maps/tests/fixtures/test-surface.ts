// A fictional control surface. It shares nothing with any real device: other port names (one
// MIDI device for both directions), other channels and CCs, its own claim bytes, mode address
// and values, a different shape for each template, and a layout of its own. The runtime must
// drive it with no code change.
import type { SurfaceLayout, SurfaceProfile } from '@audiocontrol/canonical-midi-maps';
import type { SurfaceDefinition } from '@/bundle/types';

const profile: SurfaceProfile = {
  contract: 2,
  surface: 'test-pad',
  kind: 'surface',
  device: { manufacturer: 'Nobody', model: 'Test Pad' },
  ports: { input: 'Test Pad Port', output: 'Test Pad Port' },
  controls: [
    { id: 'knob_a', kind: 'encoder', address: { channel: 3, cc: 40 }, follows: true },
    { id: 'knob_b', kind: 'encoder', address: { channel: 3, cc: 41 } },
    { id: 'slider', kind: 'fader', address: { channel: 4, cc: 7 } },
    { id: 'pad_free', kind: 'button', address: { channel: 2, cc: 60 } },
    { id: 'pad_next', kind: 'button', address: { channel: 2, cc: 61 } },
    { id: 'pad_play', kind: 'button', address: { channel: 2, cc: 62 } },
    { id: 'pad_alt', kind: 'button', address: { channel: 2, cc: 63 } },
    { id: 'fn', kind: 'button', address: { channel: 5, cc: 1 } },
  ],
  protocol: {
    claim: [
      { cc: { channel: 9, number: 100, value: 1 } },
      { sysex: 'F0 7D 11 22 F7' },
    ],
    release: [
      { sysex: 'F0 7D 11 00 F7' },
      { cc: { channel: 9, number: 100, value: 0 } },
    ],
    mode: {
      address: { channel: 9, cc: 101 },
      ready: [5],
      suspended: [{ values: [9, 10], reason: 'The pad is in its sampler mode; leave it to resume' }],
    },
    follow: { sysex: 'F0 7D 20 {channel} {cc} {value} F7' },
    label: [{ sysex: 'F0 7D 30 {cc} {text} F7' }],
    announce: [{ sysex: 'F0 7D 31 {text} 00 F7' }],
    indicate: { message: { cc: { channel: '{channel}', number: '{cc}', value: '{state}' } }, off: 3 },
  },
};

const layout: SurfaceLayout = {
  contract: 2,
  version: '0.0.1',
  surface: 'test-pad',
  kind: 'layout',
  bindings: [
    { role: 'page.next', press: { control: 'pad_next' } },
    { role: 'page.previous', press: { control: 'pad_next', with: 'fn' } },
    { role: 'transport.play', press: { control: 'pad_play' } },
    { role: 'transport.play', press: { control: 'pad_alt', with: 'fn' } },
  ],
  feedback: [{ role: 'transport.play', active: 90, inactive: 91 }],
};

export const TEST_SURFACE: SurfaceDefinition = { profile, layout };
