// Build time: compiles audiocontrol's contract-2 map files into src/bundle/generated.json.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileBundle, type SourceFile } from '@/bundle/compile';

const addOnDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const submodule = resolve(addOnDir, '../../vendor/audiocontrol');
const mapsDir = join(submodule, 'modules/canonical-midi-maps/maps');

function yamlFiles(dir: string): string[] {
  return readdirSync(dir)
    .sort()
    .flatMap((name) => {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) return yamlFiles(full);
      return name.endsWith('.yaml') ? [full] : [];
    });
}

function readCoverage(path: string): string[] {
  if (!existsSync(path)) throw new Error(`coverage file is missing: ${path}`);
  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!Array.isArray(raw) || !raw.every((id): id is string => typeof id === 'string')) {
    throw new Error(`${path} must be a JSON array of LUNA plugin id strings`);
  }
  return raw;
}

function main(): void {
  if (!existsSync(mapsDir)) {
    throw new Error(`audiocontrol maps directory is missing: ${mapsDir} (is the vendor/audiocontrol submodule initialised?)`);
  }
  const files: SourceFile[] = yamlFiles(mapsDir).map((full) => ({
    path: relative(mapsDir, full),
    text: readFileSync(full, 'utf8'),
  }));
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: submodule, encoding: 'utf8' }).trim();
  const bundle = compileBundle(files, revision, readCoverage(join(addOnDir, 'coverage.json')));
  const out = join(addOnDir, 'src/bundle/generated.json');
  writeFileSync(out, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(`bundle: ${Object.keys(bundle.maps).length} map ids, ${Object.keys(bundle.surfaces).length} surface(s), revision ${revision} -> ${relative(process.cwd(), out)}`);
}

main();
