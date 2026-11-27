# luna-addons: project rules

Open-source LUNA Add Ons from audiocontrol. Design:
[docs/superpowers/specs/2026-11-26-controller-maps-design.md](docs/superpowers/specs/2026-11-26-controller-maps-design.md).

## Platform and versions

- macOS only. Nothing is written to keep a Windows path open.
- LUNA 3.1.2 or later. Node.js 22 or later.
- The LUNA Builder SDK is a submodule at `vendor/luna-builder-sdk`, pinned to a release tag
  (currently `v3.1.2-u1`). Build it with `npm run sdk:build`. Do not copy UA's SDK docs into
  this repo; link to them.

## Code

- TypeScript with `@/` imports for the project's own modules.
- No `any`, no `as` casts, no `!` non-null assertions, no `@ts-ignore`.
- Composition and interfaces, constructor injection; no class inheritance.
- Files under 500 lines.
- No fallbacks or mock data outside tests. A missing input (no session, no device, no
  descriptor) throws an error naming what is missing. Probes never pick a default device or
  path.
- Use `tsx`, never `ts-node`.

## Git

- No git hooks.
- Commit each logical unit as soon as it is coherent, and push.
- No AI or Claude attribution in commit messages or pull requests.
- Push directly to main when testing GitHub workflows.

## Shell

- Never put `#` inside heredocs or multi-line quoted arguments; write the file with the Write
  tool and pass its path (`git commit -F <file>`, `--body-file <file>`).
- Never use `sed` to write files.
- Prefer a script file over a complex one-liner.

## Data and naming

- Raw probe output can hold session names and installed-plugin lists; it goes to
  `probes/results/` (gitignored). Only curated findings are committed.
- Add On names carry no other company's brand or product name ("Novation", "Launch
  Control", plugin names); those go in descriptions only.

## Agents

Pass these rules on to sub-agents. Agents write their work to disk with the Write tool and
never write auto-memory files.
