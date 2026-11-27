// Environment probe: what LUNA on this Mac reports. Run with a disposable session open and
// the controller connected:
//   npm run probe -w probes -- src/environment.ts
import { connectLive, lunaVersion, requireSession } from '@/lib/connect';
import { writeResult } from '@/lib/results';

const luna = await connectLive();
try {
  const version = await lunaVersion(luna);
  const guiAvailable = await luna.gui.available();

  await luna.midiDevices.load();
  const devices = luna.midiDevices.items.map((d) => ({
    name: d.name.value,
    midiDeviceType: d.midiDeviceType.value,
    isPhysical: d.isPhysical,
    hasInputPort: d.inputPort !== undefined,
    hasOutputPort: d.outputPort !== undefined,
  }));

  console.log('MIDI devices LUNA sees:');
  for (const d of devices.filter((x) => x.isPhysical)) console.log(`  "${d.name}"`);

  const session = await requireSession(luna);
  const tracks = [];
  for (const track of session.tracksInOrder) {
    await track.effects.load();
    tracks.push({
      name: track.name.value,
      effects: track.effects.items.map((e) => ({
        insertType: e.insertType.value,
        pluginId: e.pluginId.value,
        pluginName: e.pluginName.value,
        loaded: e.loaded.value,
        pluginError: e.pluginError.value,
      })),
    });
  }

  await luna.gui.watchPluginWindows();
  const pluginWindows = luna.gui.pluginWindows.value ?? [];

  const path = await writeResult('environment', { version, guiAvailable, devices, tracks, pluginWindows });
  console.log(`LUNA ${version}, gui ${guiAvailable ? 'available' : 'unavailable'}`);
  console.log('MIDI devices:');
  for (const d of devices.filter((x) => x.isPhysical)) {
    console.log(`  "${d.name}" in=${d.hasInputPort} out=${d.hasOutputPort} type=${d.midiDeviceType}`);
  }
  console.log(`Result: ${path}`);
} finally {
  await luna.close();
}
