import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'results');

/** Writes `probes/results/<probe>-<ISO timestamp>.json` and returns its path. */
export async function writeResult(probe: string, data: unknown): Promise<string> {
  await mkdir(RESULTS_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(RESULTS_DIR, `${probe}-${stamp}.json`);
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`);
  return path;
}
