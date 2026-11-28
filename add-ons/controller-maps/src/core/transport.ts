// Transport: the layout's transport.play / transport.record roles drive LUNA's transport, and
// the surface is asked to indicate transport state. Roles and indications only; what a role is
// bound to and what an indication looks like is surface data. Failures from LUNA or the surface
// are reported through the injected sink, never swallowed.
import type { Surface } from '@/surface/api';

export function bindTransport(
  session: Luna.Session,
  surface: Surface,
  record: (event: string, detail: unknown) => void,
): Luna.Unsubscribe {
  const transport = session.transport;

  const indicate = (role: 'transport.play' | 'transport.record', on: boolean | undefined): void => {
    surface.indicate(role, on ? 'active' : 'inactive').catch((error: unknown) => {
      record('indicate-failed', { role, error });
    });
  };
  const indicateAll = (): void => {
    indicate('transport.play', transport.playing.value);
    indicate('transport.record', transport.recordEnabled.value);
  };
  const run = (role: 'transport.play' | 'transport.record', action: () => Promise<void>): void => {
    action().catch((error: unknown) => {
      record('transport-failed', { role, error });
    });
  };

  const offs: Luna.Unsubscribe[] = [
    surface.onIntent((intent) => {
      if (intent.kind !== 'role') return;
      if (intent.role === 'transport.play') run('transport.play', () => transport.toggle());
      else if (intent.role === 'transport.record') run('transport.record', () => transport.toggleRecord());
    }),
    surface.onStatus(() => {
      if (surface.status().state === 'ready') indicateAll();
    }),
    transport.playing.onChange(indicateAll),
    transport.recordEnabled.onChange(indicateAll),
  ];
  indicateAll();

  return () => { for (const off of offs) off(); };
}
