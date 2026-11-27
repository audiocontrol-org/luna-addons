// LCXL3 DAW-mode protocol facts, from audiocontrol's capture of Novation's programmer's DAW
// mode guide: docs/1.0/001-IN-PROGRESS/midi-macro-bridge/research/lcxl3-novation-daw-mode.md

export const DAW_MODE_ON: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x7f, 0xf7];
export const DAW_MODE_OFF: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x00, 0xf7];

/** Mode reports and selections use CC 0x1E on channel 7 (index 6, status 0xB6). */
export const MODE_CHANNEL = 6;
export const MODE_CC = 0x1e;

export type Lcxl3Mode = { kind: 'daw-mixer' } | { kind: 'daw-control' } | { kind: 'custom'; slot: number };

/** The mode a `B6 1E vv` message reports, or null for any other message. */
export function decodeModeReport(message: { channel: number; data1: number; data2: number }): Lcxl3Mode | null {
  if (message.channel !== MODE_CHANNEL || message.data1 !== MODE_CC) return null;
  const v = message.data2;
  if (v === 0x01) return { kind: 'daw-mixer' };
  if (v === 0x02) return { kind: 'daw-control' };
  if (v >= 0x06 && v <= 0x09) return { kind: 'custom', slot: v - 0x05 };
  if (v >= 0x12 && v <= 0x1d) return { kind: 'custom', slot: v - 0x12 + 5 };
  return null;
}
