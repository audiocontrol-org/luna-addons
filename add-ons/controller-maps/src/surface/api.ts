// The Surface: what Add On core code may know about a control surface. Semantic only: no
// addresses, bytes, ports or device names. This is the only surface module core imports.
import type { Role } from '@/surface/roles';

export type { Role } from '@/surface/roles';

export type Intent =
  | { kind: 'move'; control: string; value: number } // a continuous control, absolute 0..1
  | { kind: 'press' | 'release'; control: string } // a button no layout binding owns
  | { kind: 'role'; role: Role }; // a layout binding fired

export type SurfaceStatus =
  | { state: 'ready' }
  | { state: 'claiming' | 'suspended' | 'disconnected' | 'released'; reason: string };

export interface SurfaceControlInfo {
  id: string;
  continuous: boolean;
  follows: boolean;
}

// R7: follow, label, announce and indicate send only while the status is `ready`. In any other
// state they resolve without sending anything (they still reject a request that is wrong in
// itself, such as an unknown control or a template the surface lacks). Nothing is queued for
// later: core sends its whole state again (follows, labels, indications) each time the status
// becomes `ready`.
export interface Surface {
  claim(): Promise<void>;
  release(): Promise<void>; // clears every indication, then the profile's release sequence
  status(): SurfaceStatus;
  onStatus(listener: () => void): Luna.Unsubscribe;
  onIntent(listener: (intent: Intent) => void): Luna.Unsubscribe; // nothing is emitted unless ready
  controls(): readonly SurfaceControlInfo[];
  bindingText(role: Role): string | undefined; // e.g. "shift + button_side", for the panel
  follow(control: string, normalized: number): Promise<void>; // only for `follows` controls
  label(control: string, text: string): Promise<void>;
  announce(text: string): Promise<void>;
  indicate(role: Role, state: 'active' | 'inactive'): Promise<void>;
}
