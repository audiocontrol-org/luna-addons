# Controller Maps: spike findings

Results of the investigation spikes in
[the spike plan](../superpowers/plans/2026-11-26-controller-maps-spikes.md), measured against
the [design](../superpowers/specs/2026-11-26-controller-maps-design.md). The probes live in
`probes/src/` on the `feature/skeleton-and-spikes` branch. Raw results stay in the gitignored
`probes/results/`; what follows is curated.

## Test setup

- macOS, LUNA 3.1.2.4699 with its GUI, LUNA Builder SDK `v3.1.2-u1`.
- One Novation Launch Control XL 3, connected over USB.
- Disposable sessions holding one track with LUNA's default console (a UAD Studer A800 in the
  tape slot and a UAD API Vision in the console slot), plus a third-party VST3 channel strip
  for some tests.

## 1. Plugin targeting

**Measured** (`targeting.ts`, an eight-step walk through track and editor changes):

- `session.focusedTrack` follows track selection. It does not change `luna.gui.pluginWindows`.
- `pluginWindows` is an ordered list of `{track, slot}` entries, newest last. An editor left
  open on another track stays in the list.
- Two instances of one plugin on a track are told apart by slot (`effect_1`, `effect_2`).
- Inserting a plugin opens its editor, which appends a window entry.
- Replacing a plugin in a slot removes its window entry and changes `slot.pluginId`. The entry
  comes back at the same slot about 0.6 s later.
- Deleting an insert sets `pluginId` to null and removes the window entry at the same moment.
- `track.effects.onChange` did not fire for any of this. Each slot's `pluginId.onChange` did.

**Answer:** partly. Both signals are reliable, and neither alone picks a single insert:
`focusedTrack` names a track but not a slot, and `pluginWindows` can hold several editors
across tracks.

**Suggests:**

- Target `{track, slot}`, and re-check `pluginId` every time it changes. A target survives a
  replacement while the plugin under it changes.
- Watch each slot's `pluginId`, not the effects collection.
- Use the newest window entry on the focused track as the automatic target. When the focused
  track has no open editor, or more than one, the add-on should suspend writes and say why. That
  rule still has to be built and run against release gate 1.

## 2. LCXL3 ports and mode

**Measured** (`environment.ts`, `lcxl3-io.ts`, `led-retry.ts`):

- LUNA lists the LCXL3 as four devices, one per port direction. "LCXL3 1 MIDI Out" and
  "LCXL3 1 DAW Out" are inputs to listen on; "LCXL3 1 MIDI In" and "LCXL3 1 DAW In" are
  outputs to send to. Names match exactly.
- In a custom mode, every control sends CC on channel 1 of the MIDI port: faders CC 5–12,
  knobs CC 13–36, buttons from CC 37 on (CC 52 was the one tested). Nothing arrives on the DAW
  port.
- LED feedback in a custom mode, sent with `sendControllerToOutput` to the MIDI port, is on or
  off: 127 lights the button white, 0 returns it to its idle colour. Other values (5, 21, 45)
  changed nothing.

**Answer:** yes on all three counts. The ports reach add-ons, custom-mode CCs arrive cleanly,
and on/off LED feedback works.

**Suggests:** the driver names devices by their LUNA port names, and the one-time setup puts
the LCXL3 in a known custom mode. Coloured LED feedback needs the DAW-mode or SysEx route and
hasn't been tested yet.

## 3. Parameter identity

**Measured** (`parameters.ts`, `list-inserts.ts`):

- The VST3 channel strip has 50 parameters in LUNA. Its audiocontrol descriptor matches 47 of
  them by both index and name; the other three have empty names in the descriptor. None were
  missing or extra.
- LUNA's control id for a VST3 parameter is the plugin's own parameter id. Bypass comes first
  with id 65536, then ids 0, 1, 2 and so on.
- UAD plugins have readable, stable control ids, for example `input_level` and `ips` on the
  Studer A800, and `mic_gain`, `line_gain` and `550_lf_gain` on the API Vision.
- audiocontrol has no descriptors for UAD plugins.
- Some parameters are hidden in the plugin's current state. API Vision Mic Gain accepts writes
  while the input selector is on line, but nothing on screen moves.

**Answer:** for VST3, the indexes and names line up with the scan. AU and UADx are still open
(only one VST3 and the UAD console plugins were tested). UAD descriptors can be taken from
LUNA itself, because LUNA reports their parameter ids and names.

**Suggests:**

- Make the control id the primary parameter target in a map. Keep the name for checking that
  it matches.
- Build UAD descriptors from what LUNA reports.
- Write maps for what the plugin shows in the configuration the user normally works in, or
  treat parameters that depend on its state as their own page.

## 4. Plugin identity

**Measured:** LUNA `pluginId`s differ by vendor and format. UAD ids look like
`uaudio_api_vision_ext`; VST3 ids look like `com.<vendor>.vst3.<hex>`.

**Answer:** still open. The bundle can key on LUNA `pluginId` whichever way the maps identify
plugins, as the design already says. The choice is a build-time question for audiocontrol's
map contract.

**Suggests:** leaning to LUNA `pluginId`s in the maps, because the ids differ by format and
nothing tested so far gives a reliable way to work them out from manufacturer and name.

## 5. Page switching

**Measured** (`lcxl3-io.ts`):

- In standalone custom mode, the device reports nothing when the user switches custom modes.
- After the host sends DAW-mode on (`F0 00 20 29 02 15 02 7F F7`), the device answers with a
  SysEx and reports its Mixer and Control modes as `B6 1E 01` and `B6 1E 02`. The user can no
  longer pick custom modes by hand.
- The host can select a custom mode by sending `B6 1E 06` (custom mode 1) to the DAW port. The
  device switches and echoes the message. In that mode, controls send on the MIDI port exactly
  as in standalone.

**Answer:** for the LCXL3, the page has to be known by the host, which means DAW mode with the
host selecting the custom mode. In standalone, the host can't tell which page is active.

**Suggests:** the driver owns paging. It claims DAW mode, selects the custom mode for each
page, and therefore always knows the active page (release gate 2). The map lists its pages;
the driver decides how the user moves between them. Whether that mechanism lives in the map
or in the driver is still open for other controllers.

## 6. Coexisting with the Rust bridge

**Not measured.** The probes ran with the Rust `midi-macro-bridge` stopped. Question 5's
answer makes this question matter: the add-on will claim DAW mode, which the bridge also uses.
It stays open, and becomes its own spike under release gate 3.

## 7. How much of `controller-workflow` to keep

**Not addressed** by these spikes. It belongs to the layout-editing side in audiocontrol.

## 8. Add On name

**Not addressed.** "Controller Maps" remains the working name.

## Write path and touch

The first live write used the third-party VST3 channel strip. LUNA crashed on that first
write, and then crashed every time it reopened the session, with no add-on running. Every
crash report showed a null pointer dereference in the plugin's own audio processing
(`IPlugProcessor::AttachBuffers` under `IPlugVST3::process`, on a LUNA render thread). The
user has seen this plugin family crash before. The spike moved to UAD plugins, and the
crash is recorded as a third-party plugin problem. It doesn't show the write path is at fault.

On the UAD API Vision (`spike-write.ts`, LCXL3 knobs to Line Gain and 550 LF Gain):

- `control.begin()`, then `normalized.set(value / 127)`, then `end()` after 250 ms idle moves
  the plugin's controls on screen. LUNA reports each value with its display text, for example
  Line Gain at 11.3 dB.
- One continuous turn is one undo step: a single ⌘Z restores the value from before the turn,
  and LUNA's Edit menu names the step.
- In Touch automation mode, the turn writes to the parameter's lane and stops writing when
  the touch ends.
- Switching knobs mid-turn ends the first touch where the second begins, and both lanes are
  correct.
- Stopping the spike mid-turn (SIGINT) ends the touch. 80 ms later, LUNA handed the parameter
  back to the existing automation (Line Gain went from 11.3 dB to 9.9 dB), and nothing was
  left held.
- LUNA reported `touchable` as true for Line Gain, 550 LF Gain and Level, and false for Mic
  Gain, a stepped control.
- With no pickup, an absolute knob jumps on its first move. The Level parameter went from 0.68
  to 0.008, confirming the design's pickup requirement.

## Release gates

1. **Targeting:** the signals it needs are measured (question 1). The fail-closed rule isn't
   built yet, so it hasn't been proven.
2. **Paging:** the mechanism is found. In DAW mode, the host selects and echoes the custom
   mode, so the driver can know the page before the first event. Page changes and
   reconnects in a running add-on aren't tested.
3. **Bridge coexistence:** not tested.
4. **No remapping:** device names are exact and the same in every session. Opening a new
   session needed no MIDI setup in LUNA beyond letting LUNA see the controller. The written
   one-time setup is still to do.
5. **Touch:** a turn is one undo step; Touch-mode automation records; switching mid-move
   and stopping mid-move release cleanly. Switching *target* (not just knobs) mid-move, and
   pickup, still need the real add-on.
6. **Coverage:** one VST3 and the UAD console plugins checked, indexes and names included. No
   release list exists yet.

## New questions

- **Hidden parameters.** How should a map treat parameters that only show in some plugin
  states (API Vision Mic Gain versus Line Gain)?
- **Non-touchable parameters.** What does `touchable: false` change for writing and automating
  a parameter such as Mic Gain? Is calling `begin()` on one harmless?
- **Third-party plugin stability.** One plugin's crash in LUNA took the session down. Should
  the release list leave out plugins with a crash history in LUNA?

## LCXL3 in DAW mode

Measured with `lcxl3-daw-features.ts` and `display-retry.ts`, after deciding the LCXL3
driver holds DAW mode. Byte reference: audiocontrol's midi-macro-bridge research
(`lcxl3-cc-map.md`), which decodes Novation's programmer's reference.

- **The control map matches the reference.** Every control sends on the DAW port:
  - faders: channel 16, CC 5-12;
  - encoders: channel 16, CC 13-36 (with all rows set to absolute);
  - the two rows of fader buttons: channel 1, CC 37-52;
  - Play and Record: channel 1, CC 116 and 118;
  - the button left of fader 1: channel 1, CC 104;
  - Shift: channel 7, CC 63.
- **Mixer and Control layouts send the same CCs.** Only the mode report tells them apart.
- **Some controls never reach the host.** The Page and Track buttons and the Solo/Arm and
  Mute/Select toggles sent nothing in either layout. The device uses them, with the fader
  buttons, to change mode itself. The user can reach custom modes this way while DAW mode is
  on, which corrects the earlier reading.
- **Every mode change is reported.** It arrives on channel 7 as CC 30, always paired with a
  CC 31 whose meaning is unknown. So the add-on always knows the mode, and can suspend writes
  when a custom mode is selected.
- **A power cycle drops DAW mode silently.** After the controller restarted, the add-on
  received nothing. Claiming DAW mode again restored it. The driver must notice a reconnect
  and claim DAW mode again (release gate 2).
- **Encoders take a pushed position.** Encoder 1 was last at 53. After the host sent it 64,
  the next nudge sent 65. So the add-on can keep each encoder in step with its parameter,
  which gives pickup for the encoders. Faders have a device pickup setting (channel 7 CC 70)
  that is untested.
- **The display shows host text.**
  - Text sent to encoder 1's display slot ("Line Gain") shows whenever that encoder is
    touched, so each encoder can carry its parameter's name.
  - Overlay text ("LUNA PAGE 1") showed.
  - The permanent display wasn't seen: the screen stays dark until a control moves.
- **LED colours work by palette index.** Play lit green, Record red and Page Up yellow. All
  the fader buttons showed blue after only the first was sent blue, so blue may be their
  default in DAW mode. After DAW mode was released, that first button stayed lit white, as
  standalone mode shows any non-zero LED value. LED state set in DAW mode seems to outlive it.

**Suggests for the LCXL3 driver:**

- Switch off every LED it lit before releasing DAW mode.

- Hold DAW mode, select the Control layout, and set encoder rows to absolute.
- Re-claim DAW mode on reconnect.
- Treat a custom-mode report as "not ours": suspend writes and say so.
- Push each encoder's parameter value on every page or target change.
- Name each encoder on the display, and use the overlay for the page name.
- Paging can't use the Page buttons, because the device keeps them. It needs controls that
  reach the host, such as CC 104 or Shift with a fader button. That choice belongs to the
  layout, so it goes in the map.
