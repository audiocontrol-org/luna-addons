/** One parameter a gesture can touch and write. */
export interface GestureTarget {
  readonly name: string;
  begin(): void;
  end(): void;
  write(normalized: number): Promise<void>;
}

export interface Gestures {
  /** Writes `normalized` to `target`, opening a touch first and releasing any other one. */
  move(target: GestureTarget, normalized: number): void;
  /** Releases the open touch, if any. */
  release(why: string): void;
  /** Whether `target` has the open touch. */
  isOpen(target: GestureTarget): boolean;
}

/**
 * One touch at a time: a move opens a touch on its target, a move on another target releases
 * it, and `idleMs` without a move releases it. A rejected write releases the touch too, so
 * LUNA is never left holding one.
 */
export function createGestures(idleMs: number, record: (event: string, detail: unknown) => void): Gestures {
  let open: { target: GestureTarget; timer: ReturnType<typeof setTimeout> } | undefined;

  const release = (why: string): void => {
    if (!open) return;
    const { target, timer } = open;
    open = undefined;
    clearTimeout(timer);
    target.end();
    record('end', { param: target.name, why });
  };

  const move = (target: GestureTarget, normalized: number): void => {
    if (open && open.target !== target) release('switched control');
    if (!open) {
      target.begin();
      record('begin', { param: target.name });
      open = { target, timer: setTimeout(() => release('idle'), idleMs) };
    }
    clearTimeout(open.timer);
    open.timer = setTimeout(() => release('idle'), idleMs);
    target.write(normalized).catch((error: unknown) => {
      record('write-failed', { param: target.name, error: String(error) });
      if (open?.target === target) release('write failed');
    });
  };

  return { move, release, isOpen: (target) => open?.target === target };
}
