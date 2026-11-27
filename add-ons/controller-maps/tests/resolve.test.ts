import { describe, expect, it } from 'vitest';
import { resolve, type LunaParam } from '@/core/resolve';
import type { BundledMap } from '@/bundle/types';

const MAP: BundledMap = {
  source: 'maps/z.yaml',
  name: 'Z Map',
  surface: 's1',
  pages: [
    {
      name: 'Page A',
      assignments: [
        { control: 'knob_1', parameter: { id: 'line_gain', name: 'Line Gain' } },
        { control: 'play', parameter: { id: 'bypass', name: 'Bypass' }, mode: 'toggle' },
      ],
    },
    {
      name: 'Page B',
      assignments: [{ control: 'knob_1', parameter: { id: '550_hf_gain', name: 'HF Gain' } }],
    },
  ],
};
const MAPS = { uaudio_z: MAP };
const PARAMS: LunaParam[] = [
  { id: 'line_gain', name: 'Line Gain' },
  { id: 'bypass', name: 'Bypass' },
  { id: '550_hf_gain', name: 'HF Gain' },
];

describe('resolve', () => {
  it('reports no map', () => {
    const r = resolve(MAPS, 'uaudio_other', 0, PARAMS);
    expect(r).toEqual({
      ok: false,
      reason: 'No map for plugin uaudio_other',
      mismatches: [],
    });
    const z = resolve({}, 'uaudio_z', 0, PARAMS);
    expect(z.ok === false && z.reason).toBe('No map for plugin uaudio_z');
  });

  it('resolves a matching page', () => {
    const r = resolve(MAPS, 'uaudio_z', 0, PARAMS);
    expect(r).toEqual({
      ok: true,
      map: MAP,
      pageIndex: 0,
      pageName: 'Page A',
      bindings: [
        { control: 'knob_1', paramId: 'line_gain', label: 'Line Gain' },
        { control: 'play', paramId: 'bypass', label: 'Bypass', mode: 'toggle' },
      ],
    });
  });

  it('a missing id refuses the page', () => {
    const r = resolve(MAPS, 'uaudio_z', 1, PARAMS.filter((p) => p.id !== '550_hf_gain'));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('Page "Page B" does not match LUNA');
    expect(r.mismatches).toContain('550_hf_gain: not reported by LUNA');
  });

  it('a name mismatch refuses the page', () => {
    const params = PARAMS.map((p) => (p.id === 'line_gain' ? { id: p.id, name: 'Line Level' } : p));
    const r = resolve(MAPS, 'uaudio_z', 0, params);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mismatches).toContain('line_gain: map says "Line Gain", LUNA says "Line Level"');
  });

  it('lists every mismatch', () => {
    const r = resolve(MAPS, 'uaudio_z', 0, [{ id: 'line_gain', name: 'X' }]);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.mismatches).toHaveLength(2);
  });

  it('page index wraps', () => {
    const r = resolve(MAPS, 'uaudio_z', 2, PARAMS);
    expect(r.ok && r.pageIndex).toBe(0);
    const n = resolve(MAPS, 'uaudio_z', -1, PARAMS);
    expect(n.ok && n.pageIndex).toBe(1);
    expect(n.ok && n.pageName).toBe('Page B');
  });
});
