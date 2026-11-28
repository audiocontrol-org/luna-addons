// Labels on the controller follow the bound set: a control the new set leaves out is labelled
// with empty text, so no control keeps showing a parameter it no longer drives.
import { afterEach, describe, expect, it } from 'vitest';
import { flush, forgetRunning, rig, stopRunning, UNMAPPED, visionMap } from './fixtures/app-rig';

function pageControls(index: number): string[] {
  const page = visionMap().pages[index];
  if (!page) throw new Error(`the API Vision map has no page ${index}`);
  return page.assignments.map((a) => a.control);
}

const cleared = (labels: ReadonlyArray<{ control: string; text: string }>): string[] =>
  labels.filter((l) => l.text === '').map((l) => l.control).sort();

describe('app labels', () => {
  afterEach(stopRunning);

  it('"Channel" to "560 EQ" clears the controls the new page leaves out, encoders 2_3 to 2_8 among them', async () => {
    const { surface } = await rig();
    surface.labels.length = 0;
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    const second = new Set(pageControls(1));
    const expected = pageControls(0).filter((c) => !second.has(c)).sort();
    expect(expected).toEqual(expect.arrayContaining(['encoder_2_3', 'encoder_2_4', 'encoder_2_5', 'encoder_2_6', 'encoder_2_7', 'encoder_2_8']));
    expect(cleared(surface.labels)).toEqual(expected);
    // and the new page's controls get their names, not empty text
    for (const control of second) expect(surface.labels.some((l) => l.control === control && l.text !== '')).toBe(true);
  });

  it('a switch to an unmapped plugin clears every label', async () => {
    const { surface, slot } = await rig();
    surface.labels.length = 0;
    await slot.setPlugin(UNMAPPED);
    await flush();
    expect(cleared(surface.labels)).toEqual([...new Set(pageControls(0))].sort());
  });

  it('clearing the target clears every label', async () => {
    const { surface, app } = await rig();
    surface.labels.length = 0;
    app.targeting.clear();
    await flush();
    expect(cleared(surface.labels)).toEqual([...new Set(pageControls(0))].sort());
  });

  it('stop clears the labels it set', async () => {
    const { surface, app } = await rig();
    surface.labels.length = 0;
    await app.stop();
    forgetRunning();
    expect(cleared(surface.labels)).toEqual([...new Set(pageControls(0))].sort());
  });

  it('a clear that fails is recorded as label-failed', async () => {
    const { surface, events } = await rig({ surface: { labelError: new Error('fake has no label template') } });
    events.length = 0;
    surface.emit({ kind: 'role', role: 'page.next' });
    await flush();
    const failed = events.filter((e) => e.event === 'label-failed').map((e) => e.detail);
    expect(failed).toContainEqual(expect.objectContaining({ control: 'encoder_2_3' }));
  });
});
