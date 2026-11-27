import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** The marker an operator (or the agent) touches to move an interactive probe on. */
export const NEXT_MARKER = join(process.cwd(), 'results', 'next');

/**
 * Logs `prompt`, then waits until `marker` exists, and removes it. A marker already present
 * when the prompt is shown (left by a killed run, or a second touch during the last phase) is
 * removed first, so it can never move the probe on without the operator.
 */
export async function waitForNext(log: (line: string) => void, prompt: string, marker: string = NEXT_MARKER): Promise<void> {
  if (existsSync(marker)) unlinkSync(marker);
  log(`WAITING: ${prompt}  (touch probes/results/next to continue)`);
  while (!existsSync(marker)) await new Promise((resolve) => setTimeout(resolve, 250));
  unlinkSync(marker);
}
