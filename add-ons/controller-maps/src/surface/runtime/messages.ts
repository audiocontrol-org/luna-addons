// Fills a profile's message templates into wire messages. The templates are data from
// audiocontrol; this file knows only the placeholder grammar of map contract 2.
import type { Message } from '@audiocontrol/canonical-midi-maps';

// A filled message. Channels are 1-16, as the profile writes them.
export type WireMessage = { kind: 'sysex'; bytes: number[] } | { kind: 'cc'; channel: number; number: number; value: number };

// The values a template may ask for. A placeholder whose value is absent throws.
export interface Fill {
  cc?: number;
  channel?: number;
  value?: number;
  state?: number;
  text?: string;
}

const SEVEN_BIT_MAX = 127;
const PRINTABLE_FIRST = 32;
const PRINTABLE_LAST = 126;
const HEX_PAIR = /^[0-9A-Fa-f]{2}$/;

// round(normalized * 127), clamped to 0..127.
export function toSevenBit(normalized: number): number {
  if (!Number.isFinite(normalized)) throw new Error(`A normalized value must be a finite number, got ${normalized}`);
  return Math.min(SEVEN_BIT_MAX, Math.max(0, Math.round(normalized * SEVEN_BIT_MAX)));
}

// A received 7-bit controller value, as 0..1.
export function fromSevenBit(value: number): number {
  return value / SEVEN_BIT_MAX;
}

export function asciiBytes(text: string): number[] {
  return [...text].map((char) => {
    const code = char.codePointAt(0);
    if (code === undefined || code < PRINTABLE_FIRST || code > PRINTABLE_LAST) {
      throw new Error(`Text "${text}" holds "${char}", which is not printable ASCII; the surface takes printable ASCII only`);
    }
    return code;
  });
}

function need(value: number | undefined, name: string, where: string): number {
  if (value === undefined) throw new Error(`${where}: the template uses {${name}}, and this request gives it no value`);
  return value;
}

function sysexToken(token: string, fill: Fill, where: string): number[] {
  switch (token) {
    case '{cc}':
      return [need(fill.cc, 'cc', where)];
    case '{channel}':
      return [need(fill.channel, 'channel', where)];
    case '{value}':
      return [need(fill.value, 'value', where)];
    case '{state}':
      return [need(fill.state, 'state', where)];
    case '{text}':
      if (fill.text === undefined) throw new Error(`${where}: the template uses {text}, and this request gives it no text`);
      return asciiBytes(fill.text);
    default:
      if (!HEX_PAIR.test(token)) throw new Error(`${where}: "${token}" is neither a hex byte nor a placeholder`);
      return [parseInt(token, 16)];
  }
}

function ccField(field: number | string, fill: Fill, where: string): number {
  if (typeof field === 'number') return field;
  switch (field) {
    case '{cc}':
      return need(fill.cc, 'cc', where);
    case '{channel}':
      return need(fill.channel, 'channel', where);
    case '{value}':
      return need(fill.value, 'value', where);
    case '{state}':
      return need(fill.state, 'state', where);
    default:
      throw new Error(`${where}: "${field}" is not a placeholder a cc message may use`);
  }
}

// `where` names the surface and template, for errors.
export function fillMessage(message: Message, fill: Fill, where: string): WireMessage {
  if ('sysex' in message) {
    const tokens = message.sysex.trim().split(/\s+/);
    return { kind: 'sysex', bytes: tokens.flatMap((token) => sysexToken(token, fill, where)) };
  }
  const { channel, number, value } = message.cc;
  return { kind: 'cc', channel: ccField(channel, fill, where), number: ccField(number, fill, where), value: ccField(value, fill, where) };
}

export function fillAll(messages: readonly Message[], fill: Fill, where: string): WireMessage[] {
  return messages.map((message) => fillMessage(message, fill, where));
}
