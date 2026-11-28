// The generic surface runtime: turns a surface definition (audiocontrol data) into a Surface.
// It maps addresses to control ids and layout presses to roles, and fills the profile's
// templates for the Add On's requests. It holds no device facts.
import type { SurfaceControl } from '@audiocontrol/canonical-midi-maps';
import type { SurfaceDefinition } from '@/bundle/types';
import type { Intent, Role, Surface } from '@/surface/api';
import { ROLES } from '@/surface/roles';
import { createLink } from '@/surface/runtime/claim';
import { fillAll, fillMessage, fromSevenBit, toSevenBit } from '@/surface/runtime/messages';

interface Binding {
  role: Role;
  control: string;
  with: string | undefined;
}

function isRole(value: string): value is Role {
  return ROLES.some((role) => role === value);
}

const addressKey = (channel: number, cc: number): string => `${channel}:${cc}`;

export function createSurface(luna: Luna.Client, definition: SurfaceDefinition): Surface {
  const { profile, layout } = definition;
  const id = profile.surface;
  if (layout.surface !== id) throw new Error(`The layout is for surface ${layout.surface}, not ${id}`);
  const byId = new Map(profile.controls.map((c) => [c.id, c]));
  const byAddress = new Map(profile.controls.map((c) => [addressKey(c.address.channel, c.address.cc), c]));

  const button = (controlId: string, role: string): string => {
    const control = byId.get(controlId);
    if (!control) throw new Error(`The layout for ${id} binds ${role} to control ${controlId}, which ${id} does not have`);
    if (control.kind !== 'button') throw new Error(`The layout for ${id} binds ${role} to ${controlId}, which is not a button`);
    return controlId;
  };
  const bindings: Binding[] = layout.bindings.map(({ role, press }) => {
    if (!isRole(role)) throw new Error(`The layout for ${id} binds role ${role}, which this Add On does not implement`);
    return { role, control: button(press.control, role), with: press.with === undefined ? undefined : button(press.with, role) };
  });
  const withControls = new Set(bindings.flatMap((b) => (b.with === undefined ? [] : [b.with])));
  const boundControls = new Set(bindings.map((b) => b.control));

  const link = createLink(luna, profile);
  const intentListeners = new Set<(intent: Intent) => void>();
  const held = new Set<string>();
  const indicated = new Set<Role>();

  const emit = (intent: Intent): void => {
    for (const listener of [...intentListeners]) listener(intent);
  };

  function onButton(control: string, pressed: boolean): void {
    if (withControls.has(control)) {
      if (pressed) held.add(control);
      else held.delete(control);
      return;
    }
    if (!boundControls.has(control)) return emit({ kind: pressed ? 'press' : 'release', control });
    if (!pressed) return;
    const own = bindings.filter((b) => b.control === control);
    const modified = own.find((b) => b.with !== undefined && held.has(b.with));
    const plain = own.find((b) => b.with === undefined);
    const fired = modified ?? plain;
    if (fired) emit({ kind: 'role', role: fired.role });
  }

  link.onControl((channel, cc, value) => {
    const control = byAddress.get(addressKey(channel, cc));
    if (!control) return;
    if (control.kind === 'button') return onButton(control.id, value > 0);
    emit({ kind: 'move', control: control.id, value: fromSevenBit(value) });
  });
  link.onStatus(() => {
    if (link.status().state !== 'ready') held.clear();
  });

  function template<T>(value: T | undefined, name: string): T {
    if (value === undefined) throw new Error(`${id} has no ${name} template`);
    return value;
  }

  function control(controlId: string): SurfaceControl {
    const found = byId.get(controlId);
    if (!found) throw new Error(`${id} has no control ${controlId}`);
    return found;
  }

  // The control that shows a role's state: its plain binding's control, else its first binding's.
  function indicator(role: Role): SurfaceControl {
    const own = bindings.filter((b) => b.role === role);
    const chosen = own.find((b) => b.with === undefined) ?? own[0];
    if (!chosen) throw new Error(`The layout for ${id} binds no control to ${role}, so ${role} has nowhere to show its state`);
    return control(chosen.control);
  }

  function indication(role: Role, state: number) {
    const { message } = template(profile.protocol.indicate, 'indicate');
    const { address } = indicator(role);
    return fillMessage(message, { cc: address.cc, channel: address.channel, state }, `${id} indicate`);
  }

  return {
    claim: () => link.claim(),
    async release() {
      const clear = [...indicated].map((role) => indication(role, template(profile.protocol.indicate, 'indicate').off));
      indicated.clear();
      await link.release(clear);
    },
    status: () => link.status(),
    onStatus: (listener) => link.onStatus(listener),
    onIntent(listener) {
      intentListeners.add(listener);
      return () => intentListeners.delete(listener);
    },
    controls: () => profile.controls.map((c) => ({ id: c.id, continuous: c.kind !== 'button', follows: c.follows === true })),
    bindingText(role) {
      const texts = bindings.filter((b) => b.role === role).map((b) => (b.with === undefined ? b.control : `${b.with} + ${b.control}`));
      return texts.length > 0 ? texts.join(' or ') : undefined;
    },
    async follow(controlId, normalized) {
      const message = template(profile.protocol.follow, 'follow');
      const target = control(controlId);
      if (target.follows !== true) throw new Error(`${id}: control ${controlId} does not follow a value`);
      const { cc, channel } = target.address;
      await link.write([fillMessage(message, { cc, channel, value: toSevenBit(normalized) }, `${id} follow`)]);
    },
    async label(controlId, text) {
      const messages = template(profile.protocol.label, 'label');
      const { cc, channel } = control(controlId).address;
      await link.write(fillAll(messages, { cc, channel, text }, `${id} label`));
    },
    async announce(text) {
      const messages = template(profile.protocol.announce, 'announce');
      await link.write(fillAll(messages, { text }, `${id} announce`));
    },
    async indicate(role, state) {
      template(profile.protocol.indicate, 'indicate');
      const feedback = layout.feedback?.find((f) => f.role === role);
      if (!feedback) throw new Error(`The layout for ${id} gives no feedback values for ${role}`);
      const sent = await link.write([indication(role, state === 'active' ? feedback.active : feedback.inactive)]);
      if (sent) indicated.add(role);
    },
  };
}
