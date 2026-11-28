// The parameter writer: turns semantic intents into LUNA parameter writes inside touch
// gestures. A control that follows is kept in step by asking the surface to follow the
// parameter's value; a continuous control that does not follow uses pickup, so a stale
// fader position never jumps the parameter. Buttons act by their binding's mode.
import type { ResolvedBinding } from '@/core/resolve';
import { createGestures, type GestureTarget } from '@/core/writer/gestures';
import type { Intent, Surface } from '@/surface/api';

export interface BoundParameter {
  binding: ResolvedBinding;
  param: Luna.Control;
}

export interface ParameterWriter {
  /** Replaces the current binding set; follows each "follows" control and arms pickup. */
  assign(bound: readonly BoundParameter[]): void;
  /** 'move', 'press' and 'release' only; roles go to the app. */
  handle(intent: Intent): void;
  release(why: string): void;
}

type Record = (event: string, detail: unknown) => void;

const PICKUP_WINDOW = 1 / 127;
const SAME = 1e-6;

interface Entry {
  bound: BoundParameter;
  target: GestureTarget;
  kind: 'follows' | 'pickup' | 'button';
  armed: boolean;
  previous: number | undefined; // last incoming value while armed
  written: number | undefined; // last value this writer wrote, to tell echoes from outside changes
  unsubscribe: Luna.Unsubscribe;
}

export function createParameterWriter(surface: Surface, idleMs: number, record: Record): ParameterWriter {
  const gestures = createGestures(idleMs, record);
  let entries = new Map<string, Entry>();

  const valueOf = (entry: Entry): number => {
    const value = entry.bound.param.normalized.value;
    if (value === undefined) {
      throw new Error(`Parameter "${entry.bound.binding.paramId}" (control "${entry.bound.binding.control}") has no value yet; load its controls first`);
    }
    return value;
  };

  const follow = (control: string, entry: Entry): void => {
    const value = valueOf(entry);
    surface.follow(control, value).catch((error: unknown) => {
      record('follow-failed', { control, error: String(error) });
    });
  };

  const write = (entry: Entry, value: number): Promise<void> => {
    entry.written = value;
    return entry.bound.param.normalized.set(value);
  };

  const onOutsideChange = (control: string, entry: Entry): void => {
    const value = entry.bound.param.normalized.value;
    if (value === undefined) return;
    // Echoes of this control's own writes can arrive late or out of order during a drag.
    if (gestures.isOpen(entry.target)) return;
    if (entry.written !== undefined && Math.abs(value - entry.written) < SAME) return;
    entry.written = undefined;
    if (entry.kind === 'follows') follow(control, entry);
    else if (entry.kind === 'pickup') {
      entry.armed = true;
      entry.previous = undefined;
    }
  };

  const makeEntry = (control: string, bound: BoundParameter, kind: Entry['kind']): Entry => {
    const entry: Entry = {
      bound,
      kind,
      armed: kind === 'pickup',
      previous: undefined,
      written: undefined,
      target: {
        name: bound.binding.paramId,
        begin: () => { bound.param.begin(); },
        end: () => { bound.param.end(); },
        write: (value) => write(entry, value),
      },
      unsubscribe: bound.param.normalized.onChange(() => { onOutsideChange(control, entry); }),
    };
    return entry;
  };

  const assign = (bound: readonly BoundParameter[]): void => {
    const info = new Map(surface.controls().map((c) => [c.id, c]));
    for (const b of bound) {
      if (!info.has(b.binding.control)) {
        throw new Error(`Binding names control "${b.binding.control}", which the surface does not report`);
      }
    }
    // Build everything first; a failure leaves the old entries and the open touch intact.
    const next = new Map<string, Entry>();
    try {
      for (const b of bound) {
        const control = b.binding.control;
        const c = info.get(control);
        if (c === undefined) continue;
        const kind = !c.continuous ? 'button' : c.follows ? 'follows' : 'pickup';
        const entry = makeEntry(control, b, kind);
        next.set(control, entry);
        valueOf(entry);
      }
    } catch (error) {
      for (const entry of next.values()) entry.unsubscribe();
      throw error;
    }
    gestures.release('reassigned');
    for (const entry of entries.values()) entry.unsubscribe();
    entries = next;
    for (const [control, entry] of next) if (entry.kind === 'follows') follow(control, entry);
  };

  const move = (entry: Entry, value: number): void => {
    if (entry.kind === 'button') return;
    if (entry.armed) {
      const target = valueOf(entry);
      const crossed = entry.previous !== undefined && (entry.previous - target) * (value - target) <= 0;
      if (Math.abs(value - target) > PICKUP_WINDOW && !crossed) {
        entry.previous = value;
        return;
      }
      entry.armed = false;
      entry.previous = undefined;
    }
    gestures.move(entry.target, value);
  };

  const press = (control: string, entry: Entry): void => {
    const mode = entry.bound.binding.mode;
    if (mode === undefined) {
      record('ignored', { control, why: 'button binding has no mode' });
      return;
    }
    void writeOnce(entry, mode === 'toggle' ? (valueOf(entry) > 0.5 ? 0 : 1) : 1);
  };

  const writeOnce = (entry: Entry, value: number): Promise<void> => {
    const param = entry.bound.param;
    param.begin();
    return write(entry, value)
      .catch((error: unknown) => { record('write-failed', { param: entry.bound.binding.paramId, error: String(error) }); })
      .finally(() => { param.end(); });
  };

  const handle = (intent: Intent): void => {
    if (intent.kind === 'role') return;
    const entry = entries.get(intent.control);
    if (entry === undefined) return;
    if (intent.kind === 'move') move(entry, intent.value);
    else if (entry.kind !== 'button') return;
    else if (intent.kind === 'press') press(intent.control, entry);
    else if (entry.bound.binding.mode === 'momentary') void writeOnce(entry, 0);
  };

  return { assign, handle, release: (why) => { gestures.release(why); } };
}
