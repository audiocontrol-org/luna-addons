// The app: composes targeting, the resolver, the parameter writer and the transport binding
// around an injected Surface. It speaks only the Surface's semantic vocabulary; it never builds
// a surface and never sees a surface definition. Bindings are rebuilt whenever the target, its
// plugin, the page or the surface's readiness changes. Every failure goes through one sink that
// forwards to the injected `record` and keeps the latest few for the panel.
import type { Bundle } from '@/bundle/types';
import { buildBindings } from '@/core/bindings';
import type { Resolution } from '@/core/resolve';
import { createTargeting, type Target, type Targeting } from '@/core/targeting';
import { bindTransport } from '@/core/transport';
import { createParameterWriter, type BoundParameter } from '@/core/writer/writer';
import type { Surface, SurfaceStatus } from '@/surface/api';

export interface AppState {
  surface: SurfaceStatus;
  target: Target;
  resolution: Resolution | undefined;
  failures: readonly string[]; // the latest "<event>: <message>" for events ending in -failed
}

export interface App {
  start(): Promise<void>;
  stop(): Promise<void>;
  release(): Promise<void>; // ends any touch, then surface.release()
  reclaim(): Promise<void>; // surface.claim()
  page(step: 1 | -1): void; // the panel's Previous and Next
  state(): AppState;
  onChange(listener: () => void): Luna.Unsubscribe;
  targeting: Targeting;
}

type Sink = (event: string, detail: unknown) => void;

const TOUCH_IDLE_MS = 250;
const FAILURES_KEPT = 5;

function messageOf(detail: unknown): string {
  const error = typeof detail === 'object' && detail !== null && 'error' in detail ? detail.error : detail;
  return error instanceof Error ? error.message : String(error);
}

function sameInsert(a: Target, b: Target): boolean {
  return a.state === 'ready' && b.state === 'ready' && a.slot === b.slot && a.pluginId === b.pluginId;
}

export function createApp(session: Luna.Session, maps: Bundle['maps'], surface: Surface, record: Sink): App {
  const targeting = createTargeting(session);
  const listeners = new Set<() => void>();
  let failures: readonly string[] = [];
  let resolution: Resolution | undefined;
  let pageIndex = 0;
  let generation = 0; // a rebuild that finishes after a newer one started is dropped
  let lastTarget: Target = targeting.current();
  let lastState: SurfaceStatus['state'] = surface.status().state;
  let offs: Luna.Unsubscribe[] = [];

  const notify = (): void => { for (const listener of [...listeners]) listener(); };

  const sink: Sink = (event, detail) => {
    record(event, detail);
    if (!event.endsWith('-failed')) return;
    failures = [...failures, `${event}: ${messageOf(detail)}`].slice(-FAILURES_KEPT);
    notify();
  };

  const writer = createParameterWriter(surface, TOUCH_IDLE_MS, sink);

  // A surface request whose failure, thrown or rejected, is reported and never aborts the caller.
  const request = (event: string, detail: Record<string, unknown>, send: () => Promise<void>): void => {
    let pending: Promise<void>;
    try {
      pending = send();
    } catch (error) {
      sink(event, { ...detail, error });
      return;
    }
    pending.catch((error: unknown) => { sink(event, { ...detail, error }); });
  };

  const refuse = (event: string, error: unknown): void => {
    writer.assign([]);
    resolution = { ok: false, reason: messageOf({ error }), mismatches: [] };
    sink(event, { error });
  };

  // Bind and label only on a ready surface: elsewhere nothing reaches the device (R7), and a
  // surface that is not ready must not be written through.
  const apply = (bound: readonly BoundParameter[]): void => {
    if (surface.status().state !== 'ready') {
      writer.assign([]);
      return;
    }
    try {
      writer.assign(bound);
    } catch (error) {
      refuse('assign-failed', error);
      return;
    }
    for (const { binding } of bound) {
      request('label-failed', { control: binding.control }, () => surface.label(binding.control, binding.label));
    }
  };

  // Resolves true when this rebuild is current and its page binds.
  const rebuild = async (): Promise<boolean> => {
    generation += 1;
    const mine = generation;
    const target = targeting.current();
    if (target.state !== 'ready') {
      resolution = undefined;
      writer.assign([]);
      notify();
      return false;
    }
    try {
      const built = await buildBindings(maps, target, pageIndex);
      if (mine !== generation) return false;
      resolution = built.resolution;
      if (built.resolution.ok) pageIndex = built.resolution.pageIndex;
      apply(built.bound);
    } catch (error) {
      if (mine !== generation) return false;
      refuse('bindings-failed', error);
    }
    notify();
    return true;
  };

  // `after` runs only when this rebuild is still the current one once it finishes.
  const run = (after?: () => void): void => {
    rebuild()
      .then((current) => { if (current && after) after(); })
      .catch((error: unknown) => { sink('rebuild-failed', { error }); });
  };

  // The old bindings are invalid from this moment: no intent may reach them while the new
  // ones are loading.
  const invalidate = (why: string): void => {
    writer.release(why);
    writer.assign([]);
  };

  // Each page resolves on its own, so a refused page does not stop paging; only a plugin with
  // no map does.
  const page = (step: 1 | -1): void => {
    const target = targeting.current();
    if (target.state !== 'ready') return;
    const map = maps[target.pluginId];
    if (map === undefined || map.pages.length === 0) return;
    const total = map.pages.length;
    invalidate('page changed');
    pageIndex = (((pageIndex + step) % total) + total) % total;
    const index = pageIndex;
    const shown = map.pages[index];
    if (shown === undefined) throw new Error(`Map "${map.name}" has no page at index ${index}`);
    run(() => {
      const text = `${shown.name} ${index + 1}/${total}`;
      request('announce-failed', { text }, () => surface.announce(text));
    });
  };

  const onTarget = (): void => {
    const next = targeting.current();
    if (!sameInsert(lastTarget, next)) pageIndex = 0;
    lastTarget = next;
    invalidate('target changed');
    notify();
    run();
  };

  const onStatus = (): void => {
    const status = surface.status();
    if (status.state !== lastState) {
      lastState = status.state;
      if (status.state === 'ready') run();
      else invalidate(`surface ${status.state}: ${status.reason}`);
    }
    notify();
  };

  return {
    async start() {
      if (offs.length > 0) throw new Error('The app is already started');
      lastState = surface.status().state;
      offs = [
        surface.onIntent((intent) => {
          if (surface.status().state !== 'ready') return;
          if (intent.kind !== 'role') writer.handle(intent);
          else if (intent.role === 'page.next') page(1);
          else if (intent.role === 'page.previous') page(-1);
          // transport roles belong to bindTransport
        }),
        surface.onStatus(onStatus),
        targeting.onChange(onTarget),
        bindTransport(session, surface, sink),
      ];
      await rebuild();
    },
    async stop() {
      generation += 1;
      for (const off of offs) off();
      offs = [];
      targeting.clear(); // drops targeting's LUNA listeners
      writer.release('stopped');
      writer.assign([]); // drops the writer's parameter listeners
      resolution = undefined;
    },
    async release() {
      writer.release('controller released');
      await surface.release();
    },
    async reclaim() {
      await surface.claim();
    },
    page,
    state: () => ({ surface: surface.status(), target: targeting.current(), resolution, failures }),
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    targeting,
  };
}
