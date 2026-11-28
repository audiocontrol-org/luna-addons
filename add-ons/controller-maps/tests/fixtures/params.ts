// A plugin parameter node in Luna.MockEngine, as LUNA reports one, recording touches.
export function addParam(engine: Luna.MockEngine, path: string, name: string): void {
  engine.addNode(path, {
    properties: {
      uid: `ctl_${path.replaceAll('/', '_')}`,
      name,
      control_type: 'parameter',
      value: 0.5,
      real_value: 0.5,
      normalized_value: 0.5,
      string_value: '0.5',
      automatable: true,
      discrete: false,
      num_steps: 0,
      initialized: true,
      touch_count: 0,
      real_values: [],
      string_values: [],
      taper: null,
    },
    commands: {
      set_touch: (data, eng, nodePath) => {
        const on = typeof data === 'object' && data !== null && 'touch' in data && Boolean(data.touch);
        eng.touches.push(`${nodePath}:${on ? 'on' : 'off'}`);
        return null;
      },
    },
  });
}
