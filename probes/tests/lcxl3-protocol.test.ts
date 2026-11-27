import { describe, expect, it } from 'vitest';
import { DAW_MODE_OFF, DAW_MODE_ON, decodeModeReport } from '@/lcxl3-protocol';

describe('decodeModeReport', () => {
  it('decodes custom-mode reports', () => {
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x06 })).toEqual({ kind: 'custom', slot: 1 });
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x09 })).toEqual({ kind: 'custom', slot: 4 });
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x12 })).toEqual({ kind: 'custom', slot: 5 });
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x1d })).toEqual({ kind: 'custom', slot: 16 });
  });

  it('decodes DAW modes', () => {
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x01 })).toEqual({ kind: 'daw-mixer' });
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x02 })).toEqual({ kind: 'daw-control' });
  });

  it('ignores everything else', () => {
    expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x0a })).toBeNull();
    expect(decodeModeReport({ channel: 0, data1: 0x1e, data2: 0x06 })).toBeNull();
    expect(decodeModeReport({ channel: 6, data1: 0x1f, data2: 0x06 })).toBeNull();
  });
});

describe('DAW mode SysEx', () => {
  it('matches the captured enable and disable messages', () => {
    expect(DAW_MODE_ON).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x7f, 0xf7]);
    expect(DAW_MODE_OFF).toEqual([0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x00, 0xf7]);
  });
});
