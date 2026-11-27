import { describe, expect, it } from 'vitest';
import { Luna } from '@uaudio/luna-builder-sdk';
import { requireArg } from '@/lib/args';
import { requireLunaVersion, requireSession } from '@/lib/connect';

describe('requireLunaVersion', () => {
  it('refuses LUNA older than 3.1.2', () => {
    expect(() => requireLunaVersion('2.0.5', '3.1.2')).toThrow('LUNA 2.0.5 is older than 3.1.2; update LUNA');
  });

  it('compares each part as a number', () => {
    expect(() => requireLunaVersion('3.1.10', '3.1.2')).not.toThrow();
    expect(() => requireLunaVersion('3.1.2.4699', '3.1.2')).not.toThrow();
  });
});

describe('requireSession', () => {
  it('refuses when no session is open', async () => {
    const engine = new Luna.MockEngine();
    const luna = await Luna.connect({ port_: engine.port() });
    await luna.sessions.ready();
    await expect(requireSession(luna)).rejects.toThrow('No session is open in LUNA');
  });

  it('returns the open session', async () => {
    const engine = new Luna.MockEngine();
    engine.addSession('abc', { name: 'Demo', tracks: ['Vocal'] });
    await engine.settled();
    const luna = await Luna.connect({ port_: engine.port() });
    await luna.sessions.ready();
    const session = await requireSession(luna);
    expect(session.name.value).toBe('Demo');
  });
});

describe('requireArg', () => {
  it('returns the value after the flag', () => {
    expect(requireArg(['--device', 'LCXL3 1 MIDI'], 'device')).toBe('LCXL3 1 MIDI');
  });

  it('names the missing flag', () => {
    expect(() => requireArg(['--other', 'x'], 'device')).toThrow('Missing required argument --device');
  });
});
