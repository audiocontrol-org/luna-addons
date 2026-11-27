// Runs against Luna.MockEngine: no LUNA needed. tests/setup.ts defines the Luna global that
// src/ reads.
import { describe, expect, it } from 'vitest';
import { connectionStatus } from '@/logic';

describe('Controller Maps', () => {
  it('reports the focused session by name', async () => {
    const engine = new Luna.MockEngine();
    engine.addSession('abc', { name: 'Demo', tracks: ['Vocal'] });
    await engine.settled();
    const luna = await Luna.connect({ port_: engine.port() });
    await luna.sessions.ready();
    expect(connectionStatus(luna)).toBe('Connected: Demo');
  });

  it('says when no session is open', async () => {
    const engine = new Luna.MockEngine();
    const luna = await Luna.connect({ port_: engine.port() });
    await luna.sessions.ready();
    expect(connectionStatus(luna)).toBe('Connected: no session open');
  });
});
