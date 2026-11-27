import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';

/** The marker an operator (or the agent) touches to move an interactive probe on. */
export const NEXT_MARKER = join(process.cwd(), 'results', 'next');

/** Logs `prompt`, then waits until probes/results/next exists, and removes it. */
export async function waitForNext(log: (line: string) => void, prompt: string): Promise<void> {
  log(`WAITING: ${prompt}  (touch probes/results/next to continue)`);
  while (!existsSync(NEXT_MARKER)) await new Promise((resolve) => setTimeout(resolve, 250));
  unlinkSync(NEXT_MARKER);
}
