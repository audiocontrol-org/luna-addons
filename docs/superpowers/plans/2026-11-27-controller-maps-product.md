# Controller Maps Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Controller Maps Add On that drives the parameters of a chosen LUNA insert from an
LCXL3 in DAW mode. The maps are designed ahead of time in audiocontrol's map library,
bundled at build time, and paged from the controller.

**Architecture:** Two phases. **Phase A** (audiocontrol) adds map contract 2: maps name
surface controls (not MIDI addresses), carry LUNA plugin ids and parameter id plus name, and
hold pages. A surface profile gives each control's DAW-mode address. **Phase B**
(luna-addons) compiles those maps into a bundle keyed by LUNA plugin id. It also builds:

- an LCXL3 DAW-mode driver;
- a resolver;
- a parameter writer with touch, fader pickup and encoder value push;
- explicit targeting;
- transport;
- a panel.

These are wired together in one app object.

**Tech Stack:**

- TypeScript and the LUNA Builder SDK `v3.1.2-u1` (`Luna.MockEngine` for tests);
- Vite (IIFE build);
- vitest;
- tsx for build scripts;
- zod and yaml, through audiocontrol's own schema.

**Spec:** `docs/superpowers/specs/2026-11-26-controller-maps-design.md`. Read it together
with `docs/spikes/2026-11-26-controller-maps-findings.md`, including its "LCXL3 in DAW mode"
section (PR #5) and the DAW-mode decision (PR #4). Merge #4 and #5 before executing.

## Global Constraints

- macOS only. LUNA 3.1.2 or later; Node.js 22 or later.
- TypeScript with `@/` imports for the project's own modules. No `any`, no `as` casts, no `!`
  non-null assertions, no `@ts-ignore`. Composition and interfaces, constructor injection.
- Files under 500 lines.
- No fallbacks or mock data outside tests. A missing input (no device, no target, no map, a
  name mismatch) throws, or puts a stated reason in the panel; nothing picks a default.
- No git hooks in luna-addons. In audiocontrol, its existing gates run as they are and are
  never bypassed (`--no-verify` is forbidden).
- No AI or Claude attribution in commits or PRs. Commit each logical unit and push.
- Never put `#` inside heredocs or multi-line quoted arguments (use the Write tool and `-F`);
  never write files with `sed`; prefer a script file over a complex one-liner.
- Add On names carry no other company's brand or product name.
- The Add On reads nothing from the network at run time: no manifest `network` entry.
- The map contract is versioned, and the build refuses a contract it doesn't support.
- CI pins the audiocontrol revision the bundle is built from.

## Decisions this plan makes (the designer's calls, Orion may override)

- **Contract 2 names controls.** Maps use surface control ids (`encoder_1_1`); the
  surface profile holds the DAW-mode address for each. So the CC map lives once, in
  audiocontrol.
- **Contract 2 files are recognised by a top-level `contract: 2`.** Files without `contract`
  are contract-1 maps and are not LUNA maps. Any other `contract` value fails the build.
- **Contract 2 covers what the LCXL3 needs now:** CC addresses and absolute controls.
  Encoders are kept in step by value push, not relative mode. Note addresses, relative
  encoders and value ranges are added when a controller needs them, under a new contract
  number.
- **Play and Record are always transport:** `session.transport.toggle()` and
  `toggleRecord()`. Maps can't assign them.
- **A page that doesn't match LUNA is refused whole.** Any assignment whose parameter id is
  missing, or whose name differs from LUNA's, makes the panel list the mismatches, and no
  control on that page writes.
- **Targeting is explicit in this plan.** Track and slot are chosen in the panel, then
  re-checked on every `pluginId` change. The automatic rule (newest window on the focused
  track) comes in a later plan, after its live test.
- **Device names are fixed constants:** the driver listens on `LCXL3 1 DAW Out` and sends to
  `LCXL3 1 DAW In`. If either is missing, the driver is `disconnected` with LUNA's device
  list; it never picks another device.

## Review Focus

1. **The controller is unplugged or power-cycled mid-gesture.** The open touch is released,
   writes stop, and on return the driver claims DAW mode again and accepts no event before
   the mode echo. Pinned in Task 5 and Task 9.
2. **A parameter changes in LUNA (mouse, automation, undo) while assigned.** The encoder is
   pushed the new value, and fader pickup re-arms against it, so nothing jumps. Pinned in
   Task 6.
3. **The target slot's plugin is replaced.** With a map, bindings are rebuilt and values
   pushed. Without one, the panel says "no map" and nothing writes. Pinned in Task 7 and
   Task 9.
4. **The page changes mid-gesture.** The old touch is released on its own parameter and
   events queued for the old page are dropped. Pinned in Task 6 and Task 9.
5. **Two maps claim the same LUNA plugin id.** The build fails naming both files. Pinned in
   Task 3.

---

## Phase A: map contract 2 in audiocontrol

Work in `~/work/audiocontrol-work`, following its `AGENTS.md`:

- the feature slug is `luna-controller-maps`;
- the worktree is `~/work/audiocontrol-work/audiocontrol-luna-controller-maps` on
  `feature/luna-controller-maps`;
- feature docs go in `docs/1.0/luna-controller-maps/` (`prd.md`, `workplan.md`,
  `README.md`), and the workplan links this plan on GitHub;
- run its tests with `pnpm --filter @audiocontrol/canonical-midi-maps test`.

### Task 1: Contract 2 types, schema and parser

**Files:**
- Create: `modules/canonical-midi-maps/src/types/contract-2.ts`,
  `modules/canonical-midi-maps/src/validators/contract-2-schema.ts`,
  `modules/canonical-midi-maps/src/parsers/contract-2-parser.ts`
- Modify: `modules/canonical-midi-maps/src/index.ts` (export the three)
- Test: `modules/canonical-midi-maps/src/contract-2.test.ts`
- Create: `docs/1.0/luna-controller-maps/{prd,workplan,README}.md`

**Interfaces:**
- Produces (exact names):

```ts
export const SUPPORTED_CONTRACT = 2;
export type SurfaceControlKind = 'encoder' | 'fader' | 'button';
export interface SurfaceControl { id: string; kind: SurfaceControlKind; address: { channel: number; cc: number } } // channel 1-16
export interface SurfaceProfile { contract: 2; surface: string; device: { manufacturer: string; model: string }; controls: SurfaceControl[] }
export interface Assignment { control: string; parameter: { id: string; name: string }; mode?: 'toggle' | 'momentary' }
export interface MapPage { name: string; assignments: Assignment[] }
export interface ControllerMap {
  contract: 2; version: string; surface: string;
  metadata: { name: string; description?: string; author?: string };
  plugin: { manufacturer: string; name: string; luna_plugin_ids: string[] };
  navigation: { next_page: string; previous_page?: string };
  pages: MapPage[];
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export function parseSurfaceProfile(yaml: string): ParseResult<SurfaceProfile>;
export function parseControllerMap(yaml: string, surface: SurfaceProfile): ParseResult<ControllerMap>;
export function contractOf(yaml: string): number | undefined; // the top-level `contract`, or undefined
```

- [ ] **Step 1: Write the feature docs and the GitHub issue.** The PRD states the contract
  above and why: DAW mode fixes addresses, so maps name controls. Create the issue with
  `gh issue create --body-file`.
- [ ] **Step 2: Write the failing tests** in `contract-2.test.ts`:
  - `parseControllerMap rejects a control id the surface does not define`: errors contain
    `pages[0].assignments[0].control: "encoder_9_9" is not a control of surface "lcxl3-daw"`.
  - `rejects a navigation control that is not a button`.
  - `rejects two assignments to one control on a page`.
  - `rejects mode on a non-button assignment`.
  - `rejects an empty luna_plugin_ids`.
  - `rejects contract 3`: errors contain `contract 3 is not supported (supported: 2)`.
  - `accepts a two-page map` and returns `pages[1].assignments[0].parameter.id`.
  - `contractOf` returns `2`, `undefined` for a contract-1 map, and `3`.
- [ ] **Step 3: Run them.** `pnpm --filter @audiocontrol/canonical-midi-maps test`.
  Expected: FAIL, the modules don't exist.
- [ ] **Step 4: Implement** the zod schemas and the parsers. Cross-field checks (control
  exists, kind fits, no duplicates) go in a `superRefine` that takes the surface.
- [ ] **Step 5: Run the tests.** Expected: PASS, and the module's existing tests still pass.
- [ ] **Step 6: Commit and push** (`feat(canonical-midi-maps): map contract 2`).

### Task 2: LCXL3 DAW surface profile and a starter map

**Files:**
- Create: `modules/canonical-midi-maps/maps/novation-launch-control-xl-3/daw/surface.yaml`,
  `modules/canonical-midi-maps/maps/novation-launch-control-xl-3/daw/ua-api-vision.yaml`
- Test: `modules/canonical-midi-maps/src/contract-2-maps.test.ts`

**Interfaces:**
- Consumes: Task 1's parsers.
- Produces: the surface id `lcxl3-daw` with these control ids and addresses (from
  `docs/1.0/001-IN-PROGRESS/midi-macro-bridge/research/lcxl3-cc-map.md`, confirmed live in the
  luna-addons findings):
  - `encoder_<row>_<col>`, rows 1-3 and columns 1-8: channel 16, CC `13 + (row-1)*8 + (col-1)`;
  - `fader_<n>`, 1-8: channel 16, CC `4 + n`;
  - `button_top_<n>`: channel 1, CC `36 + n`;
  - `button_bottom_<n>`: channel 1, CC `44 + n`;
  - `button_side`: channel 1, CC 104;
  - `play`: channel 1, CC 116;
  - `record`: channel 1, CC 118.

- [ ] **Step 1: Write the failing test.** Every YAML with `contract: 2` under `maps/` parses
  against its surface. `surface.yaml` has 24 encoders, 8 faders, 17 buttons and the two
  transport buttons, 51 controls in all. The API Vision map has `luna_plugin_ids:
  [uaudio_api_vision_ext]` and `navigation.next_page: button_side`.
- [ ] **Step 2: Run it.** Expected: FAIL, the files don't exist.
- [ ] **Step 3: Write `surface.yaml` and a starter `ua-api-vision.yaml`.** It has one page
  ("Channel") using only parameter ids LUNA reported live:
  - encoder row 1: `550_hf_freq`, `550_hf_gain`, `550_hmf_freq`, `550_hmf_gain`,
    `550_lmf_freq`, `550_lmf_gain`, `550_lf_freq`, `550_lf_gain`;
  - encoder row 2: `235_thresh`, `235_depth`, `235_attack`, `235_release`, `225_thresh`,
    `225_ratio`, `225_attack`, `225_release`;
  - `fader_1`: `line_gain`; `fader_8`: `level`;
  - `button_top_1`: `pad`, toggle; `button_top_2`: `phase`, toggle.

  Each parameter's `name` is LUNA's (for example `550 HF Freq`, `Line Gain`). The layout is
  a starter for the layout editor to replace; say so in the map's description.
- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit, push, and open a PR** to audiocontrol `main` with `--body-file`.
  Record the merge commit SHA; Phase B pins it.

## Phase B: the Add On in luna-addons

Work on `feature/controller-maps-product` from `main`. Tests for each task run with
`npm test -w controller-maps`. Module paths are under `add-ons/controller-maps/`.

### Task 3: Pinned audiocontrol and the bundle compiler

**Files:**
- Create: `.gitmodules` entry `vendor/audiocontrol` (shallow, pinned to Phase A's merge SHA)
- Create: `add-ons/controller-maps/scripts/build-bundle.ts`, `src/bundle/types.ts`,
  `src/bundle/compile.ts`, `coverage.json`
- Modify: `add-ons/controller-maps/package.json`:
  - `bundle` script: `tsx scripts/build-bundle.ts`;
  - `build` runs it first;
  - devDependencies: `tsx` 4.21.0, plus `zod` and `yaml` at audiocontrol's versions.
- Modify: `tsconfig.json`: paths entry `@audiocontrol/canonical-midi-maps` →
  `../../vendor/audiocontrol/modules/canonical-midi-maps/src/index.ts`.
- Modify: `.gitignore` (`add-ons/controller-maps/src/bundle/generated.json`)
- Modify: `.github/workflows/ci.yml`: submodules recursive, and run `bundle` before typecheck.
- Test: `tests/compile.test.ts`

**Interfaces:**
- Consumes: Phase A exports.
- Produces:

```ts
// src/bundle/types.ts
export interface Bundle {
  contract: 2;
  audiocontrolRevision: string;
  surfaces: Record<string, SurfaceControl[]>;
  maps: Record<string, BundledMap>; // key: LUNA plugin id
}
export interface BundledMap { source: string; name: string; surface: string; navigation: { nextPage: string; previousPage?: string }; pages: MapPage[] }
// src/bundle/compile.ts
export interface SourceFile { path: string; text: string }
export function compileBundle(files: SourceFile[], revision: string, coverage: string[]): Bundle; // throws with every problem listed
```

- [ ] **Step 1: Write the failing tests:**
  - `compileBundle keys each map by every luna plugin id`.
  - `throws naming both files when two maps claim one plugin id`. Message:
    `uaudio_x is claimed by a.yaml and b.yaml`.
  - `throws for a contract it does not support`.
  - `ignores files without a contract field`.
  - `throws when a coverage plugin id has no map`: `coverage: no map for uaudio_y`.
  - `throws when a map names a surface no file defines`.
  - `throws when a map assigns play or record`: those are transport in this Add On.
- [ ] **Step 2: Run them.** Expected: FAIL, the module is missing.
- [ ] **Step 3: Implement `compileBundle`.** Then implement `build-bundle.ts`, which:
  1. reads every `*.yaml` under `vendor/audiocontrol/modules/canonical-midi-maps/maps/`;
  2. reads the submodule's `git rev-parse HEAD` and `coverage.json` (initially
     `["uaudio_api_vision_ext"]`);
  3. writes `src/bundle/generated.json`.
- [ ] **Step 4: Run the tests, then `npm run bundle -w controller-maps`.** Expected: PASS;
  `generated.json` holds `maps.uaudio_api_vision_ext`.
- [ ] **Step 5: Commit and push.** Push to main to test the CI change, per the repo rules.
  Expected: the CI run succeeds.

### Task 4: Resolver

**Files:**
- Create: `src/resolve.ts`
- Test: `tests/resolve.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `BundledMap`, `MapPage`.
- Produces:

```ts
export interface LunaParam { id: string; name: string }
export interface ResolvedBinding { control: string; kind: SurfaceControlKind; paramId: string; label: string; mode?: 'toggle' | 'momentary' }
export type Resolution =
  | { ok: true; map: BundledMap; pageIndex: number; pageName: string; bindings: ResolvedBinding[] }
  | { ok: false; reason: string; mismatches: string[] };
export function resolve(bundle: Bundle, pluginId: string, pageIndex: number, params: readonly LunaParam[]): Resolution;
```

- [ ] **Step 1: Write the failing tests:**
  - `no map`: reason `No map for plugin uaudio_z`.
  - `a missing id refuses the page`: mismatches contain `550_hf_gain: not reported by LUNA`.
  - `a name mismatch refuses the page`: mismatches contain
    `line_gain: map says "Line Gain", LUNA says "Line Level"`.
  - `page index wraps` (index 2 of a two-page map gives page 0).
  - `bindings carry the surface kind`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 5: LCXL3 DAW-mode driver

**Files:**
- Create: `src/driver/types.ts`, `src/driver/lcxl3.ts`, `src/driver/lcxl3-bytes.ts`
- Test: `tests/lcxl3.test.ts` (MockEngine: `addMidiDevice`, `receiveMidi`, `midiSent`)

**Interfaces:**
- Consumes: `SurfaceControl[]` for `lcxl3-daw` from the bundle.
- Produces:

```ts
export type ControlEvent = { control: string; kind: 'absolute'; value: number } | { control: string; kind: 'press' | 'release' }; // value 0..1
export type DriverStatus = { state: 'ready' } | { state: 'waiting'; reason: string } | { state: 'suspended'; reason: string } | { state: 'disconnected'; reason: string };
export interface ControllerDriver {
  start(): Promise<void>;
  stop(): Promise<void>; // turns off the LEDs it lit, then DAW mode off
  status(): DriverStatus;
  onStatus(listener: () => void): Luna.Unsubscribe;
  onEvent(listener: (event: ControlEvent) => void): Luna.Unsubscribe;
  pushValue(control: string, normalized: number): Promise<void>;
  showName(control: string, text: string): Promise<void>;
  showOverlay(text: string): Promise<void>;
  setLed(control: string, palette: number): Promise<void>;
}
export function createLcxl3Driver(luna: Luna.Client, surface: readonly SurfaceControl[]): ControllerDriver;
```

Bytes (`lcxl3-bytes.ts`):

- DAW on and off: `F0 00 20 29 02 15 02 7F F7` and `F0 00 20 29 02 15 02 00 F7`.
- Mode: channel 7 (index 6), CC 30. 1 is Mixer, 2 is Control; 6-9 and 18-29 are custom
  modes. Rows to absolute: `B6 45 00`, `B6 48 00`, `B6 49 00`.
- Encoder push: channel 16, the encoder's CC, `round(normalized*127)`.
- Name: `F0 00 20 29 02 15 04 <cc> 62 F7`, then `F0 00 20 29 02 15 06 <cc> 01 <ascii> F7`.
- Overlay: the same, with target `0x36`.
- LED: channel 1, `<cc> <palette>`.

- [ ] **Step 1: Write the failing tests:**
  - `start claims DAW mode and selects Control`: `midiSent` holds DAW on, then `B6 1E 02`,
    then the three row-absolute messages, in that order.
  - `waits for the mode echo`: before `B6 1E 02` is received, the status is `waiting` and an
    encoder CC emits nothing. After it, the status is `ready` and `BF 0D 40` emits
    `{control: 'encoder_1_1', kind: 'absolute', value: 64/127}`.
  - `a custom-mode report suspends`: receiving `B6 1E 06` gives the status
    `{state: 'suspended', reason: 'The controller is in custom mode 1; switch it to Mixer or Control'}`,
    and no events are emitted.
  - `Mixer counts as ready` (`B6 1E 01`).
  - `buttons give press and release` (`B0 25 7F`, then `B0 25 00`).
  - `missing device`: with no `LCXL3 1 DAW Out`, the status is `disconnected`, and the
    reason lists LUNA's device names.
  - `reconnect re-claims`: remove the device, then add it back (as `luna.midiDevices`
    changes). DAW on is sent again, and the status is `waiting` until the echo.
  - `pushValue`, `showName` and `setLed` send the exact bytes above.
  - `stop` sends LED 0 for every control lit, then DAW off.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Keep the byte builders in `lcxl3-bytes.ts`, and the state
  machine and device watching in `lcxl3.ts`.
- [ ] **Step 4: Run them.** Expected: PASS. **Step 5: Commit and push.**

### Task 6: Parameter writer

**Files:**
- Create: `src/writer/gestures.ts`, ported from `probes/src/lib/gesture.ts` with its tests;
  `src/writer/writer.ts`
- Test: `tests/gestures.test.ts`, `tests/writer.test.ts` (MockEngine, with a 1176 insert as
  in the SDK's own tests)

**Interfaces:**
- Consumes: `ResolvedBinding`, `ControlEvent`, and `ControllerDriver.pushValue`.
- Produces:

```ts
export interface BoundParameter { binding: ResolvedBinding; param: Luna.Control }
export interface ParameterWriter {
  assign(bound: readonly BoundParameter[]): void;
  handle(event: ControlEvent): void;
  release(why: string): void;
}
export function createParameterWriter(driver: ControllerDriver, idleMs: number, record: (event: string, detail: unknown) => void): ParameterWriter;
```

The idle timeout is 250 ms, as in the spike.

- [ ] **Step 1: Write the failing tests** (`writer.test.ts`):
  - `encoder writes inside one touch`: three absolute events make one `set_touch` bracket,
    three `normalized_value` writes, and an `end` after idle.
  - `assign pushes each encoder its parameter's value`.
  - `fader pickup`: with the parameter at 0.5, fader events 0.1 and 0.3 write nothing. Then
    0.52 writes, and later events track.
  - `assign mid-gesture releases the old touch and drops queued events`.
  - `a parameter changed in LUNA re-pushes the encoder and re-arms fader pickup`.
  - `toggle button flips once per press`, and `momentary writes 1 on press and 0 on
    release`.
  - `release ends an open touch` (the driver-disconnect path).
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Fader pickup arms on
  `assign` and on every outside change. It writes once an incoming value is within 1/127 of
  the parameter's value, or crosses it between two events. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 7: Explicit targeting

**Files:**
- Create: `src/targeting.ts`
- Test: `tests/targeting.test.ts`

**Interfaces:**
- Produces:

```ts
export type Target = { state: 'none'; reason: string } | { state: 'ready'; track: Luna.Track; slot: Luna.Effect; pluginId: string };
export interface Targeting { choose(trackId: string, slotId: string): Promise<void>; clear(): void; current(): Target; onChange(listener: () => void): Luna.Unsubscribe }
export function createTargeting(session: Luna.Session): Targeting;
```

- [ ] **Step 1: Write the failing tests:**
  - `none until chosen`: reason `Choose a track and insert in the panel`.
  - `ready with the slot's pluginId`.
  - `replacing the plugin updates pluginId and notifies`.
  - `clearing the slot gives none`: reason `The chosen insert is now empty`.
  - `deleting the track gives none`: reason `The chosen track was deleted`.
  - `an empty slot cannot be chosen`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Watch `slot.pluginId`
  (not `track.effects`, per the findings) and `session.tracks`. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 8: Transport

**Files:**
- Create: `src/transport.ts`
- Test: `tests/transport.test.ts`

**Interfaces:**
- Produces: `export function bindTransport(session: Luna.Session, driver: ControllerDriver): Luna.Unsubscribe;`

- [ ] **Step 1: Write the failing tests:**
  - A `play` press calls `transport.toggle()`; a `record` press calls `toggleRecord()`.
  - LEDs follow `transport.playing`: Play is palette `0x21` while playing and `0x27` when
    stopped. They also follow `recordEnabled`: Record is `0x05` when armed and `0x07` when
    not (the colours the bridge uses).
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 9: The app

**Files:**
- Create: `src/app.ts`
- Test: `tests/app.test.ts` (MockEngine, end to end with the bundled API Vision fixture)

**Interfaces:**
- Consumes: everything above.
- Produces:

```ts
export interface AppState { driver: DriverStatus; target: Target; resolution: Resolution | undefined }
export interface App { start(): Promise<void>; stop(): Promise<void>; state(): AppState; onChange(listener: () => void): Luna.Unsubscribe; targeting: Targeting }
export function createApp(luna: Luna.Client, session: Luna.Session, bundle: Bundle): App;
```

- [ ] **Step 1: Write the failing tests:**
  - `a knob move writes the mapped parameter`: target API Vision, then `BF 0D 50` writes
    `550_hf_freq`.
  - `next_page cycles the page and shows its name on the overlay`, releasing any open touch.
  - `the driver suspending or disconnecting releases the touch and stops writes`.
  - `a target swap to an unmapped plugin gives "No map for plugin …", and knob moves write
    nothing`.
  - `a refused page writes nothing and lists mismatches`.
  - `encoder names are shown on assign`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Bindings are rebuilt on
  any change of target, page, `pluginId` or driver readiness. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 10: Panel and entry point

**Files:**
- Create: `src/panel/model.ts`, `src/panel/render.ts`
- Modify: `src/main.ts`, `index.html`; delete `src/logic.ts` and its test once nothing uses
  them
- Test: `tests/panel-model.test.ts`

**Interfaces:**
- Produces:

```ts
export interface PanelModel { status: string; target: string; page: string; rows: Array<{ control: string; parameter: string }>; problems: string[]; choices: Array<{ trackId: string; trackName: string; slots: Array<{ slotId: string; label: string }> }> }
export function panelModel(state: AppState, session: Luna.Session): PanelModel;
```

- [ ] **Step 1: Write the failing tests.** Each `AppState` variant gives the panel text it
  should show:
  - "Controller: waiting for the controller to confirm DAW mode";
  - "No map for plugin …";
  - the mismatch list;
  - one row per binding.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement** the model, then a thin DOM
  `render` and `main.ts`:
  1. connect;
  2. require a session;
  3. load `generated.json`;
  4. `createApp`, then `start`;
  5. render on every change;
  6. call `stop` on `pagehide`.
- [ ] **Step 4: Run them**, then `npm run typecheck && npm run pack -w controller-maps`.
  Expected: PASS, and a `.lunaaddon` is built. **Step 5: Commit and push.**

### Task 11: Live acceptance and the setup document

**Files:**
- Create: `docs/controller-maps/setup.md` (the one-time setup: LUNA sees the LCXL3, the
  bridge is not running, install the Add On, open it)
- Create: `docs/spikes/2026-11-27-controller-maps-acceptance.md`

- [ ] **Step 1: Install the Add On** in LUNA (`npm run install-addon -w controller-maps`) and
  open a disposable session holding an API Vision.
- [ ] **Step 2: Walk the release gates with Orion, and record each result:**
  - **Gate 2:** the page is known before the first event; page changes work; power-cycling
    the controller re-claims DAW mode.
  - **Gate 4:** a new session needs no remapping.
  - **Gate 5:** undo is one step per turn; Touch automation records; a target change
    mid-gesture releases cleanly; encoders and faders don't jump.
  - **Gate 1, explicit:** a replace or delete stops writes with the stated reason.
  - **Gate 6:** API Vision ids and names match.
  - **Gate 3:** not run, under the assumption that the bridge isn't running.
- [ ] **Step 3: Commit, push, and open a PR** for the branch with `--body-file`.
