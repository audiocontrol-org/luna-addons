import { describe, expect, it } from 'vitest';
import { compileBundle, type SourceFile } from '@/bundle/compile';

const SURFACE = `
contract: 2
surface: s1
kind: surface
device: { manufacturer: Acme, model: Pad }
ports: { input: Pad In, output: Pad Out }
controls:
  - { id: knob_1, kind: encoder, address: { channel: 1, cc: 10 } }
  - { id: knob_2, kind: encoder, address: { channel: 1, cc: 11 } }
  - { id: play, kind: button, address: { channel: 1, cc: 20 } }
  - { id: record, kind: button, address: { channel: 1, cc: 21 } }
protocol:
  claim: []
  release: []
`;

function layout(bindings: string, surface = 's1'): string {
  return `
contract: 2
version: 1.0.0
surface: ${surface}
kind: layout
bindings:
${bindings}
`;
}

const PLAY = '  - { role: transport.play, press: { control: play } }';

function map(pluginIds: string, surface = 's1', name = 'Map'): string {
  return `
contract: 2
version: 1.0.0
surface: ${surface}
metadata: { name: ${name} }
plugin: { manufacturer: Acme, name: Plug, luna_plugin_ids: [${pluginIds}] }
pages:
  - name: Main
    assignments:
      - { control: knob_1, parameter: { id: gain, name: Gain } }
`;
}

function file(path: string, text: string): SourceFile {
  return { path, text };
}

const BASE = [file('surface.yaml', SURFACE), file('layout.yaml', layout(PLAY))];

describe('compileBundle', () => {
  it('keys each map by every luna plugin id', () => {
    const bundle = compileBundle([...BASE, file('a.yaml', map('uaudio_x, uaudio_y'))], 'abc123', []);
    expect(bundle.contract).toBe(2);
    expect(bundle.audiocontrolRevision).toBe('abc123');
    expect(Object.keys(bundle.maps).sort()).toEqual(['uaudio_x', 'uaudio_y']);
    expect(bundle.maps['uaudio_x']).toEqual({
      source: 'a.yaml',
      name: 'Map',
      surface: 's1',
      pages: [{ name: 'Main', assignments: [{ control: 'knob_1', parameter: { id: 'gain', name: 'Gain' } }] }],
    });
  });

  it('throws naming both files when two maps claim one plugin id', () => {
    const files = [...BASE, file('a.yaml', map('uaudio_x')), file('b.yaml', map('uaudio_x'))];
    expect(() => compileBundle(files, 'r', [])).toThrow('uaudio_x is claimed by a.yaml and b.yaml');
  });

  it('throws for a contract it does not support', () => {
    const files = [...BASE, file('old.yaml', map('uaudio_x').replace('contract: 2', 'contract: 3'))];
    expect(() => compileBundle(files, 'r', [])).toThrow('old.yaml: contract 3 is not supported');
  });

  it('ignores files without a contract field', () => {
    const files = [...BASE, file('a.yaml', map('uaudio_x')), file('legacy.yaml', 'name: old\nmappings: []\n')];
    const bundle = compileBundle(files, 'r', []);
    expect(Object.keys(bundle.maps)).toEqual(['uaudio_x']);
  });

  it('throws when a coverage plugin id has no map', () => {
    const files = [...BASE, file('a.yaml', map('uaudio_x'))];
    expect(() => compileBundle(files, 'r', ['uaudio_x', 'uaudio_y'])).toThrow('coverage: no map for uaudio_y');
  });

  it('throws when a map names a surface no file defines', () => {
    const files = [...BASE, file('a.yaml', map('uaudio_x', 'ghost'))];
    expect(() => compileBundle(files, 'r', [])).toThrow('a.yaml: surface "ghost" is not defined by any file');
  });

  it('throws when a surface has no layout file, or more than one', () => {
    const none = [file('surface.yaml', SURFACE), file('a.yaml', map('uaudio_x'))];
    expect(() => compileBundle(none, 'r', [])).toThrow('surface s1 (surface.yaml): no layout file');
    const two = [...BASE, file('layout2.yaml', layout(PLAY)), file('a.yaml', map('uaudio_x'))];
    expect(() => compileBundle(two, 'r', [])).toThrow(
      'surface s1 (surface.yaml): more than one layout file (layout.yaml, layout2.yaml)',
    );
  });

  it('carries the profile and layout through unchanged', () => {
    const noPlay = layout('  - { role: transport.record, press: { control: record } }');
    const files = [file('surface.yaml', SURFACE), file('layout.yaml', noPlay), file('a.yaml', map('uaudio_x'))];
    const bundle = compileBundle(files, 'r', []);
    const definition = bundle.surfaces['s1'];
    expect(definition?.profile.controls.map((c) => c.id)).toEqual(['knob_1', 'knob_2', 'play', 'record']);
    expect(definition?.layout.bindings).toEqual([{ role: 'transport.record', press: { control: 'record' } }]);
  });

  it('throws on a layout role the Add On does not implement', () => {
    const bad = layout('  - { role: mixer.solo, press: { control: play } }');
    const files = [file('surface.yaml', SURFACE), file('layout.yaml', bad), file('a.yaml', map('uaudio_x'))];
    expect(() => compileBundle(files, 'r', [])).toThrow(
      'layout.yaml: role "mixer.solo" is not one of page.next, page.previous, transport.play, transport.record',
    );
  });

  it('lists every problem in one error', () => {
    const files = [...BASE, file('a.yaml', map('uaudio_x', 'ghost')), file('b.yaml', map('uaudio_y', 'ghost2'))];
    expect(() => compileBundle(files, 'r', ['uaudio_z'])).toThrow(/ghost".*\n.*ghost2".*\n.*uaudio_z/s);
  });
});
