// Controller Maps: logic that does not touch the DOM, so tests can exercise it against
// Luna.MockEngine.
//
// `Luna` is the global that vendor/luna.global.js defines; tsconfig.json types it through
// "@uaudio/luna-builder-sdk/global". Do not import the SDK here: the page already loads it.

/** One line for the panel: the focused session's name, or that none is open. */
export function connectionStatus(client: Luna.Client): string {
  const session = client.sessions.current();
  if (!session) return 'Connected: no session open';
  return `Connected: ${session.name.value ?? session.uid}`;
}
