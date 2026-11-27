# Controller Maps Product Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Controller Maps Add On that drives the parameters of a chosen LUNA insert from an
LCXL3 in DAW mode. The maps are designed ahead of time in audiocontrol's map library,
bundled at build time, and paged from the controller.

**Architecture:** Two phases. **Phase A** (audiocontrol) adds map contract 2:
- maps name surface controls (not MIDI addresses), carry LUNA plugin ids and parameter id
  plus name, and hold pages;
- a surface profile holds every controller-specific fact: ports, control addresses, and the
  wire protocol as message templates;
- a surface layout binds the Add On's roles (paging, transport) to button presses and
  gives their feedback values.

**Phase B** (luna-addons) is split by a hard boundary, the `Surface` interface
(`src/surface/api.ts`):
- **Core** (`src/core/`): resolver, parameter writer, targeting, transport, app and panel.
  It speaks only semantic intents: a control moved, a role fired, follow this value, show
  this label. It never sees a byte, a CC number, a port name or a device.
- **Surface runtime** (`src/surface/runtime/`): the only code that touches LUNA's MIDI API.
  It is a generic interpreter of a surface definition from the bundle, and contains no
  facts about any controller.

`src/main.ts` is the one place that builds a runtime and hands it to the core as a
`Surface`. A boundary test fails the build if core reaches past the interface, or if the
runtime names a device.

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
- No git hooks in either repo. In audiocontrol, run `make gates` before every commit and
  before opening the PR, and fix whatever it reports (audiocontrol AGENTS.md §"Gates").
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
- **The semantic boundary (Orion's rule).** Add On code asks the `Surface` interface to
  turn semantic intent into wire protocol. It never decides what any wire message means.
  - **The Add On dictates only its own vocabulary:** the roles it can carry out
    (`page.next`, `page.previous`, `transport.play`, `transport.record`), the intents it
    accepts, and the requests it makes (follow, label, announce, indicate). Those make up
    the interface.
  - **Every controller-specific fact is data in audiocontrol,** authored at edit time: port
    names, control addresses, which controls follow a pushed value, the claim and release
    sequence, mode reports, label, announce and indicate message templates, and feedback
    values.
  - **Which control does what is decided in the editor:** parameters per page in the
    plugin's map, and roles in the surface's layout. A layout binding is a button press,
    optionally made while another button is held. Layout roles don't depend on the plugin,
    so transport keeps working on an unmapped insert.
  - **Enforced by `tests/boundary.test.ts`, which CI runs.** Code outside
    `src/surface/runtime/` may not import it (except `src/main.ts`), and may not use LUNA's
    MIDI API (`MidiInput`, `SendMidi`, `sendControllerToOutput`, `sendSysExToOutput`,
    `midiDevices`, `onControlChange`). No file under `src/` may contain a hex literal or a
    device or vendor name. The runtime is proven generic by driving a fictional device from
    the same code.
- **A page that doesn't match LUNA is refused whole.** Any assignment whose parameter id is
  missing, or whose name differs from LUNA's, makes the panel list the mismatches, and no
  control on that page writes.
- **Targeting is a picker in the panel, and it stays.** Track and insert are chosen in the
  panel with one click, then re-checked on every `pluginId` change. The panel always shows
  the target as track, insert and plugin together (`Vocal · effect_2 · API Vision Channel
  Strip`). The automatic rule (newest window on the focused track) comes in a later plan,
  after its live test. Even then, the picker remains the way to settle a case the rule
  refuses, such as two editors open on one track.
- **Paging is whatever the layout binds to `page.next` and `page.previous`.** The Add On only requires that a
  binding names buttons the surface profile defines. The LCXL3's Page buttons never reach
  the host in DAW mode, so the profile doesn't list them and the editor can't offer them.
  Each page change shows `<page name> <n>/<total>` on the display overlay. The panel shows
  the page, names the bindings that change it (taken from the layout), and has Previous and
  Next buttons of its own. Layout bindings, transport included, work the same on every
  page and for every plugin.
- **The Add On can hand the controller back.** The panel has Release controller, which
  calls `surface.release()` (the profile's release sequence, after clearing every
  indication), and Reclaim controller, which calls `surface.claim()`. A full handoff to the Rust bridge, with the
  bridge's transport and mixer verified afterwards, is release gate 3. It stays out of this
  plan under Orion's assumption that the two aren't used at the same time.
- **Coverage starts with the API Vision.** It has two pages: Channel, and the 560 graphic
  EQ. One third-party plugin joins `coverage.json` once Orion names one that has been stable
  in LUNA. The only third-party plugin tested so far crashed LUNA on its first write.
- **Ports are profile data.** The runtime listens and sends on the exact names in the
  profile's `ports` (`LCXL3 1 DAW Out` and `LCXL3 1 DAW In` for the LCXL3). If either is
  missing, the surface is `disconnected`, with LUNA's device list as the reason; it never
  picks another device.

## Review Focus

1. **The controller is unplugged or power-cycled mid-gesture.** The open touch is released,
   writes stop, and on return the surface claims the controller again and emits no intent
   before a ready mode report. Pinned in Task 5 and Task 9.
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
6. **A controller fact slips into Add On code** (a CC number, a palette value, a port name,
   a reserved control). The boundary test fails the build. Pinned in Task 5.

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
export interface CcAddress { channel: number; cc: number } // channel 1-16, cc 0-127
// `follows`: the device moves the control to a value sent with the profile's `follow` message.
export interface SurfaceControl { id: string; kind: SurfaceControlKind; address: CcAddress; follows?: boolean }
// A message template. In a `sysex` string, bytes are hex pairs, and these placeholders are
// filled by the runtime: {cc} and {channel} (the target control's address), {value}
// (round(normalized * 127)), {state} (a feedback value from the layout), and {text} (ASCII
// bytes). The parser rejects any other placeholder.
export type Message =
  | { sysex: string }
  | { cc: { channel: number | '{channel}'; number: number | '{cc}'; value: number | '{value}' | '{state}' } };
export interface SurfaceProtocol {
  claim: Message[];                 // sent in order when the surface is claimed
  release: Message[];               // sent in order on release, after indications are cleared
  mode?: { address: CcAddress; ready: number[]; suspended: Array<{ values: number[]; reason: string }> };
  follow?: Message;                 // keeps a `follows` control at a value
  label?: Message[];                // names one control
  announce?: Message[];             // a transient surface-wide message
  indicate?: { message: Message; off: number };
}
export interface SurfaceProfile {
  contract: 2; surface: string; kind: 'surface';
  device: { manufacturer: string; model: string };
  ports: { input: string; output: string }; // LUNA device names, matched exactly
  controls: SurfaceControl[];
  protocol: SurfaceProtocol;
}
export interface Assignment { control: string; parameter: { id: string; name: string }; mode?: 'toggle' | 'momentary' }
export interface MapPage { name: string; assignments: Assignment[] }
// A button press, optionally while another button is held (`with`). Both are surface control ids.
export interface ButtonBinding { control: string; with?: string }
// Plugin-independent role bindings for one surface, authored in the layout editor. Active
// whatever plugin is targeted, mapped or not. Role names are strings here; the consuming
// host checks them against the roles it implements.
export interface SurfaceLayout {
  contract: 2; version: string; surface: string; kind: 'layout';
  bindings: Array<{ role: string; press: ButtonBinding }>;
  feedback?: Array<{ role: string; active: number; inactive: number }>; // values for {state}
}
export interface ControllerMap {
  contract: 2; version: string; surface: string;
  metadata: { name: string; description?: string; author?: string };
  plugin: { manufacturer: string; name: string; luna_plugin_ids: string[] };
  pages: MapPage[];
}
export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };
export function parseSurfaceProfile(yaml: string): ParseResult<SurfaceProfile>;
export function parseSurfaceLayout(yaml: string, surface: SurfaceProfile): ParseResult<SurfaceLayout>;
// A page assignment may not use a control the layout binds (as `control` or `with`).
export function parseControllerMap(yaml: string, surface: SurfaceProfile, layout: SurfaceLayout): ParseResult<ControllerMap>;
export function contractOf(yaml: string): number | undefined; // the top-level `contract`, or undefined
```

- [ ] **Step 1: Write the feature docs and the GitHub issue.** The PRD states the contract
  above and why. DAW mode fixes addresses, so maps name controls. Hosts such as the LUNA
  Add On must hold no controller facts, so the profile carries the wire protocol as data. Create the issue with
  `gh issue create --body-file`.
- [ ] **Step 2: Write the failing tests** in `contract-2.test.ts`:
  - `parseControllerMap rejects a control id the surface does not define`: errors contain
    `pages[0].assignments[0].control: "encoder_9_9" is not a control of surface "lcxl3-daw"`.
  - `parseSurfaceProfile rejects an unknown placeholder`: errors contain
    `protocol.label[0].sysex: unknown placeholder {foo}`.
  - `parseSurfaceProfile rejects a sysex token that is neither a hex pair nor a
    placeholder`, `two controls with one address`, and `follow without a follow message`.
  - `parseSurfaceLayout rejects a binding, or its "with" control, that is not a button`.
  - `parseSurfaceLayout rejects two bindings that are the same press` (same control, same
    `with`), and feedback for a role with no binding.
  - `parseControllerMap rejects a page assignment to a control the layout binds`: errors
    contain `pages[1].assignments[3].control: "button_side" is bound by the layout
    (page.next)`. The same holds for a `with` control.
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
  `modules/canonical-midi-maps/maps/novation-launch-control-xl-3/daw/layout.yaml`,
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
  - `record`: channel 1, CC 118;
  - `shift`: channel 7, CC 63.

  Encoders have `follows: true`; faders and buttons don't.

  The ids name physical controls only. Roles such as transport or paging belong to the
  layout. The physical position of CC 104 isn't confirmed, so confirm which button sends it
  before naming it in the profile (`button_side` is a placeholder).

  `ports`: input `LCXL3 1 DAW Out`, output `LCXL3 1 DAW In`. `protocol`, from the
  findings' "LCXL3 in DAW mode" section:
  - `claim`: sysex `F0 00 20 29 02 15 02 7F F7` (DAW mode on); cc channel 7, number 30,
    value 2 (select Control); cc channel 7, numbers 69, 72 and 73, value 0 (rows absolute);
  - `release`: sysex `F0 00 20 29 02 15 02 00 F7`;
  - `mode`: address channel 7, CC 30. `ready: [1, 2]`. `suspended`: values 6-9 and 18-29,
    reason `The controller is in a custom mode; switch it to Mixer or Control`;
  - `follow`: cc `{channel}` `{cc}` `{value}`;
  - `label`: sysex `F0 00 20 29 02 15 04 {cc} 62 F7`, then `F0 00 20 29 02 15 06 {cc} 01
    {text} F7`;
  - `announce`: the same pair with `36` in place of `{cc}`;
  - `indicate`: cc channel 1, `{cc}`, `{state}`; `off: 0`.

- [ ] **Step 1: Write the failing test.** Every YAML with `contract: 2` under `maps/` parses
  against its surface. `surface.yaml` has 24 encoders, 8 faders, 17 buttons, the two
  transport buttons and `shift`, 52 controls in all. `layout.yaml` parses against the
  surface and binds `page.next`. The API Vision map has `luna_plugin_ids:
  [uaudio_api_vision_ext]` and two pages named `Channel` and `560 EQ`, and it parses
  against the surface and the layout.
- [ ] **Step 2: Run it.** Expected: FAIL, the files don't exist.
- [ ] **Step 3: Write `surface.yaml` and a starter `ua-api-vision.yaml`.** It has two pages,
  using only parameter ids LUNA reported live. Page 1, "Channel":
  - encoder row 1: `550_hf_freq`, `550_hf_gain`, `550_hmf_freq`, `550_hmf_gain`,
    `550_lmf_freq`, `550_lmf_gain`, `550_lf_freq`, `550_lf_gain`;
  - encoder row 2: `235_thresh`, `235_depth`, `235_attack`, `235_release`, `225_thresh`,
    `225_ratio`, `225_attack`, `225_release`;
  - `fader_1`: `line_gain`; `fader_8`: `level`;
  - `button_top_1`: `pad`, toggle; `button_top_2`: `phase`, toggle.

  Page 2, "560 EQ":
  - encoder row 1: `560_16khz`, `560_8khz`, `560_4khz`, `560_2khz`, `560_1khz`, `560_500hz`,
    `560_250hz`, `560_125hz`;
  - encoder row 2, columns 1-2: `560_63hz`, `560_31hz`;
  - `fader_1`: `line_gain`; `fader_8`: `level`, the same as page 1;
  - `button_top_1`: `eq_on`, toggle.

  Also write `layout.yaml`, as a starter for the layout editor to replace:
  - bindings: `page.next` on `{control: button_side}`; `page.previous` on
    `{control: button_side, with: shift}`; `transport.play` on `{control: play}`;
    `transport.record` on `{control: record}`;
  - feedback: `transport.play` active 33, inactive 39; `transport.record` active 5,
    inactive 7 (the palette values the bridge uses).

  The 560 bands only show in the plugin when its EQ Select is on 560. The map's
  description says so, because EQ Select is stepped and stays a mouse control.

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
  `src/bundle/compile.ts`, `src/surface/roles.ts`, `coverage.json`
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
  surfaces: Record<string, SurfaceDefinition>; // key: surface id
  maps: Record<string, BundledMap>; // key: LUNA plugin id
}
export interface SurfaceDefinition { profile: SurfaceProfile; layout: SurfaceLayout }
export interface BundledMap { source: string; name: string; surface: string; pages: MapPage[] }
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
  - `throws when a surface has no layout file, or more than one`.
  - `carries the profile and layout through unchanged`. The compiler adds no roles of its
    own, so a layout without `transport.play` gives no play.
  - `throws on a layout role the Add On does not implement`: `layout.yaml: role "mixer.solo"
    is not one of page.next, page.previous, transport.play, transport.record`. The list is
    `ROLES` in `src/surface/roles.ts`, created in this task:
    `export const ROLES: readonly Role[] = ['page.next', 'page.previous', 'transport.play', 'transport.record'];`
    together with `export type Role = 'page.next' | 'page.previous' | 'transport.play' | 'transport.record';`
    It is the Add On's semantic vocabulary, and `api.ts` re-exports it.
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
- Create: `src/core/resolve.ts`
- Test: `tests/resolve.test.ts`

**Interfaces:**
- Consumes: `Bundle`, `BundledMap`, `MapPage`.
- Produces:

```ts
export interface LunaParam { id: string; name: string }
export interface ResolvedBinding { control: string; paramId: string; label: string; mode?: 'toggle' | 'momentary' }
export type Resolution =
  | { ok: true; map: BundledMap; pageIndex: number; pageName: string; bindings: ResolvedBinding[] }
  | { ok: false; reason: string; mismatches: string[] };
export function resolve(maps: Bundle['maps'], pluginId: string, pageIndex: number, params: readonly LunaParam[]): Resolution;
```

- [ ] **Step 1: Write the failing tests:**
  - `no map`: reason `No map for plugin uaudio_z`.
  - `a missing id refuses the page`: mismatches contain `550_hf_gain: not reported by LUNA`.
  - `a name mismatch refuses the page`: mismatches contain
    `line_gain: map says "Line Gain", LUNA says "Line Level"`.
  - `page index wraps` (index 2 of a two-page map gives page 0).
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 5: The Surface interface, the generic runtime, and the boundary test

**Files:**
- Create: `src/surface/api.ts` (the interface; the only surface module core may import)
- Create: `src/surface/runtime/create.ts`, `src/surface/runtime/messages.ts` (template
  filling), `src/surface/runtime/claim.ts` (claim, mode report and reconnect state)
- Test: `tests/surface-runtime.test.ts` (MockEngine: `addMidiDevice`, `receiveMidi`,
  `midiSent`), `tests/fixtures/test-surface.ts` (a fictional device), `tests/boundary.test.ts`

**Interfaces:**
- Consumes: `Role` and `ROLES` from Task 3's `roles.ts`, and `SurfaceDefinition` (runtime
  only).
- Produces:

```ts
// src/surface/api.ts: semantic only. No addresses, bytes, ports or device names.
export type { Role } from '@/surface/roles';
export type Intent =
  | { kind: 'move'; control: string; value: number }   // a continuous control, absolute 0..1
  | { kind: 'press' | 'release'; control: string }     // a button no layout binding owns
  | { kind: 'role'; role: Role };                       // a layout binding fired
export type SurfaceStatus =
  | { state: 'ready' }
  | { state: 'claiming' | 'suspended' | 'disconnected' | 'released'; reason: string };
export interface SurfaceControlInfo { id: string; continuous: boolean; follows: boolean }
export interface Surface {
  claim(): Promise<void>;
  release(): Promise<void>; // clears every indication, then the profile's release sequence
  status(): SurfaceStatus;
  onStatus(listener: () => void): Luna.Unsubscribe;
  onIntent(listener: (intent: Intent) => void): Luna.Unsubscribe; // nothing is emitted unless ready
  controls(): readonly SurfaceControlInfo[];
  bindingText(role: Role): string | undefined; // e.g. "shift + button_side", for the panel
  follow(control: string, normalized: number): Promise<void>; // only for `follows` controls
  label(control: string, text: string): Promise<void>;
  announce(text: string): Promise<void>;
  indicate(role: Role, state: 'active' | 'inactive'): Promise<void>;
}
// src/surface/runtime/create.ts
export function createSurface(luna: Luna.Client, definition: SurfaceDefinition): Surface;
```

A request the profile has no template for (for example, `label` on a device with no
`label` messages) throws, naming the surface and the missing template. It never sends
something else instead.

- [ ] **Step 1: Write the failing runtime tests.** They run once against the bundled LCXL3
  definition, with exact bytes, and once against `test-surface.ts`. The fictional device
  has other port names, channels, CCs, claim bytes and mode values, plus a layout of its
  own. Each case passes on both with no code change:
  - `claim sends the claim sequence in order` (LCXL3: DAW on, `B6 1E 02`, then the three
    row-absolute messages).
  - `claiming until a ready mode report`: before it, an encoder CC emits nothing. After
    `B6 1E 02`, the status is `ready` and `BF 0D 40` emits
    `{kind: 'move', control: 'encoder_1_1', value: 64/127}`.
  - `a suspended mode value suspends with the profile's reason`, and emits nothing.
  - `a mode value the profile does not list suspends` with reason `Unrecognised mode report
    12 from lcxl3-daw`.
  - `a button no layout binding owns gives press and release`.
  - `a layout binding emits its role`: `button_side` gives `{kind: 'role', role: 'page.next'}`.
    `shift` held, then `button_side`, gives `page.previous`. `shift` alone emits nothing,
    because the layout uses it as a `with` control.
  - `missing port`: the status is `disconnected`, and the reason lists LUNA's device names.
  - `reconnect re-claims`: the device goes and comes back, the claim sequence is sent
    again, and the status is `claiming` until the mode report.
  - `follow, label, announce and indicate fill their templates` (LCXL3: `BF 0D <value>`;
    the two label sysex messages with ASCII; `B0 74 21` for `transport.play` active).
  - `release clears indications, then sends the release sequence`; the status is
    `released`.
  - `a request with no template throws`, naming the surface and the template.
- [ ] **Step 2: Write the failing boundary test** (`tests/boundary.test.ts`). It reads
  every file under `src/` and asserts:
  - only files under `src/surface/runtime/`, and `src/main.ts`, import
    `@/surface/runtime`;
  - outside `src/surface/runtime/`, no file mentions `MidiInput`, `SendMidi`,
    `sendControllerToOutput`, `sendSysExToOutput`, `midiDevices` or `onControlChange`;
  - outside `src/surface/` and `src/bundle/`, no file imports `SurfaceDefinition`,
    `SurfaceProfile` or `SurfaceLayout`;
  - no file under `src/` contains a hex literal (`/0x[0-9a-f]/i`), or the strings `LCXL`,
    `Novation` or `Launch Control`.

  Each assertion lists the offending file and line. A self-check plants a temporary core
  file holding `sendControllerToOutput` and `0x21` in a fixture directory, and proves the
  scan reports both.
- [ ] **Step 3: Run them.** Expected: FAIL, the modules are missing.
- [ ] **Step 4: Implement** the interface, then the runtime. `messages.ts` fills
  templates. `claim.ts` holds the claiming, ready, suspended and disconnected states and
  watches the ports. `create.ts` turns addresses into control ids and layout presses into
  roles.
- [ ] **Step 5: Run them.** Expected: PASS. **Step 6: Commit and push.**

### Task 6: Parameter writer

**Files:**
- Create: `src/core/writer/gestures.ts`, ported from `probes/src/lib/gesture.ts` with its
  tests; `src/core/writer/writer.ts`
- Test: `tests/gestures.test.ts`, `tests/writer.test.ts`. They use MockEngine, with a 1176
  insert as in the SDK's own tests, and a fake `Surface` that records calls (no bytes).

**Interfaces:**
- Consumes: `ResolvedBinding`, and `Intent`, `Surface.follow` and `Surface.controls()`
  from `@/surface/api`.
- Produces:

```ts
export interface BoundParameter { binding: ResolvedBinding; param: Luna.Control }
export interface ParameterWriter {
  assign(bound: readonly BoundParameter[]): void;
  handle(intent: Intent): void; // 'move', 'press' and 'release' only; roles go to the app
  release(why: string): void;
}
export function createParameterWriter(surface: Surface, idleMs: number, record: (event: string, detail: unknown) => void): ParameterWriter;
```

The idle timeout is 250 ms, as in the spike.

- [ ] **Step 1: Write the failing tests** (`writer.test.ts`):
  - `a move writes inside one touch`: three `move` intents make one `set_touch` bracket,
    three `normalized_value` writes, and an `end` after idle.
  - `assign follows each "follows" control to its parameter's value` (a
    `surface.follow(control, value)` call per control).
  - `pickup for a control that does not follow`: with the parameter at 0.5, moves 0.1 and
    0.3 write nothing. Then 0.52 writes, and later moves track.
  - `assign mid-gesture releases the old touch and drops queued intents`.
  - `a parameter changed in LUNA re-follows the control, or re-arms pickup`.
  - `toggle button flips once per press`, and `momentary writes 1 on press and 0 on
    release`.
  - `release ends an open touch` (the surface-disconnect path).
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Fader pickup arms on
  `assign` and on every outside change. It writes once an incoming value is within 1/127 of
  the parameter's value, or crosses it between two events. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 7: Explicit targeting

**Files:**
- Create: `src/core/targeting.ts`
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
  - `two copies of one plugin on a track stay apart`. With API Visions in `effect_1` and
    `effect_2`, choosing `effect_2` targets it, and replacing `effect_1` changes nothing
    and sends no notification.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Watch `slot.pluginId`
  (not `track.effects`, per the findings) and `session.tracks`. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 8: Transport

**Files:**
- Create: `src/core/transport.ts`
- Test: `tests/transport.test.ts` (fake `Surface`)

**Interfaces:**
- Produces: `export function bindTransport(session: Luna.Session, surface: Surface): Luna.Unsubscribe;`

- [ ] **Step 1: Write the failing tests:**
  - `a transport.play role toggles the transport`, and `transport.record` calls
    `toggleRecord()`. A `press` intent on any control does nothing here.
  - `transport works with no target`: no plugin is chosen, and play still toggles.
  - `indication follows the transport`: `indicate('transport.play', 'active')` while
    playing and `'inactive'` when stopped; `transport.record` follows `recordEnabled` the
    same way. What those states look like is the layout's business.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

The runtime test in Task 5 already proves that a layout which leaves `transport.play` out
emits no such role.
### Task 9: The app

**Files:**
- Create: `src/core/app.ts`
- Test: `tests/app.test.ts` (MockEngine for LUNA, with the bundled API Vision map and a
  fake `Surface` driven by intents)

**Interfaces:**
- Consumes: everything above. The app receives the `Surface` by injection. It never builds
  one, and never sees a `SurfaceDefinition`.
- Produces:

```ts
export interface AppState { surface: SurfaceStatus; target: Target; resolution: Resolution | undefined }
export interface App {
  start(): Promise<void>; stop(): Promise<void>;
  release(): Promise<void>; // ends any touch, then surface.release()
  reclaim(): Promise<void>; // surface.claim()
  page(step: 1 | -1): void; // the panel's Previous and Next
  state(): AppState; onChange(listener: () => void): Luna.Unsubscribe; targeting: Targeting;
}
export function createApp(session: Luna.Session, maps: Bundle['maps'], surface: Surface): App;
```

- [ ] **Step 1: Write the failing tests:**
  - `a move writes the mapped parameter`: target API Vision, then
    `{kind: 'move', control: 'encoder_1_1', value: 0.63}` writes `550_hf_freq`.
  - `page.next cycles the page and announces "560 EQ 2/2"`, releasing any open touch.
  - `page.previous goes back`, and `page(-1)` and `page(1)` do the same as the roles.
  - `an unmapped insert keeps transport`: with no map, page roles do nothing and
    `transport.play` still toggles.
  - `release ends the touch and calls surface.release; reclaim calls surface.claim`. A move
    after release writes nothing, and the panel status reads "Released: Reclaim controller
    to use it again".
  - `the surface suspending or disconnecting releases the touch and stops writes`.
  - `a target swap to an unmapped plugin gives "No map for plugin …", and moves write
    nothing`.
  - `a refused page writes nothing and lists mismatches`.
  - `assign labels each bound control with its parameter name`.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement.** Bindings are rebuilt on
  any change of target, page, `pluginId` or surface readiness. **Step 4: Run them.**
  Expected: PASS. **Step 5: Commit and push.**

### Task 10: Panel and entry point

**Files:**
- Create: `src/core/panel/model.ts`, `src/core/panel/render.ts`
- Modify: `src/main.ts`, `index.html`; delete `src/logic.ts` and its test once nothing uses
  them
- Test: `tests/panel-model.test.ts`, and `tests/wiring.test.ts`. The wiring test is the one
  core-facing test that sees bytes: MockEngine, the bundled LCXL3 definition, and
  `createSurface` plus `createApp` wired as `main.ts` wires them. `BF 0D 50` from the device
  writes `550_hf_freq`.

**Interfaces:**
- Produces:

```ts
export interface PanelModel { status: string; target: string; page: string; paging: string; rows: Array<{ control: string; parameter: string }>; problems: string[]; choices: Array<{ trackId: string; trackName: string; slots: Array<{ slotId: string; label: string }> }>; controller: 'release' | 'reclaim' }
export function panelModel(state: AppState, session: Luna.Session, surface: Pick<Surface, 'bindingText'>): PanelModel;
```

- [ ] **Step 1: Write the failing tests.** Each `AppState` variant gives the panel text it
  should show:
  - for a `claiming` surface, "Controller: " plus the surface's reason (the core adds no
    device wording);
  - "No map for plugin …";
  - the mismatch list;
  - one row per binding;
  - `target`: `Vocal · effect_2 · API Vision Channel Strip`;
  - `page`: `560 EQ (2 of 2)`; `paging` comes from `surface.bindingText`, so the starter
    layout gives `Next: button_side · Previous: shift + button_side`;
  - `controller`: `reclaim` while the surface is `released`, and `release` otherwise.

  The rendered panel also has Previous and Next buttons, which call `app.page`, and the
  Release or Reclaim button.
- [ ] **Step 2: Run them.** Expected: FAIL. **Step 3: Implement** the model, then a thin DOM
  `render` and `main.ts`:
  1. connect;
  2. require a session;
  3. load `generated.json`;
  4. `createSurface(luna, bundle.surfaces[<the maps' surface id>])`, which throws if the
     bundle has no such surface; then `createApp(session, bundle.maps, surface)` and
     `start`;
  5. render on every change;
  6. call `stop` on `pagehide`.
- [ ] **Step 4: Run them**, then `npm run typecheck && npm run pack -w controller-maps`.
  Expected: PASS, and a `.lunaaddon` is built. **Step 5: Commit and push.**

### Task 11: Live acceptance and the setup document

**Files:**
- Create: `docs/controller-maps/setup.md` (the one-time setup: LUNA sees the LCXL3, the
  bridge is not running, install the Add On, open it; and how to hand the controller to the
  bridge: Release controller, then start the bridge)
- Create: `docs/spikes/2026-11-27-controller-maps-acceptance.md`

- [ ] **Step 1: Install the Add On** in LUNA (`npm run install-addon -w controller-maps`) and
  open a disposable session holding an API Vision.
- [ ] **Step 2: Walk the release gates with Orion, and record each result:**
  - **Gate 2:** the page is known before the first event; power-cycling the controller
    re-claims DAW mode. Without help, Orion finds page 2, tells what a knob controls from
    the display, returns to page 1 with the layout's previous binding, and Play and Record
    still work.
  - **Gate 4:** from a fresh session, with the Add On installed and the controller already
    set up, no remapping is needed.
  - **Gate 5:** undo is one step per turn; Touch automation records; a target change
    mid-gesture releases cleanly; encoders and faders don't jump.
  - **Gate 1, explicit:** choose between two API Visions on one track, and only the chosen
    one moves; a replace or delete stops writes with the stated reason; choosing an
    unmapped insert says "No map" and choosing a mapped one again recovers.
  - **Release:** Release controller leaves the LCXL3 out of DAW mode, and Reclaim
    controller works again without reopening the Add On.
  - **Gate 6:** API Vision ids and names match.
  - **Gate 3:** not run, under the assumption that the bridge isn't running.
- [ ] **Step 3: Commit, push, and open a PR** for the branch with `--body-file`.
