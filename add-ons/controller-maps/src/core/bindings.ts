// Bindings for one targeted insert and page: read the slot's live parameters from LUNA,
// resolve the bundled map's page against them, and pair each resolved binding with its LUNA
// control for the parameter writer. Nothing here talks to the surface.
import type { Bundle } from '@/bundle/types';
import { resolve, type LunaParam, type Resolution } from '@/core/resolve';
import type { Target } from '@/core/targeting';
import type { BoundParameter } from '@/core/writer/writer';

export interface Bindings {
  resolution: Resolution;
  bound: BoundParameter[]; // empty unless the resolution is ok
}

type ReadyTarget = Extract<Target, { state: 'ready' }>;

export async function buildBindings(maps: Bundle['maps'], target: ReadyTarget, pageIndex: number): Promise<Bindings> {
  // A plugin with no map needs no parameters read: the resolver refuses it by id.
  if (maps[target.pluginId] === undefined) {
    return { resolution: resolve(maps, target.pluginId, pageIndex, []), bound: [] };
  }
  await target.slot.controls.load();
  const params = target.slot.params;
  const reported: LunaParam[] = params.map((p) => {
    const name = p.name.value;
    if (name === undefined) {
      throw new Error(`Parameter "${p.id}" of plugin ${target.pluginId} has no name from LUNA yet`);
    }
    return { id: p.id, name };
  });
  const resolution = resolve(maps, target.pluginId, pageIndex, reported);
  if (!resolution.ok) return { resolution, bound: [] };
  const byId = new Map(params.map((p) => [p.id, p]));
  const bound = resolution.bindings.map((binding): BoundParameter => {
    const param = byId.get(binding.paramId);
    if (param === undefined) throw new Error(`Parameter "${binding.paramId}" resolved but LUNA has no control for it`);
    return { binding, param };
  });
  return { resolution, bound };
}
