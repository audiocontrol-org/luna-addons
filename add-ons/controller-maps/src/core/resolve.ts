import type { Bundle, BundledMap } from '@/bundle/types';

export interface LunaParam {
  id: string;
  name: string;
}

export interface ResolvedBinding {
  control: string;
  paramId: string;
  label: string;
  mode?: 'toggle' | 'momentary';
}

export type Resolution =
  | { ok: true; map: BundledMap; pageIndex: number; pageName: string; bindings: ResolvedBinding[] }
  | { ok: false; reason: string; mismatches: string[] };

export function resolve(
  maps: Bundle['maps'],
  pluginId: string,
  pageIndex: number,
  params: readonly LunaParam[],
): Resolution {
  const map = maps[pluginId];
  if (map === undefined) {
    return { ok: false, reason: `No map for plugin ${pluginId}`, mismatches: [] };
  }
  const count = map.pages.length;
  if (count === 0) {
    return { ok: false, reason: `Map "${map.name}" has no pages`, mismatches: [] };
  }
  const index = ((pageIndex % count) + count) % count;
  const page = map.pages[index];
  if (page === undefined) {
    throw new Error(`Map "${map.name}" has no page at index ${index}`);
  }
  const byId = new Map(params.map((p) => [p.id, p.name]));
  const mismatches: string[] = [];
  const bindings: ResolvedBinding[] = [];
  for (const a of page.assignments) {
    const lunaName = byId.get(a.parameter.id);
    if (lunaName === undefined) {
      mismatches.push(`${a.parameter.id}: not reported by LUNA`);
      continue;
    }
    if (lunaName !== a.parameter.name) {
      mismatches.push(`${a.parameter.id}: map says "${a.parameter.name}", LUNA says "${lunaName}"`);
      continue;
    }
    const binding: ResolvedBinding = { control: a.control, paramId: a.parameter.id, label: a.parameter.name };
    if (a.mode !== undefined) binding.mode = a.mode;
    bindings.push(binding);
  }
  if (mismatches.length > 0) {
    return { ok: false, reason: `Page "${page.name}" does not match LUNA`, mismatches };
  }
  return { ok: true, map, pageIndex: index, pageName: page.name, bindings };
}
