// The controller boundary (CLAUDE.md): Add On code speaks semantic intent; only
// src/surface/runtime/ touches LUNA's MIDI API, and nothing in src/ holds a device fact.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { describeViolations, deviceFactsOf, scanBoundary } from './boundary/scan';

const SRC = fileURLToPath(new URL('../src', import.meta.url));
const FACTS = deviceFactsOf(JSON.parse(readFileSync(join(SRC, 'bundle/generated.json'), 'utf8')));

describe('the controller boundary', () => {
  it('src/ keeps the boundary', () => {
    const violations = scanBoundary(SRC, FACTS);
    expect(describeViolations(violations)).toBe('');
  });

  it('the runtime exists where the boundary expects it', () => {
    // A scan of a tree without the runtime would pass trivially.
    for (const file of ['surface/api.ts', 'surface/runtime/create.ts', 'surface/runtime/messages.ts', 'surface/runtime/claim.ts']) {
      expect(existsSync(join(SRC, file)), file).toBe(true);
    }
  });

  describe('self-check on planted files', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
    });

    function plant(files: Record<string, string>): string {
      const root = mkdtempSync(join(tmpdir(), 'boundary-'));
      dirs.push(root);
      for (const [path, content] of Object.entries(files)) {
        mkdirSync(join(root, path, '..'), { recursive: true });
        writeFileSync(join(root, path), content);
      }
      return root;
    }

    it('reports a MIDI API call and a hex literal in a core file, with file and line', () => {
      const root = plant({ 'core/planted.ts': ['export function f(send: { sendControllerToOutput(v: number): void }) {', '  send.sendControllerToOutput(0x21);', '}', ''].join('\n') });
      const report = describeViolations(scanBoundary(root, FACTS));
      expect(report).toContain("core/planted.ts:1: mentions LUNA's MIDI API outside the runtime");
      expect(report).toContain("core/planted.ts:2: mentions LUNA's MIDI API outside the runtime");
      expect(report).toContain('core/planted.ts:2: holds a hex literal');
    });

    it('reports a runtime import, a definition type import and a device name outside their homes', () => {
      const root = plant({
        'core/a.ts': "import { createSurface } from '@/surface/runtime/create';\n",
        'core/b.ts': "import type {\n  SurfaceProfile,\n} from '@audiocontrol/canonical-midi-maps';\n",
        'surface/runtime/c.ts': "export const port = 'Launch Control port';\n",
        'surface/runtime/d.ts': "import { x } from '@/surface/runtime/e';\nexport const send = 'sendSysExToOutput';\n",
        'main.ts': "import { createSurface } from '@/surface/runtime/create';\n",
      });
      const report = describeViolations(scanBoundary(root, FACTS));
      expect(report).toContain('core/a.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).toContain('core/b.ts:1: imports a surface definition type outside surface/ and bundle/');
      expect(report).toContain('surface/runtime/c.ts:1: names a device or vendor');
      expect(report).not.toContain('surface/runtime/d.ts');
      expect(report).not.toMatch(/^main\.ts:/m);
    });

    it('reports a control id from the bundle as a string literal, and a port name from the bundle', () => {
      const [port] = FACTS.names.filter((n) => FACTS.ports.includes(n));
      if (port === undefined) throw new Error('test: the bundle names no port');
      const root = plant({
        'core/e.ts': "export const isSide = (control: string): boolean => control === 'button_side';\n",
        'core/f.ts': `export const port = ${JSON.stringify(port)};\n`,
        'core/g.ts': "// button_side, unquoted in a comment, is no literal\nexport const x = 1;\n",
      });
      const report = describeViolations(scanBoundary(root, FACTS));
      expect(report).toContain("core/e.ts:1: names a surface control id: 'button_side'");
      expect(report).toContain('core/f.ts:1: names a device or vendor');
      expect(report).not.toContain('core/g.ts');
    });

    it('reports relative runtime imports and runtime or definition-type re-exports', () => {
      const root = plant({
        'core/h.ts': "import { createSurface } from '../surface/runtime/create';\n",
        'surface/i.ts': "import { createLink } from './runtime/claim';\n",
        'core/j.ts': "export type { SurfaceProfile } from '@audiocontrol/canonical-midi-maps';\n",
        'core/k.ts': "export { createSurface } from '@/surface/runtime/create';\n",
        'core/l.ts': "export * from '../surface/runtime/messages';\n",
        'surface/runtime/m.ts': "import { fillAll } from './messages';\n",
        'main.ts': "import { createSurface } from './surface/runtime/create';\n",
      });
      const report = describeViolations(scanBoundary(root, FACTS));
      expect(report).toContain('core/h.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).toContain('surface/i.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).toContain('core/j.ts:1: imports a surface definition type outside surface/ and bundle/');
      expect(report).toContain('core/k.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).toContain('core/l.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).not.toContain('surface/runtime/m.ts');
      expect(report).not.toMatch(/^main\.ts:/m);
    });
  });

  describe('the deny-list', () => {
    it('is built from every surface in the bundle, plus a fixed vendor baseline', () => {
      const bundle: unknown = JSON.parse(readFileSync(join(SRC, 'bundle/generated.json'), 'utf8'));
      const facts = deviceFactsOf(bundle);
      expect(facts.names).toEqual(expect.arrayContaining(['Novation', 'Launch Control']));
      const planted = deviceFactsOf({
        surfaces: {
          'pad-z': {
            profile: {
              surface: 'pad-z',
              device: { manufacturer: 'Acme', model: 'Zed One' },
              ports: { input: 'Zed In', output: 'Zed Out' },
              controls: [{ id: 'knob_q' }, { id: 'pad_w' }],
            },
          },
        },
      });
      expect(planted.names).toEqual(expect.arrayContaining(['pad-z', 'Acme', 'Zed One', 'Zed In', 'Zed Out', 'Novation', 'Launch Control']));
      expect(planted.ports).toEqual(['Zed In', 'Zed Out']);
      expect(planted.controlIds).toEqual(['knob_q', 'pad_w']);
    });

    it('refuses a bundle it cannot read facts from', () => {
      expect(() => deviceFactsOf({})).toThrow(/surfaces/);
      expect(() => deviceFactsOf({ surfaces: { x: { profile: { surface: 'x' } } } })).toThrow(/x/);
    });
  });
});
