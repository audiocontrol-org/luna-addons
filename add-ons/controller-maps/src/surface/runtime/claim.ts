// The link to one surface through LUNA's MIDI API: finding the profile's ports among LUNA's
// MIDI devices, the claim sequence, mode reports, and the claiming, ready, suspended,
// disconnected and released states. Every fact it acts on comes from the profile.
import type { SurfaceProfile } from '@audiocontrol/canonical-midi-maps';
import type { SurfaceStatus } from '@/surface/api';
import { fillAll, type WireMessage } from '@/surface/runtime/messages';

export interface Link {
  claim(): Promise<void>;
  // Sends `clear`, then the release sequence, when the ports are there.
  release(clear: readonly WireMessage[]): Promise<void>;
  status(): SurfaceStatus;
  onStatus(listener: () => void): Luna.Unsubscribe;
  // Controller messages other than mode reports, only while ready. Channels are 1-16.
  onControl(handler: (channel: number, cc: number, value: number) => void): Luna.Unsubscribe;
  // Writes are held back unless ready: true when the messages were sent.
  write(messages: readonly WireMessage[]): Promise<boolean>;
}

interface Ports {
  input: Luna.MidiPort;
  output: Luna.MidiPort;
}

type Found = { ok: true; ports: Ports } | { ok: false; reason: string };

function describeError(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export function createLink(luna: Luna.Client, profile: SurfaceProfile): Link {
  const id = profile.surface;
  const midiIn = new Luna.MidiInput(luna);
  const midiOut = new Luna.SendMidi(luna);
  const statusListeners = new Set<() => void>();
  const controlHandlers = new Set<(channel: number, cc: number, value: number) => void>();
  let current: SurfaceStatus = { state: 'released', reason: `${id} has not been claimed` };
  let wanted = false;
  let connected: { ports: Ports; stopInput: Luna.Unsubscribe } | undefined;
  let stopWatching: (() => void) | undefined;
  let generation = 0;

  function setStatus(next: SurfaceStatus): void {
    const same = next.state === current.state && (next.state === 'ready' || (current.state !== 'ready' && next.reason === current.reason));
    current = next;
    if (same) return;
    for (const listener of [...statusListeners]) listener();
  }

  function findPorts(): Found {
    const physical = luna.midiDevices.items.filter((d) => d.isPhysical);
    const input = physical.find((d) => d.name.value === profile.ports.input && d.inputPort)?.inputPort;
    const output = physical.find((d) => d.name.value === profile.ports.output && d.outputPort)?.outputPort;
    if (input && output) return { ok: true, ports: { input, output } };
    const missing: string[] = [];
    if (!input) missing.push(`input "${profile.ports.input}"`);
    if (!output) missing.push(`output "${profile.ports.output}"`);
    const seen = physical.map((d) => d.name.value ?? d.id);
    const listed = seen.length > 0 ? seen.map((name) => `"${name}"`).join(', ') : 'no MIDI devices';
    return { ok: false, reason: `${id} needs the MIDI ${missing.join(' and ')}; LUNA sees ${listed}` };
  }

  function drop(): void {
    generation++;
    connected?.stopInput();
    connected = undefined;
  }

  async function send(output: Luna.MidiPort, messages: readonly WireMessage[]): Promise<void> {
    for (const message of messages) {
      if (message.kind === 'sysex') await midiOut.sendSysExToOutput(output, message.bytes);
      else await midiOut.sendControllerToOutput(output, message.number, message.value, message.channel - 1);
    }
  }

  function modeReport(value: number): void {
    const mode = profile.protocol.mode;
    if (!mode || !connected) return;
    if (mode.ready.includes(value)) return setStatus({ state: 'ready' });
    const suspended = mode.suspended.find((entry) => entry.values.includes(value));
    if (suspended) return setStatus({ state: 'suspended', reason: suspended.reason });
    setStatus({ state: 'suspended', reason: `Unrecognised mode report ${value} from ${id}` });
  }

  function onMessage(message: Luna.MidiInputMessage): void {
    if (message.type !== 'controlChange') return;
    const channel = message.channel + 1;
    const mode = profile.protocol.mode;
    if (mode && channel === mode.address.channel && message.data1 === mode.address.cc) return modeReport(message.data2);
    if (current.state !== 'ready') return;
    for (const handler of [...controlHandlers]) handler(channel, message.data1, message.data2);
  }

  async function connect(ports: Ports): Promise<void> {
    const mine = ++generation;
    // Listen before claiming, so the mode report the claim provokes is heard.
    connected = { ports, stopInput: midiIn.listen(ports.input, onMessage) };
    setStatus({ state: 'claiming', reason: `Claiming ${id}; waiting for its mode report` });
    await send(ports.output, fillAll(profile.protocol.claim, {}, `${id} claim`));
    // A profile with no mode report has nothing to wait for.
    if (mine === generation && !profile.protocol.mode) setStatus({ state: 'ready' });
  }

  async function reconcile(): Promise<void> {
    if (!wanted) return;
    const found = findPorts();
    if (!found.ok) {
      if (connected) drop();
      setStatus({ state: 'disconnected', reason: found.reason });
      return;
    }
    const ports = connected?.ports;
    if (ports && ports.input.path === found.ports.input.path && ports.output.path === found.ports.output.path) return;
    if (connected) drop();
    await connect(found.ports);
  }

  function onDevices(): void {
    reconcile().catch((e: unknown) => {
      drop();
      setStatus({ state: 'disconnected', reason: `Claiming ${id} failed: ${describeError(e)}` });
    });
  }

  return {
    async claim() {
      if (wanted) throw new Error(`${id} is already claimed`);
      wanted = true;
      const watch = luna.midiDevices.watch();
      const stopChange = luna.midiDevices.onChange(onDevices);
      stopWatching = () => {
        stopChange();
        watch.release();
      };
      await watch.ready;
      await reconcile();
    },
    async release(clear) {
      if (!wanted) return;
      wanted = false;
      stopWatching?.();
      stopWatching = undefined;
      const link = connected;
      setStatus({ state: 'released', reason: `${id} was released` });
      if (!link) return;
      try {
        await send(link.ports.output, [...clear, ...fillAll(profile.protocol.release, {}, `${id} release`)]);
      } finally {
        drop();
      }
    },
    status: () => current,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    onControl(handler) {
      controlHandlers.add(handler);
      return () => controlHandlers.delete(handler);
    },
    async write(messages) {
      if (current.state !== 'ready' || !connected) return false;
      await send(connected.ports.output, messages);
      return true;
    },
  };
}
