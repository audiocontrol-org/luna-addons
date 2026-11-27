/** A parameter as LUNA lists it: `position` is its index in `slot.params`. */
export interface LunaParam {
  position: number;
  name: string;
}

/** A parameter from an audiocontrol plugin descriptor (`PluginDescriptor.parameters`). */
export interface DescriptorParam {
  index: number;
  name: string;
}

export interface ParameterComparison {
  /** Descriptor indexes whose name LUNA lists once, at the same position. */
  indexAndNameMatch: number[];
  /** Names LUNA lists once, but at a different position than the descriptor's index. */
  nameMatchIndexDiffers: Array<{ name: string; descriptorIndex: number; lunaPosition: number }>;
  /** Descriptor names LUNA lists more than once: matching by name cannot pick one. */
  ambiguousNames: string[];
  /** Descriptor names LUNA does not list. */
  missingInLuna: string[];
  /** LUNA names the descriptor does not list. */
  extraInLuna: string[];
}

/** Compares a descriptor's parameters with LUNA's list by trimmed name (case kept) and index. */
export function compareParameters(descriptor: readonly DescriptorParam[], luna: readonly LunaParam[]): ParameterComparison {
  const result: ParameterComparison = { indexAndNameMatch: [], nameMatchIndexDiffers: [], ambiguousNames: [], missingInLuna: [], extraInLuna: [] };
  const byName = new Map<string, LunaParam[]>();
  for (const p of luna) {
    const name = p.name.trim();
    byName.set(name, [...(byName.get(name) ?? []), p]);
  }
  const descriptorNames = new Set<string>();
  for (const d of descriptor) {
    const name = d.name.trim();
    descriptorNames.add(name);
    const matches = byName.get(name) ?? [];
    const [only] = matches;
    if (matches.length > 1) {
      if (!result.ambiguousNames.includes(name)) result.ambiguousNames.push(name);
    } else if (only === undefined) {
      result.missingInLuna.push(name);
    } else if (only.position === d.index) {
      result.indexAndNameMatch.push(d.index);
    } else {
      result.nameMatchIndexDiffers.push({ name, descriptorIndex: d.index, lunaPosition: only.position });
    }
  }
  for (const name of byName.keys()) if (!descriptorNames.has(name)) result.extraInLuna.push(name);
  return result;
}
