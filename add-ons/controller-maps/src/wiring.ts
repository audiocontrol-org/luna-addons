// The Add On's composition, without the DOM: check the bundle, pick its surface, build the
// surface with the injected factory, and start the app on it. main.ts injects the surface
// runtime's createSurface (it is the one file outside the runtime that may import it); tests
// inject the same function.
import type { Bundle } from '@/bundle/types';
import { createApp, type App } from '@/core/app';
import type { Surface } from '@/surface/api';

export type SurfaceFactory = (luna: Luna.Client, definition: Bundle['surfaces'][string]) => Surface;
export type RecordSink = (event: string, detail: unknown) => void;

export interface Running {
  app: App;
  surface: Surface;
  stop(): Promise<void>; // the app first, so nothing it sends races the release; runs once
}

export interface StartOptions {
  luna: Luna.Client;
  session: Luna.Session;
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

export async function startAddOn(options: StartOptions): Promise<Running> {
  const { luna, session, bundle, createSurface, record, afterClaim } = options;
  const id = surfaceIdOf(bundle.maps);
  const definition = bundle.surfaces[id];
  if (definition === undefined) throw new Error(`The bundled maps are for surface ${id}, which the bundle does not define`);
  const surface = createSurface(luna, definition);
  const app = createApp(session, bundle.maps, surface, record);
  let stopping: Promise<void> | undefined;
  const running: Running = {
    app,
    surface,
    stop() {
      stopping ??= (async () => {
        await app.stop();
        await surface.release();
      })();
      return stopping;
    },
  };
  await app.start();
  try {
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
