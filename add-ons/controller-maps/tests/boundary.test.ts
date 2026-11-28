// The controller boundary (CLAUDE.md): Add On code speaks semantic intent; only
// src/surface/runtime/ touches LUNA's MIDI API, and nothing in src/ holds a device fact.
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { describeViolations, scanBoundary } from './boundary/scan';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

describe('the controller boundary', () => {
  it('src/ keeps the boundary', () => {
    const violations = scanBoundary(SRC);
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
      const report = describeViolations(scanBoundary(root));
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
      const report = describeViolations(scanBoundary(root));
      expect(report).toContain('core/a.ts:1: imports @/surface/runtime outside the runtime and main.ts');
      expect(report).toContain('core/b.ts:1: imports a surface definition type outside surface/ and bundle/');
      expect(report).toContain('surface/runtime/c.ts:1: names a device or vendor');
      expect(report).not.toContain('surface/runtime/d.ts');
      expect(report).not.toMatch(/^main\.ts:/m);
    });
  });
});
