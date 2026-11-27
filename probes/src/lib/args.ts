/** The value after `--<flag>` in argv. Throws when the flag or its value is missing. */
export function requireArg(argv: readonly string[], flag: string): string {
  const at = argv.indexOf(`--${flag}`);
  const value = at >= 0 ? argv[at + 1] : undefined;
  if (value === undefined || value.startsWith('--')) throw new Error(`Missing required argument --${flag}`);
  return value;
}
