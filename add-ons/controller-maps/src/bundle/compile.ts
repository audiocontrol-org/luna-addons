// Build time only: main.ts never imports this module. It runs contract-2 parsers over the
// map files audiocontrol ships and produces the bundle the Add On reads at run time.
import {
  SUPPORTED_CONTRACT,
  contractOf,
  parseControllerMap,
  parseSurfaceLayout,
  parseSurfaceProfile,
  type ParseResult,
  type SurfaceLayout,
  type SurfaceProfile,
} from '@audiocontrol/canonical-midi-maps';
import { parse as parseYaml } from 'yaml';
import type { Bundle, BundledMap, SurfaceDefinition } from '@/bundle/types';
import { ROLES } from '@/surface/roles';

export interface SourceFile {
  path: string;
  text: string;
}

type Kind = 'surface' | 'layout' | 'map';

interface Classified {
  file: SourceFile;
  kind: Kind;
  surface: string | undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeFile(file: SourceFile, errors: string[]): Classified | undefined {
  let raw: unknown;
  let contract: number | undefined;
  try {
    raw = parseYaml(file.text);
    contract = contractOf(file.text);
  } catch (error) {
    errors.push(`${file.path}: yaml: ${error instanceof Error ? error.message : String(error)}`);
    return undefined;
  }
  if (contract === undefined) return undefined;
  if (contract !== SUPPORTED_CONTRACT) {
    errors.push(`${file.path}: contract ${contract} is not supported (supported: ${SUPPORTED_CONTRACT})`);
    return undefined;
  }
  const record = isRecord(raw) ? raw : {};
  const kind = record['kind'];
  const surface = record['surface'];
  return {
    file,
    kind: kind === 'surface' || kind === 'layout' ? kind : 'map',
    surface: typeof surface === 'string' ? surface : undefined,
  };
}

function collect<T>(path: string, result: ParseResult<T>, errors: string[]): T | undefined {
  if (result.ok) return result.value;
  for (const message of result.errors) errors.push(`${path}: ${message}`);
  return undefined;
}

function checkRoles(path: string, layout: SurfaceLayout, errors: string[]): void {
  const known: readonly string[] = ROLES;
  for (const { role } of layout.bindings) {
    if (!known.includes(role)) errors.push(`${path}: role "${role}" is not one of ${ROLES.join(', ')}`);
  }
}

function compileSurfaces(items: Classified[], errors: string[]): Map<string, { path: string; profile: SurfaceProfile }> {
  const surfaces = new Map<string, { path: string; profile: SurfaceProfile }>();
  for (const { file } of items.filter((i) => i.kind === 'surface')) {
    const profile = collect(file.path, parseSurfaceProfile(file.text), errors);
    if (profile === undefined) continue;
    const first = surfaces.get(profile.surface);
    if (first !== undefined) {
      errors.push(`surface ${profile.surface} is defined by ${first.path} and ${file.path}`);
      continue;
    }
    surfaces.set(profile.surface, { path: file.path, profile });
  }
  return surfaces;
}

function compileLayouts(
  items: Classified[],
  surfaces: Map<string, { path: string; profile: SurfaceProfile }>,
  errors: string[],
): Record<string, SurfaceDefinition> {
  const found = new Map<string, Array<{ path: string; layout: SurfaceLayout | undefined }>>();
  for (const { file, surface } of items.filter((i) => i.kind === 'layout')) {
    const owner = surface === undefined ? undefined : surfaces.get(surface);
    if (owner === undefined) {
      errors.push(`${file.path}: surface "${surface ?? ''}" is not defined by any file`);
      continue;
    }
    const layout = collect(file.path, parseSurfaceLayout(file.text, owner.profile), errors);
    if (layout !== undefined) checkRoles(file.path, layout, errors);
    found.set(owner.profile.surface, [...(found.get(owner.profile.surface) ?? []), { path: file.path, layout }]);
  }
  const definitions: Record<string, SurfaceDefinition> = {};
  for (const [id, { path, profile }] of surfaces) {
    const layouts = found.get(id) ?? [];
    if (layouts.length === 0) {
      errors.push(`surface ${id} (${path}): no layout file`);
    } else if (layouts.length > 1) {
      errors.push(`surface ${id} (${path}): more than one layout file (${layouts.map((l) => l.path).join(', ')})`);
    } else {
      const layout = layouts[0]?.layout;
      if (layout !== undefined) definitions[id] = { profile, layout };
    }
  }
  return definitions;
}

function compileMaps(
  items: Classified[],
  surfaces: Map<string, { path: string; profile: SurfaceProfile }>,
  definitions: Record<string, SurfaceDefinition>,
  errors: string[],
): Record<string, BundledMap> {
  const maps: Record<string, BundledMap> = {};
  const owners = new Map<string, string>();
  for (const { file, surface } of items.filter((i) => i.kind === 'map')) {
    if (surface === undefined || !surfaces.has(surface)) {
      errors.push(`${file.path}: surface "${surface ?? ''}" is not defined by any file`);
      continue;
    }
    const definition = definitions[surface];
    if (definition === undefined) continue; // the surface's own problem is already listed
    const map = collect(file.path, parseControllerMap(file.text, definition.profile, definition.layout), errors);
    if (map === undefined) continue;
    const bundled: BundledMap = { source: file.path, name: map.metadata.name, surface, pages: map.pages };
    for (const id of map.plugin.luna_plugin_ids) {
      const owner = owners.get(id);
      if (owner !== undefined) {
        errors.push(`${id} is claimed by ${owner} and ${file.path}`);
        continue;
      }
      owners.set(id, file.path);
      maps[id] = bundled;
    }
  }
  return maps;
}

/** Throws one error listing every problem found. */
export function compileBundle(files: SourceFile[], revision: string, coverage: string[]): Bundle {
  const errors: string[] = [];
  const items: Classified[] = [];
  for (const file of files) {
    const item = describeFile(file, errors);
    if (item !== undefined) items.push(item);
  }
  const surfaces = compileSurfaces(items, errors);
  const definitions = compileLayouts(items, surfaces, errors);
  const maps = compileMaps(items, surfaces, definitions, errors);
  for (const id of coverage) {
    if (maps[id] === undefined) errors.push(`coverage: no map for ${id}`);
  }
  if (errors.length > 0) throw new Error(`bundle: ${errors.length} problem(s)\n${errors.join('\n')}`);
  return { contract: SUPPORTED_CONTRACT, audiocontrolRevision: revision, surfaces: definitions, maps };
}
