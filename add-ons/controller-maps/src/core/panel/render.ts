// The panel's DOM: a thin render of a PanelModel. Every button calls the app; a rejected
// action goes to `failed`, which the caller shows in the panel. `panelButtons` is the DOM-free
// part, so tests can check what each button does.
import type { PanelModel } from '@/core/panel/model';

export interface PanelActions {
  page(step: 1 | -1): void;
  release(): Promise<void>;
  reclaim(): Promise<void>;
}

export interface PanelHandlers extends PanelActions {
  choose(trackId: string, slotId: string): Promise<void>;
  failed(action: string, error: unknown): void;
}

export interface PanelButton {
  label: string;
  run(): void | Promise<void>;
}

export function panelButtons(model: PanelModel, actions: PanelActions): PanelButton[] {
  const controller: PanelButton =
    model.controller === 'reclaim'
      ? { label: 'Reclaim controller', run: () => actions.reclaim() }
      : { label: 'Release controller', run: () => actions.release() };
  return [
    { label: 'Previous', run: () => { actions.page(-1); } },
    { label: 'Next', run: () => { actions.page(1); } },
    controller,
  ];
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== '') node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function button(label: string, action: string, run: () => void | Promise<void>, failed: PanelHandlers['failed']): HTMLButtonElement {
  const node = el('button', '', label);
  node.type = 'button';
  node.addEventListener('click', () => {
    try {
      Promise.resolve(run()).catch((error: unknown) => { failed(action, error); });
    } catch (error) {
      failed(action, error);
    }
  });
  return node;
}

function rowsTable(model: PanelModel): HTMLElement {
  const table = el('table', 'rows');
  for (const row of model.rows) {
    const tr = el('tr', '');
    tr.append(el('td', 'control', row.control), el('td', 'parameter', row.parameter));
    table.append(tr);
  }
  return table;
}

function choiceList(model: PanelModel, handlers: PanelHandlers): HTMLElement {
  const section = el('section', 'choices');
  section.append(el('h2', '', 'Track and insert'));
  for (const choice of model.choices) {
    const group = el('div', 'choice');
    group.append(el('div', 'track', choice.trackName));
    for (const slot of choice.slots) {
      group.append(button(slot.label, 'choose', () => handlers.choose(choice.trackId, slot.slotId), handlers.failed));
    }
    section.append(group);
  }
  return section;
}

export function render(root: HTMLElement, model: PanelModel, handlers: PanelHandlers): void {
  const head = el('section', 'head');
  head.append(el('div', 'status', model.status));
  if (model.target !== '') head.append(el('div', 'target', model.target));
  if (model.page !== '') head.append(el('div', 'page', model.page));
  if (model.paging !== '') head.append(el('div', 'paging', model.paging));
  const actions = el('div', 'actions');
  for (const b of panelButtons(model, handlers)) actions.append(button(b.label, b.label, () => b.run(), handlers.failed));
  head.append(actions);
  const parts: HTMLElement[] = [head];
  if (model.rows.length > 0) parts.push(rowsTable(model));
  if (model.problems.length > 0) {
    const list = el('ul', 'problems');
    for (const problem of model.problems) list.append(el('li', '', problem));
    parts.push(list);
  }
  parts.push(choiceList(model, handlers));
  root.replaceChildren(...parts);
}
