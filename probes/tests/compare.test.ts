import { describe, expect, it } from 'vitest';
import { compareParameters } from '@/lib/compare';

describe('compareParameters', () => {
  it('matches by index and name', () => {
    const r = compareParameters(
      [{ index: 0, name: 'Bypass' }, { index: 1, name: 'Gain' }],
      [{ position: 0, name: 'Bypass' }, { position: 1, name: 'Gain' }],
    );
    expect(r.indexAndNameMatch).toEqual([0, 1]);
  });

  it('reports a name found at another position', () => {
    const r = compareParameters([{ index: 5, name: 'Gain' }], [{ position: 2, name: 'Gain' }]);
    expect(r.nameMatchIndexDiffers).toEqual([{ name: 'Gain', descriptorIndex: 5, lunaPosition: 2 }]);
    expect(r.indexAndNameMatch).toEqual([]);
  });

  it('reports duplicate names instead of picking one', () => {
    const r = compareParameters([{ index: 3, name: 'Freq' }], [{ position: 3, name: 'Freq' }, { position: 9, name: 'Freq' }]);
    expect(r.ambiguousNames).toEqual(['Freq']);
    expect(r.indexAndNameMatch).toEqual([]);
  });

  it('reports an empty LUNA parameter list as all missing', () => {
    const r = compareParameters([{ index: 0, name: 'Gain' }], []);
    expect(r.missingInLuna).toEqual(['Gain']);
  });

  it('reports LUNA parameters the descriptor does not have', () => {
    const r = compareParameters([], [{ position: 0, name: ' Drive ' }]);
    expect(r.extraInLuna).toEqual(['Drive']);
  });
});
