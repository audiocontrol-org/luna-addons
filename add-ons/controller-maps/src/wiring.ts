// The Add On's composition, without the DOM: check the bundle, pick its surface, build the
// surface with the injected factory, claim it, and run an app on LUNA's focused session,
// rebuilding it when the session changes. main.ts injects the surface
// runtime's createSurface (it is the one file outside the runtime that may import it); tests
// inject the same function.
import type { Bundle } from '@/bundle/types';
import { createApp, type App } from '@/core/app';
import type { Surface } from '@/surface/api';

export type SurfaceFactory = (luna: Luna.Client, definition: Bundle['surfaces'][string]) => Surface;
export type RecordSink = (event: string, detail: unknown) => void;

export interface SessionApp {
  session: Luna.Session;
  app: App;
}

export interface Running {
  surface: Surface;
  // The focused session (or the first open one) and its app; undefined while none is open.
  current(): SessionApp | undefined;
  // Why the last switch built no app, until a later one succeeds.
  failure(): string | undefined;
  // After a session switch, and on every change of the current app.
  onChange(listener: () => void): Luna.Unsubscribe;
  stop(): Promise<void>; // the app first, so nothing it sends races the release; runs once
}

export interface StartOptions {
  luna: Luna.Client; // luna.sessions.ready() has resolved
  bundle: Bundle;
  createSurface: SurfaceFactory;
  record: RecordSink;
  // Runs once the surface is claimed (main.ts sets up the panel here). If it throws, the app
  // is stopped and the surface released before startAddOn rejects with its error.
  afterClaim?: (running: Running) => Promise<void>;
}

const SUPPORTED_CONTRACT = 2;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// The bundle compiler (scripts/build-bundle.ts) parses every definition and map with
// audiocontrol's parser, so the whole shape is checked at build time. At load this checks the
// contract and that the top-level parts are present; it does not re-parse the definitions.
function assertBundle(value: unknown): asserts value is Bundle {
  if (!isObject(value)) throw new Error('The bundle (generated.json) is not an object; run npm run bundle');
  const contract = 'contract' in value ? value.contract : undefined;
  if (contract !== SUPPORTED_CONTRACT) {
    throw new Error(`The bundle is map contract ${String(contract)}; this Add On reads contract ${SUPPORTED_CONTRACT}`);
  }
  if (!('audiocontrolRevision' in value) || typeof value.audiocontrolRevision !== 'string') {
    throw new Error('The bundle names no audiocontrol revision');
  }
  if (!('surfaces' in value) || !isObject(value.surfaces)) throw new Error('The bundle has no surfaces');
  if (!('maps' in value) || !isObject(value.maps)) throw new Error('The bundle has no maps');
}

export function loadBundle(data: unknown): Bundle {
  assertBundle(data);
  return data;
}

// The one surface every bundled map is written for (ruling R5).
export function surfaceIdOf(maps: Bundle['maps']): string {
  const ids = [...new Set(Object.values(maps).map((m) => m.surface))].sort();
  const [only] = ids;
  if (only === undefined) throw new Error('The bundle has no maps, so there is no surface to claim');
  if (ids.length > 1) throw new Error(`The bundled maps name more than one surface: ${ids.join(', ')}`);
  return only;
}

// Follows LUNA's focused session. A switch stops the old session's app, then builds and starts
// one on the new session, on the same surface: the surface stays claimed throughout, so a
// switch never releases the controller. With no session open there is no app, so nothing
// writes. Switches run one after another; one overtaken by a newer switch builds nothing.
interface Follower extends Running {
  sync(): Promise<void>; // builds the app for the session LUNA has now; resolves once it is built
}

function followSessions(options: StartOptions, surface: Surface): Follower {
  const { luna, bundle, record } = options;
  const listeners = new Set<() => void>();
  let current: (SessionApp & { off: Luna.Unsubscribe }) | undefined;
  let wanted: Luna.Session | undefined;
  let queue: Promise<void> = Promise.resolve();
  let stopped = false;
  let stopping: Promise<void> | undefined;
  let failure: string | undefined;

  const notify = (): void => { for (const listener of [...listeners]) listener(); };

  const leave = async (): Promise<void> => {
    const old = current;
    if (old === undefined) return;
    current = undefined;
    old.off();
    await old.app.stop();
    notify();
  };

  const enter = async (next: Luna.Session | undefined): Promise<void> => {
    if (next !== wanted || stopped) return; // a newer switch is queued
    await leave();
    if (next === undefined) return;
    await next.ready();
    if (next !== wanted || stopped) return;
    const app = createApp(next, bundle.maps, surface, record);
    await app.start();
    current = { session: next, app, off: app.onChange(notify) };
    failure = undefined;
    notify();
  };

  const sync = (): Promise<void> => {
    const next = luna.sessions.current();
    if (next === wanted) return queue;
    wanted = next;
    queue = queue.then(() => enter(next)).catch((error: unknown) => {
      record('session-failed', { session: next?.uid, error });
      failure = messageOf(error);
      notify();
    });
    return queue;
  };

  const offs = [luna.sessions.focused.onChange(() => { void sync(); }), luna.sessions.items.onChange(() => { void sync(); })];

  return {
    surface,
    sync,
    current: () => (current === undefined ? undefined : { session: current.session, app: current.app }),
    failure: () => failure,
    onChange(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    stop() {
      stopping ??= (async () => {
        stopped = true;
        for (const off of offs) off();
        await queue;
        await leave();
        await surface.release();
      })();
      return stopping;
    },
  };
}

export async function startAddOn(options: StartOptions): Promise<Running> {
  const { luna, bundle, createSurface, afterClaim } = options;
  const id = surfaceIdOf(bundle.maps);
  const definition = bundle.surfaces[id];
  if (definition === undefined) throw new Error(`The bundled maps are for surface ${id}, which the bundle does not define`);
  const surface = createSurface(luna, definition);
  const running = followSessions(options, surface);
  try {
    await running.sync(); // the app listens before the claim, so it sees the surface become ready
    await surface.claim();
    if (afterClaim !== undefined) await afterClaim(running);
  } catch (error) {
    try {
      await running.stop();
    } catch (stopError) {
      throw new AggregateError([error, stopError], `Starting failed (${messageOf(error)}), and so did releasing the surface (${messageOf(stopError)})`);
    }
    throw error;
  }
  return running;
}
