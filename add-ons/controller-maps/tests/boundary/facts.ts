// The device facts the boundary scan denies in src/, read from the bundle's data: every
// surface's id, device manufacturer and model, port names and control ids. A fixed vendor
// baseline is always added, so the scan still catches those names if the bundle drops them.

export interface DeviceFacts {
  names: string[]; // surface ids, manufacturers, models, ports and the baseline: matched anywhere
  ports: string[]; // the port names among `names`
  controlIds: string[]; // matched only as a quoted string literal
}

const BASELINE = ['Novation', 'Launch Control', 'LCXL'];

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function field(value: unknown, key: string, where: string): unknown {
  if (!isObject(value) || !(key in value)) throw new Error(`The bundle's ${where} has no ${key}`);
  return value[key];
}

function text(value: unknown, key: string, where: string): string {
  const found = field(value, key, where);
  if (typeof found !== 'string' || found === '') throw new Error(`The bundle's ${where}.${key} is not a non-empty string`);
  return found;
}

export function deviceFactsOf(bundle: unknown): DeviceFacts {
  const surfaces = field(bundle, 'surfaces', 'top level');
  if (!isObject(surfaces)) throw new Error('The bundle\'s surfaces is not an object');
  const names = new Set<string>(BASELINE);
  const ports = new Set<string>();
  const controlIds = new Set<string>();
  for (const [key, surface] of Object.entries(surfaces)) {
    const where = `surface ${key}`;
    const profile = field(surface, 'profile', where);
    names.add(text(profile, 'surface', `${where} profile`));
    const device = field(profile, 'device', `${where} profile`);
    names.add(text(device, 'manufacturer', `${where} device`));
    names.add(text(device, 'model', `${where} device`));
    const portsOf = field(profile, 'ports', `${where} profile`);
    for (const direction of ['input', 'output']) ports.add(text(portsOf, direction, `${where} ports`));
    const controls = field(profile, 'controls', `${where} profile`);
    if (!Array.isArray(controls)) throw new Error(`The bundle's ${where} controls is not a list`);
    controls.forEach((control: unknown, i) => { controlIds.add(text(control, 'id', `${where} control ${i}`)); });
  }
  for (const port of ports) names.add(port);
  return { names: [...names], ports: [...ports], controlIds: [...controlIds] };
}
