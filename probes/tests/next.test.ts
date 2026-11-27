import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { waitForNext } from '@/lib/next';

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('waitForNext', () => {
  it('ignores a marker left over from before the prompt', async () => {
    const marker = join(mkdtempSync(join(tmpdir(), 'next-')), 'next');
    writeFileSync(marker, '');
    let done = false;
    const waiting = waitForNext(() => undefined, 'step', marker).then(() => { done = true; });
    await tick(600);
    expect(done).toBe(false);
    writeFileSync(marker, '');
    await waiting;
    expect(done).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});
