// Lists every track's loaded inserts and their parameter names, so a spike can be pointed at
// exact names.   npm run probe -w probes -- src/list-inserts.ts
import { connectLive, requireSession } from '@/lib/connect';

const luna = await connectLive();
try {
  const session = await requireSession(luna);
  for (const track of session.tracksInOrder) {
    await track.effects.load();
    console.log(`track "${track.name.value}"`);
    for (const slot of track.effects.items) {
      if (!slot.pluginId.value) continue;
      await slot.controls.load();
      console.log(`  ${slot.insertType.value}  ${slot.pluginId.value}`);
      console.log(`    params: ${slot.params.map((p) => `${p.name.value} [${p.id}]`).join(', ')}`);
    }
  }
} finally {
  await luna.close();
}
