// Controller Maps: the entry point. Connects to LUNA, waits for a session, loads the bundle,
// claims the bundled maps' surface and runs the app, rendering the panel on every change.
// This is the one file outside src/surface/runtime/ that imports the runtime.
//
// npm run build bundles this file and everything it imports into dist/main.js, one classic
// script (an IIFE) that index.html loads after vendor/luna.global.js.

import generated from '@/bundle/generated.json';
import { panelModel } from '@/core/panel/model';
import { render, type PanelHandlers } from '@/core/panel/render';
import { watchChoices } from '@/core/panel/watch';
import { createSurface } from '@/surface/runtime/create';
import { loadBundle, startAddOn } from '@/wiring';

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

// No session is no default: the panel says so and waits until LUNA has one open.
async function requireSession(luna: Luna.Client): Promise<Luna.Session> {
  if (luna.sessions.current() === undefined) {
    showStatus(NO_SESSION);
    await new Promise<void>((resolve) => {
      let offs: Luna.Unsubscribe[] = [];
      const check = (): void => {
        if (luna.sessions.current() === undefined) return;
        for (const off of offs) off();
        offs = [];
        resolve();
      };
      offs = [luna.sessions.focused.onChange(check), luna.sessions.items.onChange(check)];
    });
  }
  return luna.session();
}

async function start(): Promise<void> {
  const luna = await connect();
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  const session = await requireSession(luna);
  showStatus('Loading...');
  await luna.plugins.load(); // the catalog names the plugins the panel shows
  const bundle = loadBundle(generated);
  const running = await startAddOn({ luna, session, bundle, createSurface, record });
  const { app, surface } = running;
  const panel = element('panel');
  let panelFailures: readonly string[] = [];

  const paint = (): void => {
    const model = panelModel(app.state(), session, surface);
    model.problems.push(...panelFailures);
    render(panel, model, handlers);
  };
  const failed = (action: string, error: unknown): void => {
    record(`${action}-failed`, { error });
    panelFailures = [...panelFailures, `${action}-failed: ${describeError(error)}`].slice(-PANEL_FAILURES_KEPT);
    paint();
  };
  const handlers: PanelHandlers = {
    page: (step) => { app.page(step); },
    release: () => app.release(),
    reclaim: () => app.reclaim(),
    choose: (trackId, slotId) => app.targeting.choose(trackId, slotId),
    failed,
  };

  const offs: Luna.Unsubscribe[] = [
    app.onChange(paint),
    surface.onStatus(paint),
    await watchChoices(session, paint, (error) => { failed('choices', error); }),
    luna.status.onChange(() => {
      showStatus(luna.status.value === 'disconnected' ? 'Reconnecting...' : '');
    }),
  ];
  showStatus('');
  paint();

  window.addEventListener('pagehide', () => {
    for (const off of offs) off();
    running.stop().catch((error: unknown) => { record('stop-failed', { error }); });
  }, { once: true });
}

start().catch((error: unknown) => {
  record('start-failed', { error });
  showStatus(`Controller Maps could not start: ${describeError(error)}`);
});
