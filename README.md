# luna-addons

Open-source Add Ons for Universal Audio's LUNA, from [audiocontrol](https://github.com/audiocontrol-org/audiocontrol),
built on the [LUNA Builder SDK](https://github.com/uaudio-labs/luna-builder-sdk).

## Status

Design stage. The first Add On applies controller-to-plugin-parameter mappings, designed ahead
of time in audiocontrol's controller layout tooling, so a hardware controller drives the
plugin you are working on in LUNA with no manual MIDI mapping. The Novation Launch Control XL 3
is the first supported controller.

Design: [docs/superpowers/specs/2026-11-26-controller-maps-design.md](docs/superpowers/specs/2026-11-26-controller-maps-design.md)

## Requirements

- macOS
- LUNA 3.1.2 or later
- Node.js 22 or later

## License

[Apache License 2.0](LICENSE). The LUNA Builder SDK is governed by the Apache License 2.0 and
UA's [Supplemental Terms for LUNA Builder SDK](https://github.com/uaudio-labs/luna-builder-sdk/blob/main/SUPPLEMENTAL-TERMS.md).
