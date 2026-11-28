// The controller boundary, as a scan of a source tree. Paths in rules are relative to `root`
// (the Add On's src/). Each violation names the file, the line and the rule it breaks.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface Violation {
  file: string;
  line: number;
  rule: string;
  text: string;
}

// The bundle is audiocontrol's data compiled at build time (gitignored). Controller facts are
// meant to live there, so it is the one file the scan leaves out.
const DATA_FILES = new Set(['bundle/generated.json']);

const RUNTIME_DIR = 'surface/runtime/';
const RUNTIME_IMPORT = /['"]@\/surface\/runtime(\/[^'"]*)?['"]/;
const MIDI_API = /\b(MidiInput|SendMidi|sendControllerToOutput|sendSysExToOutput|midiDevices|onControlChange)\b/;
const DEFINITION_TYPES = /\b(SurfaceDefinition|SurfaceProfile|SurfaceLayout)\b/;
const IMPORT_STATEMENT = /\bimport\b[^;]*?\bfrom\s*['"][^'"]+['"]/gs;
const HEX_LITERAL = /0x[0-9a-f]/i;
const DEVICE_NAMES = /LCXL|Novation|Launch Control/i;

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

function scanFile(file: string, content: string): Violation[] {
  const found: Violation[] = [];
  const inRuntime = file.startsWith(RUNTIME_DIR);
  const mayImportRuntime = inRuntime || file === 'main.ts';
  const mayImportDefinitions = file.startsWith('surface/') || file.startsWith('bundle/');
  content.split('\n').forEach((text, i) => {
    const line = i + 1;
    if (!mayImportRuntime && RUNTIME_IMPORT.test(text)) found.push({ file, line, rule: 'imports @/surface/runtime outside the runtime and main.ts', text });
    if (!inRuntime && MIDI_API.test(text)) found.push({ file, line, rule: "mentions LUNA's MIDI API outside the runtime", text });
    if (HEX_LITERAL.test(text)) found.push({ file, line, rule: 'holds a hex literal', text });
    if (DEVICE_NAMES.test(text)) found.push({ file, line, rule: 'names a device or vendor', text });
  });
  if (!mayImportDefinitions) {
    for (const match of content.matchAll(IMPORT_STATEMENT)) {
      if (DEFINITION_TYPES.test(match[0])) {
        found.push({ file, line: lineAt(content, match.index), rule: 'imports a surface definition type outside surface/ and bundle/', text: match[0] });
      }
    }
  }
  return found;
}

export function scanBoundary(root: string): Violation[] {
  return files(root)
    .filter((file) => !DATA_FILES.has(file))
    .flatMap((file) => scanFile(file, readFileSync(join(root, file), 'utf8')));
}

export function describeViolations(violations: readonly Violation[]): string {
  return violations.map((v) => `${v.file}:${v.line}: ${v.rule}: ${v.text.trim()}`).join('\n');
}
