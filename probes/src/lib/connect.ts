import { Luna } from '@uaudio/luna-builder-sdk';

export const MINIMUM_LUNA_VERSION = '3.1.2';

function parts(version: string): number[] {
  return version.split('.').map((p) => Number.parseInt(p, 10));
}

/** Throws when `version` is older than `minimum`, comparing each dotted part as a number. */
export function requireLunaVersion(version: string, minimum: string): void {
  const have = parts(version);
  const need = parts(minimum);
  for (let i = 0; i < need.length; i++) {
    const h = have[i] ?? 0;
    const n = need[i] ?? 0;
    if (Number.isNaN(h)) throw new Error(`Cannot read LUNA version "${version}"`);
    if (h > n) return;
    if (h < n) throw new Error(`LUNA ${version} is older than ${minimum}; update LUNA`);
  }
}

/** The focused session, ready. Throws when no session is open. */
export async function requireSession(client: Luna.Client): Promise<Luna.Session> {
  await client.sessions.ready();
  const session = client.sessions.current();
  if (!session) throw new Error('No session is open in LUNA; open a disposable session first');
  await session.ready();
  return session;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** LUNA's version from `/status` (`properties.version`, e.g. `3.1.2.4699`). */
export async function lunaVersion(client: Luna.Client): Promise<string> {
  const reply: unknown = await client.raw.get('/status', { children: false, commands: false, flatvalue: true });
  const properties = isRecord(reply) ? reply['properties'] : undefined;
  const version = isRecord(properties) ? properties['version'] : undefined;
  if (typeof version !== 'string') throw new Error('LUNA /status did not report a version');
  return version;
}

/** Connects to the LUNA running on this Mac and refuses one older than 3.1.2. */
export async function connectLive(): Promise<Luna.Client> {
  const client = await Luna.connect();
  requireLunaVersion(await lunaVersion(client), MINIMUM_LUNA_VERSION);
  return client;
}
