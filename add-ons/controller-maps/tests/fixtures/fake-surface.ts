// A Surface for tests: records follow/label/announce/indicate calls (no bytes), lets a test
// emit intents and set the status.
import type { Intent, Role, Surface, SurfaceControlInfo, SurfaceStatus } from '@/surface/api';

export interface FakeSurface extends Surface {
  readonly follows: Array<{ control: string; value: number }>;
  readonly indications: Array<{ role: Role; state: 'active' | 'inactive' }>;
  listenerCount(): number; // intent + status listeners still attached
  emit(intent: Intent): void;
  setStatus(status: SurfaceStatus): void;
}

export function createFakeSurface(controls: readonly SurfaceControlInfo[]): FakeSurface {
  let status: SurfaceStatus = { state: 'ready' };
  const intentListeners = new Set<(intent: Intent) => void>();
  const statusListeners = new Set<() => void>();
  const follows: Array<{ control: string; value: number }> = [];
  const indications: Array<{ role: Role; state: 'active' | 'inactive' }> = [];
  return {
    follows,
    indications,
    listenerCount: () => intentListeners.size + statusListeners.size,
    emit: (intent) => { for (const l of [...intentListeners]) l(intent); },
    setStatus: (next) => { status = next; for (const l of [...statusListeners]) l(); },
    claim: () => Promise.resolve(),
    release: () => Promise.resolve(),
    status: () => status,
    onStatus: (l) => { statusListeners.add(l); return () => { statusListeners.delete(l); }; },
    onIntent: (l) => { intentListeners.add(l); return () => { intentListeners.delete(l); }; },
    controls: () => controls,
    bindingText: (_role: Role) => undefined,
    follow: (control, value) => { follows.push({ control, value }); return Promise.resolve(); },
    label: () => Promise.resolve(),
    announce: () => Promise.resolve(),
    indicate: (role, state) => { indications.push({ role, state }); return Promise.resolve(); },
  };
}
