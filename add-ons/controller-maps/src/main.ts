// Controller Maps: the entry point. Connects to LUNA, loads the bundle, claims the bundled
// maps' surface and runs the app on LUNA's focused session (wiring.ts follows session
// switches), rendering the panel on every change.
// This is the one file outside src/surface/runtime/ that imports the runtime.
//
// npm run build bundles this file and everything it imports into dist/main.js, one classic
// script (an IIFE) that index.html loads after vendor/luna.global.js.

import generated from '@/bundle/generated.json';
import type { App } from '@/core/app';
import { panelModel } from '@/core/panel/model';
import { render, type PanelHandlers } from '@/core/panel/render';
import { watchChoices } from '@/core/panel/watch';
import { createSurface } from '@/surface/runtime/create';
import { loadBundle, startAddOn, type Running } from '@/wiring';

const NO_SESSION = 'Open a session in LUNA';
const PANEL_FAILURES_KEPT = 5;

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html has no #${id}`);
  return el;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

const showStatus = (text: string): void => {
  element('status').textContent = text;
};

const record = (event: string, detail: unknown): void => {
  console.info('[controller-maps]', event, detail);
};

async function connect(): Promise<Luna.Client> {
  for (;;) {
    try {
      // Inside LUNA the page URL carries ?port=; in a browser this connects to LUNA on
      // localhost.
      return await Luna.connect();
    } catch (e) {
      showStatus(e instanceof Luna.NotRunning ? 'Waiting for LUNA...' : describeError(e));
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function start(): Promise<void> {
  const luna = await connect();
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  showStatus('Loading...');
  await luna.plugins.load(); // the catalog names the plugins the panel shows
  const bundle = loadBundle(generated);
  const panel = element('panel'); // before the claim: a missing element must not strand it
  await startAddOn({ luna, bundle, createSurface, record, afterClaim: (running) => showPanel(luna, running, panel) });
}

// Runs once the surface is claimed. startAddOn stops the app and releases the surface if this
// throws; the listeners it added are dropped first. The panel follows the Add On's session:
// with none open it says so and shows nothing to act on.
async function showPanel(luna: Luna.Client, running: Running, panel: HTMLElement): Promise<void> {
  const { surface } = running;
  const offs: Luna.Unsubscribe[] = [];
  let watched: { session: Luna.Session; off: Luna.Unsubscribe } | undefined;
  let watching: Promise<void> = Promise.resolve();
  let closed = false;
  const unwatch = (): void => {
    watched?.off();
    watched = undefined;
  };
  window.addEventListener('pagehide', () => {
    closed = true;
    for (const off of offs) off();
    unwatch();
    running.stop().catch((error: unknown) => { record('stop-failed', { error }); });
  }, { once: true });
  let panelFailures: readonly string[] = [];

  const appNow = (): App => {
    const current = running.current();
    if (current === undefined) throw new Error('No session is open in LUNA');
    return current.app;
  };

  const paint = (): void => {
    const current = running.current();
    if (luna.status.value === 'disconnected') showStatus('Reconnecting...');
    else if (current !== undefined) showStatus('');
    else {
      const failure = running.failure();
      showStatus(failure === undefined ? NO_SESSION : `Controller Maps could not start on this session: ${failure}`);
    }
    if (current === undefined) {
      panel.replaceChildren();
      return;
    }
    const model = panelModel(current.app.state(), current.session, surface);
    model.problems.push(...panelFailures);
    render(panel, model, handlers);
  };
  const failed = (action: string, error: unknown): void => {
    record(`${action}-failed`, { error });
    panelFailures = [...panelFailures, `${action}-failed: ${describeError(error)}`].slice(-PANEL_FAILURES_KEPT);
    paint();
  };
  const handlers: PanelHandlers = {
    page: (step) => { appNow().page(step); },
    release: () => appNow().release(),
    reclaim: () => appNow().reclaim(),
    choose: (trackId, slotId) => appNow().targeting.choose(trackId, slotId),
    failed,
  };

  // The choices list follows the session: the old session's watcher goes when it is left.
  const rewatch = async (): Promise<void> => {
    const session = running.current()?.session;
    if (watched?.session === session) return;
    unwatch();
    if (session === undefined || closed) return;
    const off = await watchChoices(session, paint, (error) => { failed('choices', error); });
    if (closed || running.current()?.session !== session) {
      off();
      return;
    }
    watched = { session, off };
    paint();
  };
  const follow = (): void => {
    paint();
    watching = watching.then(rewatch).catch((error: unknown) => { failed('choices', error); });
  };

  try {
    offs.push(running.onChange(follow), surface.onStatus(paint), luna.status.onChange(paint));
    await rewatch();
    paint();
  } catch (error) {
    for (const off of offs.splice(0)) off();
    unwatch();
    throw error;
  }
}

start().catch((error: unknown) => {
  record('start-failed', { error });
  showStatus(`Controller Maps could not start: ${describeError(error)}`);
});
