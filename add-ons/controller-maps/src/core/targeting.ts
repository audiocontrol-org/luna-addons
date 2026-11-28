const CHOOSE_REASON = 'Choose a track and insert in the panel';
const EMPTY_REASON = 'The chosen insert is now empty';
const DELETED_REASON = 'The chosen track was deleted';

export type Target =
  | { state: 'none'; reason: string }
  | { state: 'ready'; track: Luna.Track; slot: Luna.Effect; pluginId: string };

export interface Targeting {
  choose(trackId: string, slotId: string): Promise<void>;
  clear(): void;
  current(): Target;
  onChange(listener: () => void): Luna.Unsubscribe;
}

function pluginOf(slot: Luna.Effect): string | undefined {
  return slot.isEmpty ? undefined : (slot.pluginId.value ?? undefined);
}

function same(a: Target, b: Target): boolean {
  if (a.state === 'none' && b.state === 'none') return a.reason === b.reason;
  if (a.state === 'ready' && b.state === 'ready') {
    return a.track === b.track && a.slot === b.slot && a.pluginId === b.pluginId;
  }
  return false;
}

export function createTargeting(session: Luna.Session): Targeting {
  let target: Target = { state: 'none', reason: CHOOSE_REASON };
  let unsubs: Luna.Unsubscribe[] = [];
  const listeners = new Set<() => void>();

  const release = (): void => {
    for (const off of unsubs) off();
    unsubs = [];
  };

  const set = (next: Target): void => {
    if (same(target, next)) return;
    target = next;
    for (const listener of [...listeners]) listener();
  };

  const lose = (reason: string): void => {
    release();
    set({ state: 'none', reason });
  };

  // Re-check the chosen track and slot; any loss ends the choice for good.
  const recheck = (track: Luna.Track, slot: Luna.Effect): void => {
    if (target.state !== 'ready' || target.slot !== slot) return;
    if (session.tracks.byId(track.id) === undefined) {
      lose(DELETED_REASON);
      return;
    }
    const pluginId = pluginOf(slot);
    if (pluginId === undefined) {
      lose(EMPTY_REASON);
      return;
    }
    set({ state: 'ready', track, slot, pluginId });
  };

  return {
    async choose(trackId, slotId) {
      const track = session.tracks.byId(trackId);
      if (track === undefined) throw new Error(`Track "${trackId}" not found`);
      await track.effects.load();
      const slot = track.effects.byId(slotId);
      if (slot === undefined) throw new Error(`Track "${track.name.value ?? trackId}" has no slot ${slotId}`);
      const pluginId = pluginOf(slot);
      if (pluginId === undefined) {
        throw new Error(`Track "${track.name.value ?? trackId}" slot ${slotId} is empty`);
      }
      release();
      unsubs = [
        slot.pluginId.onChange(() => { recheck(track, slot); }),
        session.tracks.onChange(() => { recheck(track, slot); }),
      ];
      set({ state: 'ready', track, slot, pluginId });
    },
    clear() {
      release();
      set({ state: 'none', reason: CHOOSE_REASON });
    },
    current: () => target,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
