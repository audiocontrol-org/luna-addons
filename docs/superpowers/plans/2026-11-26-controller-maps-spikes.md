# Controller Maps: Skeleton and Spikes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the luna-addons repo skeleton and run the live investigations the design
leaves open, ending in a findings document that the product build is planned from.

**Architecture:** An npm-workspaces monorepo. The LUNA Builder SDK is a git submodule pinned to
a release tag. `add-ons/controller-maps` is a TypeScript Add On scaffolded from the SDK's
`add-on-typescript` template. `probes/` is a workspace of Node scripts run with `tsx` that
connect to the running LUNA (`ws://localhost:4718`) from outside it, the same way the SDK's
own `examples/check-*.mjs` do. Each probe answers one open question and writes a JSON result.
Probe code is investigation code: small pure helpers get unit tests, and the interactive
scripts are checked by running them against LUNA.

**Tech Stack:** TypeScript 5.9, Node 22, npm workspaces, tsx, Vite 8, Vitest 5,
`@uaudio/luna-builder-sdk` v3.1.2-u1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-26-controller-maps-design.md`

**Branch:** do the work on `feature/skeleton-and-spikes`, pushed after every commit. The one
exception is Task 3, below. Open a PR to `main` when Task 9 is done; Task 10's findings go on
their own branch.

**Scope:** the repo skeleton (Tasks 1-3), the probe harness (Task 4), the investigations
(Tasks 5-8), the first live spike (Task 9) and the findings handoff (Task 10). The map-contract
changes in audiocontrol and the product Add On are planned afterwards, from Task 10's
findings.

## Global Constraints

- macOS only; nothing is written to keep a Windows path open.
- LUNA 3.1.2 or later on the development Mac (it has 2.0.5 now; Orion updates it before
  Task 5). Node.js 22 or later.
- SDK: `uaudio-labs/luna-builder-sdk` at tag `v3.1.2-u1`, as a submodule at
  `vendor/luna-builder-sdk`.
- TypeScript: `@/` imports for the project's own modules; no `any`, no `as` casts, no `!`
  non-null assertions, no `@ts-ignore`; composition and interfaces, no class inheritance;
  files under 500 lines.
- No fallbacks or mock data outside tests. A missing input (no session, no device, no
  descriptor) throws an error naming what is missing. Probes never pick a default device or
  path.
- Use `tsx`, never `ts-node`.
- No git hooks. Commit after every task and push. No AI or Claude attribution in commit
  messages or PRs.
- Shell: never put `#` inside heredocs or multi-line quoted arguments; write the file with the
  Write tool and pass its path (`git commit -F <file>`). Never use `sed` to write files.
- Raw probe output can hold session names and installed-plugin lists, and this is a public
  repo. Raw results go to `probes/results/` (gitignored). Only the curated findings document
  (Task 10) is committed.
- Add On names carry no other company's brand or product name ("Novation", "Launch
  Control", plugin names).
- Sub-agents: pass all of the above on, write work to disk with the Write tool, and never
  write auto-memory files.

## Review Focus

1. **The controller is absent or named differently than expected.** Expected: a probe that
   needs a device stops and lists the MIDI device names LUNA reports, never picks one.
   Pinned in Task 4 (`findDevice` tests).
2. **No session is open in LUNA, or LUNA is older than 3.1.2.** Expected: the probe stops with
   a sentence saying which. Pinned in Task 4 (`requireSession`, `requireLunaVersion` tests).
3. **The insert is empty, not loaded, or reports a `pluginError`.** Expected: the parameter
   comparison reports it as a mismatch with the reason, not a crash or an empty match.
   Pinned in Task 7 (`compareParameters` tests).
4. **A plugin has parameters that share a name.** Expected: matching by name reports the
   ambiguity instead of silently taking the first. Pinned in Task 7.
5. **The spike is killed (Ctrl-C) mid-gesture.** Expected: the open touch is released, so LUNA
   is not left holding a touch. Pinned in Task 9 (SIGINT handler, checked live).

---

### Task 1: Workspace root and pinned SDK

**Files:**
- Create: `package.json`, `.nvmrc`, `tsconfig.base.json`, `CLAUDE.md`
- Create: `.gitmodules` (via `git submodule add`)
- Modify: `.gitignore`, `README.md`

**Interfaces:**
- Produces: the root scripts `npm run sdk:build` (builds the submodule's `dist/` and CLI),
  `npm test` and `npm run typecheck` (run every workspace's own), and
  `tsconfig.base.json`, which every workspace's `tsconfig.json` extends.

- [ ] **Step 1: Add the SDK submodule pinned to the release tag**

Run: `git submodule add https://github.com/uaudio-labs/luna-builder-sdk.git vendor/luna-builder-sdk && git -C vendor/luna-builder-sdk checkout v3.1.2-u1`
Expected: `git submodule status` shows `vendor/luna-builder-sdk` at the commit tagged `v3.1.2-u1`.

- [ ] **Step 2: Write the root `package.json`**

`"private": true`, `"type": "module"`, `"engines": { "node": ">=22" }`,
`"workspaces": ["add-ons/*", "probes"]`. Scripts:
- `sdk:build`: `npm --prefix vendor/luna-builder-sdk ci`. The SDK's `prepare` script builds
  `dist/` and the `ua-builder` CLI.
- `typecheck`: `npm run typecheck --workspaces --if-present`.
- `test`: `npm test --workspaces --if-present`.

`.nvmrc` holds `22`. The SDK is not a dependency of the root.

- [ ] **Step 3: Write `tsconfig.base.json`**

Strict compiler options shared by the workspaces: `strict`, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `isolatedModules`, `skipLibCheck`, `target` and `lib`
`ES2022`, `moduleResolution` `bundler`, `noEmit`. Each workspace sets its own `baseUrl` and
`paths` (`"@/*": ["src/*"]`).

- [ ] **Step 4: Build the SDK and verify the CLI**

Run: `npm run sdk:build && node vendor/luna-builder-sdk/dist/cli.js doctor`
Expected: the install succeeds, and `doctor` prints its report. LUNA not being reachable is
acceptable at this point.

- [ ] **Step 5: Write `CLAUDE.md` and update `.gitignore` and `README.md`**

- `CLAUDE.md`: copy the Global Constraints above as the project rules, and add a line linking
  the design doc.
- `.gitignore`: add `probes/results/`.
- `README.md`: add a Development section giving the clone command
  (`git clone --recurse-submodules`) and `npm run sdk:build`.

- [ ] **Step 6: Commit and push**

```bash
git add .gitmodules vendor/luna-builder-sdk package.json .nvmrc tsconfig.base.json CLAUDE.md .gitignore README.md
git commit -m "chore: workspace root and SDK submodule at v3.1.2-u1"
git push
```

---

### Task 2: Scaffold the Controller Maps Add On

**Files:**
- Create: `add-ons/controller-maps/` (scaffolded): `manifest.json`, `index.html`,
  `package.json`, `.npmrc`, `tsconfig.json`, `vite.config.ts`, `src/main.ts`,
  `src/logic.ts`, `tests/setup.ts`, `tests/add-on.test.ts`, `vendor/luna.global.js`
- Test: `add-ons/controller-maps/tests/add-on.test.ts`

**Interfaces:**
- Consumes: `npm run sdk:build` (Task 1).
- Produces: the workspace `controller-maps`, with scripts `build`, `typecheck`, `test` and
  `pack`, where `pack` writes a `.lunaaddon`. It also produces
  `connectionStatus(client: Luna.Client): string` in `src/logic.ts`.

- [ ] **Step 1: Scaffold from the TypeScript template**

Run: `node vendor/luna-builder-sdk/dist/cli.js new controller-maps --dir add-ons --template add-on-typescript --target browser --id org.audiocontrol.controller_maps --name "Controller Maps" --manufacturer audiocontrol --categories Control`
Expected: `add-ons/controller-maps/` exists, and its `package.json` depends on
`@uaudio/luna-builder-sdk` with a `file:` path into `vendor/luna-builder-sdk`.

- [ ] **Step 2: Adjust the scaffold**

- `manifest.json`: add `"run_hidden": true`. Keep `target` set to `"browser"`.
- `package.json`: make the SDK path relative (`file:../../vendor/luna-builder-sdk`).
- `tsconfig.json`: extend `../../tsconfig.base.json`, keep `"types":
  ["@uaudio/luna-builder-sdk/global"]`, and add `baseUrl` `.` with `paths`
  `"@/*": ["src/*"]`.
- `vite.config.ts`: alias `@` to `src`.
- `src/logic.ts` and `src/main.ts`: replace the template's demo with the minimal Add On. It
  connects, and the panel shows `connectionStatus(luna)`.
- Remove every `as`, `!` and relative import the template brings in.

- [ ] **Step 3: Write the failing test**

```ts
import { connectionStatus } from '@/logic';

it('reports the focused session by name', async () => {
  const engine = new Luna.MockEngine();
  engine.addSession('abc', { name: 'Demo', tracks: ['Vocal'] });
  await engine.settled();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.sessions.ready();
  expect(connectionStatus(luna)).toBe('Connected: Demo');
});

it('says when no session is open', async () => {
  const engine = new Luna.MockEngine();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.sessions.ready();
  expect(connectionStatus(luna)).toBe('Connected: no session open');
});
```

- [ ] **Step 4: Run the test and verify it fails**

Run: `npm test -w controller-maps`
Expected: FAIL, because `connectionStatus` is not exported.

- [ ] **Step 5: Implement `connectionStatus(client: Luna.Client): string` in `src/logic.ts`**

It reads `client.sessions.current()` and that session's `name.value`.

- [ ] **Step 6: Verify the test, the type check and the pack**

Run: `npm install && npm test -w controller-maps && npm run typecheck -w controller-maps && npm run pack -w controller-maps`
Expected: the tests pass, the type check is clean, and `pack` writes
`add-ons/controller-maps/*.lunaaddon` with no manifest warnings except a missing `icon`.

- [ ] **Step 7: Commit and push**

```bash
git add add-ons/controller-maps package-lock.json
git commit -m "feat(controller-maps): scaffold the Add On from the SDK TypeScript template"
git push
```

---

### Task 3: CI

**Files:**
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: the root scripts (Task 1) and the workspace scripts (Task 2).

- [ ] **Step 1: Write the workflow**

- Trigger: `push` and `pull_request`.
- One job on `ubuntu-latest`. The unit tests use `Luna.MockEngine` and need no LUNA or
  macOS.
- Steps: checkout with `submodules: true`, `actions/setup-node` with `node-version-file:
  .nvmrc` and npm cache, `npm run sdk:build`, `npm ci`, `npm run typecheck`, `npm test`,
  `npm run pack -w controller-maps`.
- Upload `add-ons/controller-maps/*.lunaaddon` as a build artifact.

- [ ] **Step 2: Push to main and verify the run**

Orion's rule: push directly to main when testing GitHub workflows. Commit on the branch,
fast-forward `main` to it, and push both.

Run: `git add .github/workflows/ci.yml && git commit -m "ci: typecheck, test and pack on push" && git push && git checkout main && git merge --ff-only feature/skeleton-and-spikes && git push && git checkout feature/skeleton-and-spikes && gh run watch --exit-status`
Expected: the run completes green, with a `.lunaaddon` artifact attached.

---

### Task 4: Probe harness

**Files:**
- Create: `probes/package.json`, `probes/tsconfig.json`, `probes/vitest.config.ts`
- Create: `probes/src/lib/args.ts`, `probes/src/lib/connect.ts`, `probes/src/lib/devices.ts`,
  `probes/src/lib/results.ts`
- Test: `probes/tests/devices.test.ts`, `probes/tests/connect.test.ts`

**Interfaces:**
- Consumes: `@uaudio/luna-builder-sdk` (`file:../vendor/luna-builder-sdk`), imported as
  `import { Luna } from '@uaudio/luna-builder-sdk'`.
- Produces:
  - `requireArg(argv: readonly string[], flag: string): string`: throws
    `Missing required argument --<flag>` when the flag is absent.
  - `requireLunaVersion(version: string, minimum: string): void`: compares dotted versions
    numerically. Throws `LUNA <version> is older than <minimum>; update LUNA` when it is
    older.
  - `requireSession(client: Luna.Client): Promise<Luna.Session>`: throws `No session is open
    in LUNA; open a disposable session first` when there is none. Otherwise resolves once
    `session.ready()` does.
  - `findDevice(devices: readonly Luna.MidiDevice[], name: string): Luna.MidiDevice`: exact
    match on `name.value` among `isPhysical` devices. Throws `No MIDI device named "<name>";
    LUNA sees: <comma-separated names>`. When the match is not exact, it never matches on
    part of a name or picks a first device.
  - `connectLive(): Promise<Luna.Client>`: calls `Luna.connect()` (LUNA on localhost) and
    then `requireLunaVersion` with the minimum `3.1.2`.
  - `writeResult(probe: string, data: unknown): Promise<string>`: writes
    `probes/results/<probe>-<ISO timestamp>.json` and returns the path.

- [ ] **Step 1: Write the failing tests**

```ts
it('names the missing device and lists what LUNA sees', async () => {
  const devices = await mockDevices(['Launch Control XL 3 DAW Out', 'IAC Bus 1']);
  expect(() => findDevice(devices, 'LCXL3 1 MIDI')).toThrow(
    'No MIDI device named "LCXL3 1 MIDI"; LUNA sees: Launch Control XL 3 DAW Out, IAC Bus 1',
  );
});
it('never matches a partial name', async () => {
  const devices = await mockDevices(['Launch Control XL 3 MIDI']);
  expect(() => findDevice(devices, 'Launch Control')).toThrow();
});
it('refuses LUNA older than 3.1.2', () => {
  expect(() => requireLunaVersion('2.0.5', '3.1.2')).toThrow('LUNA 2.0.5 is older than 3.1.2; update LUNA');
  expect(() => requireLunaVersion('3.1.10', '3.1.2')).not.toThrow();
});
it('refuses when no session is open', async () => {
  const engine = new Luna.MockEngine();
  const luna = await Luna.connect({ port_: engine.port() });
  await luna.sessions.ready();
  await expect(requireSession(luna)).rejects.toThrow('No session is open in LUNA');
});
```

The test helper `mockDevices(names: string[]): Promise<readonly Luna.MidiDevice[]>` builds
real devices rather than casting plain objects. It calls `engine.addMidiDevice(name)` on a
`Luna.MockEngine` for each name, connects, runs `await luna.midiDevices.load()`, and returns
`luna.midiDevices.items`. The mock adds LUNA's
`All` and `None` pseudo-devices, so the expected list in the first test is only the physical
names.

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -w probes`
Expected: FAIL, because the modules don't exist yet.

- [ ] **Step 3: Implement the four modules with the signatures above**

Use `tsx` to run the probe scripts (`"probe": "tsx"` in `probes/package.json`). `tsx`
resolves the `@/` paths in `tsconfig.json`.

- [ ] **Step 4: Run the tests and the type check, and verify they pass**

Run: `npm test -w probes && npm run typecheck -w probes`
Expected: PASS.

- [ ] **Step 5: Commit and push**

```bash
git add probes package.json package-lock.json
git commit -m "feat(probes): harness for live LUNA probes"
git push
```

---

### Task 5: Environment probe

Needs LUNA 3.1.2 or later running on the development Mac, with a disposable session open and
the LCXL3 connected. Orion runs it, or the agent runs it while Orion watches.

**Files:**
- Create: `probes/src/environment.ts`

**Interfaces:**
- Consumes: `connectLive`, `requireSession`, `writeResult` (Task 4).
- Produces: the exact LCXL3 device names, which Tasks 6 and 9 take as `--device` and
  `--daw-device`.

- [ ] **Step 1: Write `probes/src/environment.ts`**

It records:
- the LUNA version (`luna.engine`);
- `luna.gui.available()`;
- every `luna.midiDevices` entry after `load()`, with `name`, `midiDeviceType`,
  `isPhysical`, and whether it has an `inputPort` and an `outputPort`;
- the session's tracks, each with its `effects` (`insertType`, `pluginId`, `pluginName`,
  `loaded`, `pluginError`);
- `luna.gui.pluginWindows.value` after `watchPluginWindows()`.

It writes all of this with `writeResult('environment', ...)` and prints the device names.

- [ ] **Step 2: Run it against LUNA**

Run: `npm run probe -w probes -- src/environment.ts`
Expected: a result file path. The devices include the LCXL3's ports, and LUNA can see at
least one. If it can't see any, that's the finding for open question 2: stop and record it
for Task 10.

- [ ] **Step 3: Commit and push**

```bash
git add probes/src/environment.ts
git commit -m "feat(probes): environment probe"
git push
```

---

### Task 6: LCXL3 ports, modes and feedback probe

Answers open questions 2 (ports and mode) and 5 (page switching), and gives evidence for 6
(coexisting with the bridge). The Rust bridge must not be running during this probe.

**Files:**
- Create: `probes/src/lcxl3-protocol.ts`, `probes/src/lcxl3-io.ts`
- Test: `probes/tests/lcxl3-protocol.test.ts`

**Interfaces:**
- Consumes: `connectLive`, `findDevice`, `requireArg`, `writeResult` (Task 4).
- Produces: pure helpers in `lcxl3-protocol.ts`:
  - `DAW_MODE_ON: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x7f, 0xf7]`
  - `DAW_MODE_OFF: readonly number[] = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x15, 0x02, 0x00, 0xf7]`
  - `decodeModeReport(message: { channel: number; data1: number; data2: number }): Lcxl3Mode | null`.
    A mode report is channel index 6 (status `0xB6`) with CC `0x1E`. Value `0x01` is
    `{ kind: 'daw-mixer' }`, `0x02` is `{ kind: 'daw-control' }`, `0x06`-`0x09` are
    `{ kind: 'custom', slot: 1..4 }`, and `0x12`-`0x1D` are `{ kind: 'custom', slot: 5..16 }`.
    Anything else is `null`.

  Source: audiocontrol `docs/1.0/001-IN-PROGRESS/midi-macro-bridge/research/lcxl3-novation-daw-mode.md`.

- [ ] **Step 1: Write the failing tests**

```ts
it('decodes custom-mode reports', () => {
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x06 })).toEqual({ kind: 'custom', slot: 1 });
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x12 })).toEqual({ kind: 'custom', slot: 5 });
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x1d })).toEqual({ kind: 'custom', slot: 16 });
});
it('decodes DAW modes', () => {
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x01 })).toEqual({ kind: 'daw-mixer' });
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x02 })).toEqual({ kind: 'daw-control' });
});
it('ignores everything else', () => {
  expect(decodeModeReport({ channel: 6, data1: 0x1e, data2: 0x0a })).toBeNull();
  expect(decodeModeReport({ channel: 0, data1: 0x1e, data2: 0x06 })).toBeNull();
  expect(decodeModeReport({ channel: 6, data1: 0x1f, data2: 0x06 })).toBeNull();
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -w probes -- lcxl3-protocol`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Implement `lcxl3-protocol.ts`, then run the tests and verify they pass**

Run: `npm test -w probes -- lcxl3-protocol`
Expected: PASS.

- [ ] **Step 4: Write `lcxl3-io.ts`**

It takes `--device <name>` (the custom-mode MIDI port) and `--daw-device <name>` (the DAW
port), both required, and runs four phases. The operator presses Enter between phases.

1. **Standalone custom mode.** Listen on `--device` with `new Luna.MidiInput(luna)`,
   `listen(device, handler, { sysex: true })`. The operator turns knobs, moves faders,
   presses buttons, and switches custom modes and pages on the device. Record each message's
   `type`, `channel`, `data1`, `data2` and `port`.
2. **LED feedback in custom mode.** Send `sendControllerToOutput` to `--device` for one
   button CC with two colour values. The operator says whether the LED changed.
3. **DAW mode.** Send `DAW_MODE_ON` with `sendSysExToOutput` to `--daw-device`. Listen on
   both ports while the operator switches custom modes. Record the `decodeModeReport`
   results. Then send `B6 1E 06` (select custom mode 1) and record whether the device
   follows.
4. **Leave DAW mode.** Always send `DAW_MODE_OFF` in a `finally`, including on SIGINT.

Write everything with `writeResult('lcxl3-io', ...)`.

- [ ] **Step 5: Run it against LUNA and the LCXL3**

Run: `npm run probe -w probes -- src/lcxl3-io.ts --device "<name from Task 5>" --daw-device "<name from Task 5>"`
Expected: a result file that answers, from the data:
- whether custom-mode CCs arrive;
- whether page or mode changes are visible in standalone mode;
- whether DAW mode reports them;
- whether the device follows a host-selected mode;
- whether LED writes work.

After the run, the device is out of DAW mode.

- [ ] **Step 6: Commit and push**

```bash
git add probes/src/lcxl3-protocol.ts probes/src/lcxl3-io.ts probes/tests/lcxl3-protocol.test.ts
git commit -m "feat(probes): LCXL3 ports, modes and feedback probe"
git push
```

---

### Task 7: Parameter identity probe

Answers open questions 3 (parameter identity) and 4 (plugin identity). Needs a session with the
mapped plugins inserted: CHANNEV, the synths that are installed, and one UAD plugin.

**Files:**
- Create: `probes/src/lib/compare.ts`, `probes/src/parameters.ts`
- Test: `probes/tests/compare.test.ts`

**Interfaces:**
- Consumes: `connectLive`, `requireSession`, `requireArg`, `writeResult` (Task 4).
- Produces: in `compare.ts`:
  - `interface LunaParam { position: number; name: string }`, where `position` is the index
    in `slot.params`.
  - `interface DescriptorParam { index: number; name: string }`, from the
    `PluginDescriptor.parameters` entries in audiocontrol `plugin-descriptors/*.json`.
  - `compareParameters(descriptor: readonly DescriptorParam[], luna: readonly LunaParam[]): ParameterComparison`,
    where `ParameterComparison` is
    `{ indexAndNameMatch: number[]; nameMatchIndexDiffers: Array<{ name: string; descriptorIndex: number; lunaPosition: number }>; ambiguousNames: string[]; missingInLuna: string[]; extraInLuna: string[] }`.
    Names are compared after trimming. Case is kept.

- [ ] **Step 1: Write the failing tests**

```ts
it('matches by index and name', () => {
  const r = compareParameters([{ index: 0, name: 'Bypass' }, { index: 1, name: 'Gain' }],
    [{ position: 0, name: 'Bypass' }, { position: 1, name: 'Gain' }]);
  expect(r.indexAndNameMatch).toEqual([0, 1]);
});
it('reports a name found at another position', () => {
  const r = compareParameters([{ index: 5, name: 'Gain' }], [{ position: 2, name: 'Gain' }]);
  expect(r.nameMatchIndexDiffers).toEqual([{ name: 'Gain', descriptorIndex: 5, lunaPosition: 2 }]);
});
it('reports duplicate names instead of picking one', () => {
  const r = compareParameters([{ index: 3, name: 'Freq' }],
    [{ position: 3, name: 'Freq' }, { position: 9, name: 'Freq' }]);
  expect(r.ambiguousNames).toEqual(['Freq']);
  expect(r.indexAndNameMatch).toEqual([]);
});
it('reports an empty LUNA parameter list as all missing', () => {
  const r = compareParameters([{ index: 0, name: 'Gain' }], []);
  expect(r.missingInLuna).toEqual(['Gain']);
});
```

- [ ] **Step 2: Run the tests and verify they fail**

Run: `npm test -w probes -- compare`
Expected: FAIL, because the module doesn't exist yet.

- [ ] **Step 3: Implement `compareParameters`, then run the tests and verify they pass**

Run: `npm test -w probes -- compare`
Expected: PASS.

- [ ] **Step 4: Write `parameters.ts`**

It takes `--descriptors <dir>` (required: the path to audiocontrol's
`modules/canonical-midi-maps/plugin-descriptors`). For every insert in the session it records:
- `pluginId`, `pluginName`, `loaded` and `pluginError`;
- `slot.params`, as name, `display`, `automatable` and position.

An insert that isn't loaded, or that reports a `pluginError`, is recorded with that reason and
never compared. For each insert it looks for a descriptor whose `plugin.name` matches
`pluginName` exactly. With one, it records `compareParameters`. Without one, it records "no
descriptor". The descriptor is never guessed. Write everything with
`writeResult('parameters', ...)`.

- [ ] **Step 5: Run it against LUNA**

Run: `npm run probe -w probes -- src/parameters.ts --descriptors ~/work/audiocontrol-work/audiocontrol/modules/canonical-midi-maps/plugin-descriptors`
Expected: a result file showing, for each plugin and format, whether the descriptor indexes
and names match LUNA's parameter list, and the exact `pluginId` strings LUNA uses for each
format.

- [ ] **Step 6: Commit and push**

```bash
git add probes/src/lib/compare.ts probes/src/parameters.ts probes/tests/compare.test.ts
git commit -m "feat(probes): parameter identity probe"
git push
```

---

### Task 8: Targeting signals probe

Answers open question 1 (plugin targeting) with a timeline of what LUNA reports.

**Files:**
- Create: `probes/src/targeting.ts`

**Interfaces:**
- Consumes: `connectLive`, `requireSession`, `writeResult` (Task 4).

- [ ] **Step 1: Write `targeting.ts`**

It subscribes to `session.focusedTrack.onChange` and, after `luna.gui.watchPluginWindows()`,
to `luna.gui.pluginWindows.onChange`, and to each track's `effects` collection changes. Each
event is appended to a timeline as `{ t: ms since start, signal, value }`. It prints the
scenario steps one at a time and stamps the step into the timeline when the operator presses
Enter.

The scenario steps are these. Each one maps to a targeting release gate:
1. Select track A.
2. Open an insert editor on track A.
3. Select track B without closing A's editor.
4. Open an insert editor on track B.
5. Insert the same plugin twice on track B, then open the second one.
6. Replace the plugin in one of track B's slots with another plugin.
7. Delete an insert whose editor is open.
8. Close all editors.

At the end it writes everything with `writeResult('targeting', ...)`.

- [ ] **Step 2: Run it against LUNA**

Run: `npm run probe -w probes -- src/targeting.ts`
Expected: a timeline showing, at each step, which signals moved and how soon. It shows:
- whether `pluginWindows` order shows the newest window;
- what a replaced or deleted insert does to the window list;
- whether duplicates are distinguishable by slot.

- [ ] **Step 3: Commit and push**

```bash
git add probes/src/targeting.ts
git commit -m "feat(probes): targeting signals probe"
git push
```

---

### Task 9: First live spike: one control, one explicitly chosen insert

This is the design's first live step. It's throwaway code that proves the touch path end to
end before anything is built on it. Use a disposable session.

**Files:**
- Create: `probes/src/spike-write.ts`

**Interfaces:**
- Consumes: `connectLive`, `requireSession`, `findDevice`, `requireArg`, `writeResult`
  (Task 4). Device names come from Task 5.

- [ ] **Step 1: Write `spike-write.ts`**

Required arguments:
- `--device <name>`;
- `--track <name>` (exact);
- `--slot <insertType>`, for example `effect_0`;
- `--cc <number>` and `--param <name>`: one LCXL3 control and the parameter it drives, found
  by exact name in `slot.params`, refused if missing or ambiguous;
- `--cc2 <number>` and `--param2 <name>`: a second control and parameter on the same slot,
  for the mid-gesture switch.

How it behaves:
- On each CC value `v`, it opens a gesture with `control.begin()` if none is open, writes
  `control.normalized.set(v / 127)`, and closes it with `control.end()` after 250 ms of no
  messages.
- A message for the other CC first ends any open gesture on the previous parameter.
- A SIGINT handler ends any open gesture, then exits.
- It logs every begin, write and end, with timestamps, and writes the log with
  `writeResult('spike-write', ...)`.

- [ ] **Step 2: Run the checks against LUNA and record each result in the result file**

Run: `npm run probe -w probes -- src/spike-write.ts --device "<name>" --track "<name>" --slot effect_0 --cc 13 --param "<name>" --cc2 14 --param2 "<name>"`

Check each of these in LUNA:
1. One knob turn moves the parameter, and LUNA's undo history gains exactly one entry for
   it.
2. With the track's automation in a writing mode and playback running, a turn records
   automation.
3. Turning knob 1 and then, within 250 ms, knob 2 leaves knob 1's parameter released: its
   touch ends and nothing jumps.
4. Ctrl-C during a turn leaves no touch held. A later edit in LUNA's own UI behaves
   normally.

- [ ] **Step 3: Commit and push**

```bash
git add probes/src/spike-write.ts
git commit -m "spike: one-control touch path against live LUNA"
git push
```

---

### Task 10: Findings and handoff

**Files:**
- Create: `docs/spikes/2026-11-26-controller-maps-findings.md`
- Modify: `docs/superpowers/specs/2026-11-26-controller-maps-design.md` (Open questions)

- [ ] **Step 1: Write the findings document**

Write one section per open question in the design (1-8). Each section gives:
- what was measured, taken from the result files;
- the answer, or "still open", with the reason;
- the decision it suggests.

Keep the evidence curated. Leave out session names, user file paths and any personal data
from the raw results. Then add a section listing each release gate (1-6) with what the
spikes showed toward it.

- [ ] **Step 2: Update the design's Open questions**

Mark each answered question with a link to its findings section, and add any new question the
spikes raised.

- [ ] **Step 3: Commit, push and open a review PR**

```bash
git checkout main && git pull && git checkout -b docs/spike-findings
git add docs/spikes docs/superpowers/specs/2026-11-26-controller-maps-design.md
git commit -m "docs: controller maps spike findings"
git push -u origin docs/spike-findings
gh pr create --title "Controller Maps: spike findings" --body-file <a file written with the Write tool>
```

Expected: a PR for review. Once it merges, the next plan covers the map-contract changes in
audiocontrol and the product Add On.
