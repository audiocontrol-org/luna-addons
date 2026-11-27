// Parameter identity probe (open questions 3 and 4): LUNA's parameter list and plugin ids for
// every insert in the session, compared with audiocontrol's plugin descriptors.
//   npm run probe -w probes -- src/parameters.ts --descriptors <audiocontrol>/modules/canonical-midi-maps/plugin-descriptors
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { requireArg } from '@/lib/args';
import { compareParameters, type DescriptorParam } from '@/lib/compare';
import { connectLive, requireSession } from '@/lib/connect';
import { writeResult } from '@/lib/results';

interface Descriptor {
  file: string;
  pluginName: string;
  format: string;
  parameters: DescriptorParam[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function toDescriptor(file: string, json: unknown): Descriptor | null {
  const plugin = isRecord(json) ? json['plugin'] : undefined;
  const params = isRecord(json) ? json['parameters'] : undefined;
  if (!isRecord(plugin) || typeof plugin['name'] !== 'string' || !Array.isArray(params)) {
    return null;
  }
  const parameters: DescriptorParam[] = [];
  for (const p of params) {
    if (isRecord(p) && typeof p['index'] === 'number' && typeof p['name'] === 'string') parameters.push({ index: p['index'], name: p['name'] });
  }
  return { file, pluginName: plugin['name'], format: typeof plugin['format'] === 'string' ? plugin['format'] : '', parameters };
}

async function loadDescriptors(dir: string): Promise<{ descriptors: Descriptor[]; notDescriptors: string[] }> {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`No descriptor JSON files in ${dir}`);
  const loaded = await Promise.all(files.map(async (f) => ({ f, d: toDescriptor(f, JSON.parse(await readFile(join(dir, f), 'utf8'))) })));
  const descriptors: Descriptor[] = [];
  const notDescriptors: string[] = [];
  for (const { f, d } of loaded) {
    if (d) descriptors.push(d);
    else notDescriptors.push(f);
  }
  return { descriptors, notDescriptors };
}

const { descriptors, notDescriptors } = await loadDescriptors(requireArg(process.argv.slice(2), 'descriptors'));
const luna = await connectLive();
try {
  const session = await requireSession(luna);
  const inserts = [];
  for (const track of session.tracksInOrder) {
    await track.effects.load();
    for (const slot of track.effects.items) {
      const pluginId = slot.pluginId.value;
      if (!pluginId) continue;
      const base = { track: track.name.value, slot: slot.insertType.value, pluginId, pluginName: slot.pluginName.value };
      if (!slot.loaded.value || slot.pluginError.value) {
        inserts.push({ ...base, skipped: slot.pluginError.value ?? 'not loaded' });
        continue;
      }
      await slot.controls.load();
      const params = slot.params.map((c, position) => ({ position, id: c.id, name: c.name.value ?? '', display: c.display.value, automatable: c.automatable.value }));
      const matches = descriptors.filter((d) => d.pluginName === slot.pluginName.value);
      const comparisons = matches.map((d) => ({ descriptor: d.file, format: d.format, comparison: compareParameters(d.parameters, params) }));
      inserts.push({ ...base, paramCount: params.length, params, descriptor: comparisons.length > 0 ? comparisons : 'no descriptor' });
    }
  }
  const path = await writeResult('parameters', { notDescriptors, inserts });
  for (const i of inserts) {
    const summary = 'skipped' in i ? `skipped: ${i.skipped}` : `${i.paramCount} params, descriptor: ${typeof i.descriptor === 'string' ? i.descriptor : i.descriptor.map((c) => `${c.descriptor} match=${c.comparison.indexAndNameMatch.length} moved=${c.comparison.nameMatchIndexDiffers.length} ambiguous=${c.comparison.ambiguousNames.length} missing=${c.comparison.missingInLuna.length} extra=${c.comparison.extraInLuna.length}`).join('; ')}`;
    console.log(`${i.track} ${i.slot} ${i.pluginId} (${i.pluginName}): ${summary}`);
  }
  if (notDescriptors.length > 0) console.log(`Not descriptors (no plugin.name/parameters): ${notDescriptors.join(', ')}`);
  console.log(`Result: ${path}`);
} finally {
  await luna.close();
}
