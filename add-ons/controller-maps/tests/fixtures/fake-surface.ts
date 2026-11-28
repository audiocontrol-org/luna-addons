// A Surface for tests: records follow/label/announce/indicate calls (no bytes), lets a test
// emit intents and set the status. claim() makes it ready and release() makes it released, as
// the runtime does; label and announce can be made to fail.
import type { Intent, Role, Surface, SurfaceControlInfo, SurfaceStatus } from '@/surface/api';

export interface FakeSurface extends Surface {
  readonly follows: Array<{ control: string; value: number }>;
  readonly indications: Array<{ role: Role; state: 'active' | 'inactive' }>;
  readonly labels: Array<{ control: string; text: string }>;
  readonly announcements: string[];
  readonly calls: { claim: number; release: number };
  listenerCount(): number; // intent + status listeners still attached
  emit(intent: Intent): void;
  setStatus(status: SurfaceStatus): void;
}

export interface FakeSurfaceOptions {
  labelError?: Error; // label() rejects with it, as a surface with no label template does
  announceError?: Error;
}

export function createFakeSurface(controls: readonly SurfaceControlInfo[], options: FakeSurfaceOptions = {}): FakeSurface {
  let status: SurfaceStatus = { state: 'ready' };
  const intentListeners = new Set<(intent: Intent) => void>();
  const statusListeners = new Set<() => void>();
  const follows: Array<{ control: string; value: number }> = [];
  const indications: Array<{ role: Role; state: 'active' | 'inactive' }> = [];
  const labels: Array<{ control: string; text: string }> = [];
  const announcements: string[] = [];
  const calls = { claim: 0, release: 0 };
  const setStatus = (next: SurfaceStatus): void => {
    status = next;
    for (const l of [...statusListeners]) l();
  };
  return {
    follows,
    indications,
    labels,
    announcements,
    calls,
    listenerCount: () => intentListeners.size + statusListeners.size,
    emit: (intent) => { for (const l of [...intentListeners]) l(intent); },
    setStatus,
    claim: () => {
      calls.claim += 1;
      setStatus({ state: 'ready' });
      return Promise.resolve();
    },
    release: () => {
      calls.release += 1;
      setStatus({ state: 'released', reason: 'fake was released' });
      return Promise.resolve();
    },
    status: () => status,
    onStatus: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    onIntent: (l) => { intentListeners.add(l); return () => { intentListeners.delete(l); }; },
    controls: () => controls,
    bindingText: (_role: Role) => undefined,
    follow: (control, value) => { follows.push({ control, value }); return Promise.resolve(); },
    label: (control, text) => {
      if (options.labelError !== undefined) return Promise.reject(options.labelError);
      labels.push({ control, text });
      return Promise.resolve();
    },
    announce: (text) => {
      if (options.announceError !== undefined) return Promise.reject(options.announceError);
      announcements.push(text);
      return Promise.resolve();
    },
    indicate: (role, state) => { indications.push({ role, state }); return Promise.resolve(); },
  };
}
