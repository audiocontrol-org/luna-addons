// Transport: the layout's transport.play / transport.record roles drive LUNA's transport, and
// the surface is asked to indicate transport state. Roles and indications only; what a role is
// bound to and what an indication looks like is surface data. Errors from LUNA or the surface
// are not caught here: they reject unhandled.
import type { Surface } from '@/surface/api';

export function bindTransport(session: Luna.Session, surface: Surface): Luna.Unsubscribe {
  const transport = session.transport;

  const indicateAll = (): void => {
    void surface.indicate('transport.play', transport.playing.value ? 'active' : 'inactive');
    void surface.indicate('transport.record', transport.recordEnabled.value ? 'active' : 'inactive');
  };

  const offs: Luna.Unsubscribe[] = [
    surface.onIntent((intent) => {
      if (intent.kind !== 'role') return;
      if (intent.role === 'transport.play') void transport.toggle();
      else if (intent.role === 'transport.record') void transport.toggleRecord();
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
