// The controller boundary, as a scan of a source tree. Paths in rules are relative to `root`
// (the Add On's src/). Each violation names the file, the line and the rule it breaks.
//
// What it catches: LUNA's MIDI API outside the runtime; imports and re-exports of the runtime
// (by `@/` or relative path) outside the runtime and main.ts; imports and re-exports of the
// surface definition types outside surface/ and bundle/; hex literals; and the device facts the
// bundle holds (surface ids, manufacturers, models and port names anywhere, control ids as
// quoted string literals), plus a fixed vendor baseline.
//
// What it cannot catch: a decimal CC or channel number. Any small integer could be one, so a
// static check would flag ordinary code; review has to catch those.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import type { DeviceFacts } from './facts';

export { deviceFactsOf, type DeviceFacts } from './facts';

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

// The bundle is audiocontrol's data compiled at build time (gitignored). Controller facts are
// meant to live there, so it is the one file the scan leaves out.
const DATA_FILES = new Set(['bundle/generated.json']);

const RUNTIME_DIR = 'surface/runtime';
const MIDI_API = /\b(MidiInput|SendMidi|sendControllerToOutput|sendSysExToOutput|midiDevices|onControlChange)\b/;
const DEFINITION_TYPES = /\b(SurfaceDefinition|SurfaceProfile|SurfaceLayout)\b/;
// `import … from '…'`, `export … from '…'` (also `export * from`), over several lines.
const FROM_STATEMENT = /\b(?:import|export)\b[^;]*?\bfrom\s*['"]([^'"]+)['"]/gs;
// `import '…'` and `import('…')`.
const BARE_IMPORT = /\bimport\s*\(?\s*['"]([^'"]+)['"]/g;
const HEX_LITERAL = /0x[0-9a-f]/i;

const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function files(root: string, dir: string = root): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(root, path));
    else out.push(relative(root, path).split(sep).join('/'));
  }
  return out.sort();
}

function lineAt(content: string, index: number): number {
  return content.slice(0, index).split('\n').length;
}

// The path under root a specifier names, or undefined for a package.
function resolveSpecifier(file: string, specifier: string): string | undefined {
  if (specifier.startsWith('@/')) return posix.normalize(specifier.slice(2));
  if (specifier.startsWith('.')) return posix.normalize(posix.join(posix.dirname(file), specifier));
  return undefined;
}

const isRuntime = (path: string | undefined): boolean => path !== undefined && (path === RUNTIME_DIR || path.startsWith(`${RUNTIME_DIR}/`));

interface Matchers {
  name: RegExp | undefined;
  controlId: RegExp | undefined;
}

function matchersOf(facts: DeviceFacts): Matchers {
  const alternation = (items: readonly string[]): string => [...items].sort((a, b) => b.length - a.length).map(escape).join('|');
  return {
    name: facts.names.length > 0 ? new RegExp(alternation(facts.names), 'i') : undefined,
    controlId: facts.controlIds.length > 0 ? new RegExp(`(['"\`])(${alternation(facts.controlIds)})\\1`) : undefined,
  };
}

function scanFile(file: string, content: string, matchers: Matchers): Violation[] {
  const found: Violation[] = [];
  const inRuntime = isRuntime(file);
  const mayImportRuntime = inRuntime || file === 'main.ts';
  const mayImportDefinitions = file.startsWith('surface/') || file.startsWith('bundle/');
  content.split('\n').forEach((text, i) => {
    const line = i + 1;
    if (!inRuntime && MIDI_API.test(text)) found.push({ file, line, rule: "mentions LUNA's MIDI API outside the runtime", text });
    if (HEX_LITERAL.test(text)) found.push({ file, line, rule: 'holds a hex literal', text });
    if (matchers.name?.test(text)) found.push({ file, line, rule: 'names a device or vendor', text });
    const id = matchers.controlId?.exec(text);
    if (id) found.push({ file, line, rule: `names a surface control id: ${id[0]}`, text });
  });
  const statements = [...content.matchAll(FROM_STATEMENT), ...content.matchAll(BARE_IMPORT)];
  for (const match of statements) {
    const [statement, specifier = ''] = match;
    const line = lineAt(content, match.index);
    if (!mayImportRuntime && isRuntime(resolveSpecifier(file, specifier))) {
      found.push({ file, line, rule: 'imports @/surface/runtime outside the runtime and main.ts', text: statement });
    }
    if (!mayImportDefinitions && DEFINITION_TYPES.test(statement)) {
      found.push({ file, line, rule: 'imports a surface definition type outside surface/ and bundle/', text: statement });
    }
  }
  return found;
}

export function scanBoundary(root: string, facts: DeviceFacts): Violation[] {
  const matchers = matchersOf(facts);
  return files(root)
    .filter((file) => !DATA_FILES.has(file))
    .flatMap((file) => scanFile(file, readFileSync(join(root, file), 'utf8'), matchers));
}

export function describeViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line}: ${v.rule}: ${v.text.trim()}`).join('\n');
}
