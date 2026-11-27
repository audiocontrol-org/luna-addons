// Controller Maps: DOM wiring. Connects to LUNA and shows the connection status.
//
// npm run build bundles this file and everything it imports into dist/main.js, one classic
// script (an IIFE) that index.html loads after vendor/luna.global.js.

import { connectionStatus } from '@/logic';

function element(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`index.html has no #${id}`);
  return el;
}

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

async function connect(): Promise<Luna.Client> {
  for (;;) {
    try {
      // Inside LUNA the page URL carries ?port=; in a browser this connects to LUNA on
      // localhost.
      return await Luna.connect();
    } catch (e) {
      element('status').textContent = e instanceof Luna.NotRunning ? 'Waiting for LUNA...' : describeError(e);
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}

async function start(): Promise<void> {
  const luna = await connect();
  Luna.bindShortcuts(luna);
  await luna.sessions.ready();
  const paint = (): void => {
    element('status').textContent = connectionStatus(luna);
  };
  paint();
  luna.sessions.focused.onChange(paint);
  luna.sessions.items.onChange(paint);
  luna.status.onChange(() => {
    if (luna.status.value === 'disconnected') element('status').textContent = 'Reconnecting...';
  });
}

void start();
