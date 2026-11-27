# luna-addons and the Controller Maps Add On: Design

Status: draft for review
Repo: `audiocontrol-org/luna-addons` (public, Apache-2.0)

## Intent

Orion wants hardware controllers to control plugins in LUNA from mappings prepared ahead of
time, so that a new session needs no MIDI-learning or manual mapping, and so that the
layouts he designs become muscle memory.

The anti-goal is setup friction. If a session needs any hand mapping before the controller
works, the project has failed, even if everything else technically works.

This repo's part is narrow: a LUNA Add On that **applies** finished mappings. Designing
layouts, choosing which parameters fit on a surface, conventions across plugins, and matching
layouts to plugins all belong to the layout-editing system in audiocontrol, not here.

The Novation Launch Control XL 3 (LCXL3) comes first. Other controllers follow, so nothing
outside the controller driver may be LCXL3-specific.

## Goals

- A LUNA Add On, working name **Controller Maps**, that drives the parameters of the plugin
  being worked on from a mapping in the library, with no manual mapping.
- A controller layer where the next controller is a new driver, not a rewrite.
- Parameter moves that behave like a user's: touched, so each gesture is one undo step and is
  recorded as automation when automation is writing.
- Paged mappings: when a mapping has several pages, the Add On switches between them using
  the controller's own page or mode mechanism.
- A home, `audiocontrol-org/luna-addons`, for this and later open-source LUNA Add Ons from
  audiocontrol.

## Non-goals

- Layout design, layout conventions, deciding which parameters a surface exposes, and
  matching layouts to plugins (the layout editor's job, in audiocontrol).
- Hosting the mapping library or its format (they stay in audiocontrol).
- Audio processing or instruments (the LUNA Builder SDK cannot build them).
- Replacing the Rust `midi-macro-bridge` for MC-500 transport and locate.
- Windows.

## Anti-goals

- Per-session manual mapping as the workflow.
- Silent guessing: with no mapping for a plugin, the Add On says so plainly; it never invents
  one.

## Decisions made by Orion

1. **The library stays in audiocontrol.** `modules/canonical-midi-maps` in
   `audiocontrol-org/audiocontrol` holds the mappings and the intermediate format. This repo
   only reads it.
2. **Layouts are designed ahead of time**, in the layout-editing system. This Add On consumes
   the result.
3. **Layout concerns live in the layout editor**: conventions across plugins, which
   parameters fit a surface, and how pages are laid out. The Add On neither enforces nor
   generates layouts.
4. **A common intermediate format** describes the mapping of control-surface controls to
   plugin parameters. It should be built on the existing `CanonicalMidiMap`, extended in
   audiocontrol where LUNA needs more.
5. **Page and mode switching is needed**, and how it works is controller-dependent.
6. **Plugin targeting stays open** until investigated (see Open questions).
7. **Repo:** `audiocontrol-org/luna-addons`, public, Apache-2.0, holding several Add Ons. The
   UA marketplace lists the `.lunaaddon` files on a repo's latest release only, so each
   release attaches every Add On.
8. **macOS only.** Windows is not supported, and nothing needs to keep a Windows path open.
9. **Live testing on Orion's Mac**, after he updates LUNA to the current release (at least
   3.1.2; it has 2.0.5 now), with the LCXL3 attached. Live probes run there directly.
   `tower.local` (Linux, cannot run LUNA) is optional for non-live work.

## Calls made by the designer (Orion may override)

- **Mapping changes go as PRs to audiocontrol**, reviewed by Orion. Backward compatibility
  with the old `@oletizi/canonical-midi-maps` consumers is not required.
- **First release is GitHub releases only.** A UA marketplace listing comes later, so the
  brand-free name and the public `contact` field can wait.
- **Done for the first release:** the Add On applies any valid mapping in the library, proven
  live against the existing maps (Analog Obsession CHANNEV, TAL-J-8, Arturia Jup-8V, Mini V4)
  and against at least one UAD plugin, for which a mapping must be written.
- **LCXL3 in custom mode first.** In a custom mode the LCXL3 sends the plain CCs the
  mappings already address, with no DAW-mode handshake, which may also avoid contention with
  the Rust bridge's DAW-mode use. To confirm in the port spike.

## Background

### LUNA Builder SDK

`uaudio-labs/luna-builder-sdk`, v3.1.2 Update 1, beta, LUNA 3.1.2 or later, Node 22 or later,
Apache-2.0 plus UA's Supplemental Terms. An Add On is a web page plus a `manifest.json`, hosted
by LUNA as a window, a side-panel "browser", an "editor" panel or an "app" page, talking to
LUNA's engine over a WebSocket through the typed `Luna` namespace. Not on npm; scaffolds depend
on it with `file:<path>`.

What this design relies on:

- `Luna.MidiInput`: what the MIDI devices LUNA sees are sending, CCs and SysEx included (no
  Web MIDI in LUNA's web view).
- `Luna.SendMidi` `sendControllerToOutput` / `sendSysExToOutput`: LED and display feedback.
- `luna.midiDevices`: matched by `name`, since device uids change on restart.
- Effect slots and `slot.params`: the parameters of each insert; `slot.pluginId` for matching
  a mapping.
- Touch semantics (SDK EVIDENCE fact 78) and `Luna.bindGesture`: an edit must be touched or it
  is neither one undo step nor recorded as automation.
- `session.focusedTrack`, `luna.gui.pluginWindows` (open plugin editor windows as
  `{session_uid, channel_uid, insert_type}`), `luna.gui.showPlugin` / `hidePlugin`: candidate
  signals for targeting.
- Manifest `run_hidden: true`: the page keeps full speed while hidden, which a controller
  driver needs.
- `Luna.MockEngine` with `engine.receiveMidi(...)`: tests without LUNA.

### audiocontrol assets

- `modules/canonical-midi-maps` (main): the `CanonicalMidiMap` type
  (`src/types/canonical.ts`), YAML maps for the LCXL3, and `plugin-descriptors/*.json`
  (parameter index, name, range, type, from VST3/AU scans). Unpublished as
  `@audiocontrol/canonical-midi-maps` 0.1.0; last published as `@oletizi/canonical-midi-maps`
  1.20.17.
- `modules/launch-control-xl3` (main): TypeScript LCXL3 library (SysEx, custom-mode slots,
  LEDs). It has its own Node MIDI backend, so in LUNA it is reusable only at the
  protocol/encoding level. Same publishing state as above.
- `modules/controller-workflow` (branch `feature/cc-mapping`, not merged): the prior
  pipeline. It reads a custom mode from the controller, converts it to a canonical map,
  matches control labels to plugin parameters with the Claude CLI (`ParameterMatcher`), and
  deploys to Ardour (`.map`) or Ableton Live (JSON for `modules/live-max-cc-router`, a Max for
  Live router that sends CCs to the selected track's device parameters). How much of its
  design to keep is undecided; it is the reference for the layout-editing side, and
  `live-max-cc-router` is the nearest analogue of this Add On.
- `services/midi-macro-bridge` (Rust, main): MCU emulation for LUNA transport and locate,
  plus LCXL3 DAW-mode mixer control (Phase 9), with LCXL3 protocol research under
  `docs/1.0/001-IN-PROGRESS/midi-macro-bridge/research/`.

### Marketplace constraints

From `uaudio-labs/marketplace`: a listing comes from the repo's latest non-draft release and
its `.lunaaddon` files. Another company's brand or product name in the repo name or an Add On's
name ("Novation", "Launch Control", plugin names) holds the submission for manual review, so
those go in descriptions only. No audio, video, MIDI or sample files in a `.lunaaddon`. A
manifest `"contact"` e-mail is published in a public issue.

## The intermediate format: what the Add On needs from it

The format is owned by audiocontrol. These are the Add On's requirements, to be met by
extending `CanonicalMidiMap` there:

- **Controller and controls:** the controller model, and each control's id, type and MIDI
  address (CC or note, channel), as today.
- **Plugin identity LUNA can match:** LUNA identifies plugins by its own `plugin_id`, one per
  format (AU, VST3, UADx). A mapping must list the ids it applies to, or carry enough
  (manufacturer, name, format) for a deterministic match. Which of the two is an open question.
- **Robust parameter targets:** today `plugin_parameter` is a bare index typed
  `string | number`. The Add On needs the parameter's name as well as its index, and refuses
  (with a visible message) a mapping whose names do not match what LUNA reports, rather than
  driving the wrong parameter.
- **Value behaviour:** absolute or relative (encoders), range, and button mode (toggle or
  momentary). The legacy `InputBehavior` had these; the current `ControlDefinition` mostly
  does not.
- **Pages:** a mapping may have several pages of control-to-parameter assignments. How the
  user switches pages is defined per controller (in the mapping or the driver; an open
  question), not by the Add On's core.

## How it works

### Data flow

```
 controller ──MIDI──► LUNA ──Luna.MidiInput──► controller driver ──► control events
                                                    ▲                   │
                                         page/mode  │                   ▼
 canonical-midi-maps (bundled at build) ──► mapping resolver ◄── target ◄── targeting
                                                    │
                                                    ▼
                                   parameter writer (touch, set, release) ──► LUNA plugin
                                                    │
 controller ◄──SendMidi (LEDs, display)── feedback ─┘
```

### Parts

- **Controller driver** (one per controller; the LCXL3 first). Turns raw MIDI from a named
  device into controller-neutral events (`{ control, kind: 'absolute' | 'relative', value }`,
  button press and release), owns the controller's page or mode switching, and turns
  feedback requests into the controller's MIDI (LEDs, display text). Any handshake lives here.
- **Mapping resolver.** Given the target plugin and the current page, returns the
  control-to-parameter assignments from the bundled library, checked against the
  parameters LUNA reports. Nothing in it is controller-specific.
- **Targeting.** Decides which channel and insert slot the controller drives, and announces
  changes. Its strategy comes out of the targeting spike.
- **Parameter writer.** Applies events to `slot.params` with touch semantics: a touch held
  across a continuous gesture (released after a short idle), and a single touched write for a
  button.
- **Panel UI.** Shows the target plugin, the current page, what each control does, and plain
  statements when there is no mapping or a mapping does not match the plugin.

### Library consumption

The Add On bundles the library at build time and reads nothing from the network at run time,
so it needs no manifest `network` entry and works offline. A library change reaches users
through a new luna-addons release. Whether the bundle comes from a published
`@audiocontrol/canonical-midi-maps` or a git dependency is the builder's call.

## Repo shape

- An npm-workspaces monorepo: each Add On is a folder under `add-ons/` with its own manifest;
  code shared between Add Ons goes under `packages/`.
- TypeScript Add Ons from the SDK's `add-on-typescript` template (Vite into one classic IIFE
  script, the `Luna` global typed through `@uaudio/luna-builder-sdk/global`).
- The SDK as a git submodule pinned to a release tag, so builds are reproducible and UA's docs
  are not copied into a public repo (the Supplemental Terms limit copying them to internal
  users).
- One GitHub release per repo version, with every Add On's `.lunaaddon` attached, built by CI.
- `CLAUDE.md` with the project rules.

Orion's standing code rules apply: TypeScript with `@/` imports, composition over inheritance,
interfaces and constructor injection, no `any`, no `as` casts, no `@ts-ignore`, files under
about 500 lines, no fallbacks or mock data outside tests (throw a descriptive error instead),
no git hooks, no AI attribution in commits or PRs.

## Open questions (to stay open until investigated)

1. **Plugin targeting.** Follow `session.focusedTrack` and step through its inserts; follow
   the newest entry in `luna.gui.pluginWindows`; or combine them. The SDK exposes no "front
   window" or "last touched parameter". Settle it with a spike against real LUNA.
2. **LCXL3 ports and mode.** Whether LUNA exposes the LCXL3's ports to Add Ons through
   `Luna.MidiInput` and `luna.midiDevices`, whether custom-mode CCs arrive cleanly, and
   whether LED feedback works from `sendControllerToOutput` / `sendSysExToOutput` in custom
   mode.
3. **Parameter identity.** Whether descriptor indexes from the VST3/AU scans match
   `slot.params` for the same plugin, across AU, VST3 and UADx, and how UAD plugins get
   descriptors.
4. **Plugin identity.** Whether mappings carry LUNA `plugin_id`s or are matched from
   manufacturer, name and format.
5. **Page switching.** For each controller, whether the page mechanism is described in the
   mapping or fixed in the driver.
6. **Coexisting with the Rust bridge.** If both run, which owns the LCXL3; custom mode may
   make this moot.
7. **How much of `controller-workflow` to keep** for the layout-editing side, and whether a
   LUNA deployer belongs there.
8. **Add On name.** "Controller Maps" is a working name and must stay free of brand names.

## Left to the builder

- The order of spikes and their throwaway code.
- The event model's exact shape, the touch idle timeout, and the bundling mechanics.
- The panel's layout and the Add On's `target` (a `"browser"` side panel is the likely fit,
  with `"window"` as a second target).
- CI, the release workflow and the test layout (`Luna.MockEngine` for unit tests, a live lane
  against LUNA on Orion's Mac).
- Repo housekeeping: README, CONTRIBUTING, issue templates, the `luna-addon` GitHub topic.
