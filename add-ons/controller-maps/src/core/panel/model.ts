// The panel model: what the panel shows for an AppState, as plain data. No DOM. The surface's
// own reasons are shown as they are; the panel adds no device wording.
import type { AppState } from '@/core/app';
import type { Surface } from '@/surface/api';

export interface PanelChoice {
  trackId: string;
  trackName: string;
  slots: Array<{ slotId: string; label: string }>;
}

export interface PanelModel {
  status: string;
  target: string;
  page: string;
  paging: string;
  rows: Array<{ control: string; parameter: string }>;
  problems: string[];
  choices: PanelChoice[];
  controller: 'release' | 'reclaim';
}

const RELEASED = 'Released: Reclaim controller to use it again';
const SEPARATOR = ' · ';

// The slot reports its plugin's name once LUNA has it; until then the plugin catalog has it.
function pluginNameOf(session: Luna.Session, slot: Luna.Effect, pluginId: string): string {
  const name = slot.pluginName.value ?? session.client.plugins.byId(pluginId)?.name.value;
  return name ?? `${pluginId} (not in LUNA's plugin catalog)`;
}

function trackNameOf(track: Luna.Track): string {
  return track.name.value ?? track.id;
}

function choicesOf(session: Luna.Session): PanelChoice[] {
  const choices: PanelChoice[] = [];
  for (const track of session.tracks.items) {
    const slots: PanelChoice['slots'] = [];
    for (const slot of track.loadedEffects) {
      const pluginId = slot.isEmpty ? undefined : (slot.pluginId.value ?? undefined);
      if (pluginId === undefined) continue;
      slots.push({ slotId: slot.id, label: `${slot.id}${SEPARATOR}${pluginNameOf(session, slot, pluginId)}` });
    }
    if (slots.length > 0) choices.push({ trackId: track.id, trackName: trackNameOf(track), slots });
  }
  return choices;
}

function pagingOf(surface: Pick<Surface, 'bindingText'>): string {
  const parts: string[] = [];
  const next = surface.bindingText('page.next');
  const previous = surface.bindingText('page.previous');
  if (next !== undefined) parts.push(`Next: ${next}`);
  if (previous !== undefined) parts.push(`Previous: ${previous}`);
  return parts.join(SEPARATOR);
}

function statusOf(state: AppState, session: Luna.Session): string {
  const { surface, target, resolution } = state;
  if (surface.state === 'released') return RELEASED;
  if (surface.state !== 'ready') return `Controller: ${surface.reason}`;
  if (target.state !== 'ready') return target.reason;
  if (resolution === undefined) return `Loading the map for ${pluginNameOf(session, target.slot, target.pluginId)}`;
  return resolution.ok ? 'Ready' : resolution.reason;
}

function targetOf(state: AppState, session: Luna.Session): string {
  const { target } = state;
  if (target.state !== 'ready') return '';
  return [trackNameOf(target.track), target.slot.id, pluginNameOf(session, target.slot, target.pluginId)].join(SEPARATOR);
}

export function panelModel(state: AppState, session: Luna.Session, surface: Pick<Surface, 'bindingText'>): PanelModel {
  const { resolution } = state;
  const model: PanelModel = {
    status: statusOf(state, session),
    target: targetOf(state, session),
    page: '',
    paging: pagingOf(surface),
    rows: [],
    problems: [],
    choices: choicesOf(session),
    controller: state.surface.state === 'released' ? 'reclaim' : 'release',
  };
  if (resolution !== undefined && resolution.ok) {
    model.page = `${resolution.pageName} (${resolution.pageIndex + 1} of ${resolution.map.pages.length})`;
    model.rows = resolution.bindings.map((b) => ({ control: b.control, parameter: b.label }));
  } else if (resolution !== undefined) {
    model.problems.push(...resolution.mismatches);
  }
  model.problems.push(...state.failures);
  return model;
}
