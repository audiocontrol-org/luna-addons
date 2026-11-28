// Keeps the panel's track and insert choices current: loads every track's inserts and calls
// `onChange` when a track comes or goes, or an insert's plugin changes. A track whose inserts
// fail to load goes to `failed`. Resolves once the tracks present at the start are loaded; the
// returned function drops every listener.
export async function watchChoices(
  session: Luna.Session,
  onChange: () => void,
  failed: (error: unknown) => void,
): Promise<Luna.Unsubscribe> {
  const perTrack = new Map<Luna.Track, Luna.Unsubscribe[]>();
  let stopped = false;

  const dropTrack = (track: Luna.Track): void => {
    for (const off of perTrack.get(track) ?? []) off();
    perTrack.delete(track);
  };

  // A track's listeners: its insert list, and each insert's plugin id.
  const watchTrack = (track: Luna.Track): void => {
    dropTrack(track);
    const offs = [
      track.effects.onChange(() => {
        watchTrack(track);
        onChange();
      }),
      ...track.effects.items.map((slot) => slot.pluginId.onChange(onChange)),
    ];
    perTrack.set(track, offs);
  };

  const load = async (track: Luna.Track): Promise<void> => {
    await track.effects.load();
    if (stopped || session.tracks.byId(track.id) !== track) return;
    watchTrack(track);
  };

  const sync = async (): Promise<void> => {
    const tracks = session.tracks.items;
    for (const track of [...perTrack.keys()]) if (!tracks.includes(track)) dropTrack(track);
    await Promise.all(tracks.filter((t) => !perTrack.has(t)).map(load));
  };

  const offTracks = session.tracks.onChange(() => {
    sync().then(onChange, failed);
  });
  await sync();
  return () => {
    stopped = true;
    offTracks();
    for (const track of [...perTrack.keys()]) dropTrack(track);
  };
}
