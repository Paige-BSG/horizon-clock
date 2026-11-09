# Third-party notices

The MIT license at the repository root covers HORIZON's original code, interface and application icon. It does not relicense the following assets, dependencies or services.

- **IBM Plex Sans / IBM Plex Mono:** Copyright IBM Corp.; SIL Open Font License 1.1. Full license: [assets/OFL.txt](assets/OFL.txt). Font files retain their original metadata.
- **Landscape photographs:** Unsplash License, which is distinct from MIT and has restrictions on stock-photo redistribution and standalone resale. Sources and photographers: [assets/landscapes/CREDITS.md](assets/landscapes/CREDITS.md). Photos are bundled as application backgrounds. Forks must preserve this notice or replace the photos with appropriately licensed assets.
- **Commons landscapes:** 18 additional bundled photographs are licensed under CC BY 4.0 or CC BY-SA 4.0, as identified individually in [the Commons credits](assets/landscapes/commons/CREDITS.md) and [catalog](assets/landscapes/commons/CATALOG.json). JPEG copies are resized; the application may crop them to the display. Preserve attribution, source and license links, and the applicable photo license when redistributing. These photographs are not MIT licensed. Optional online additions retain their individual author, source and license alongside the cached bytes and expose these in the application. [Commons reuse guidance](https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia).
- **Weather:** Optional Open-Meteo service; data under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), with attribution shown in the application's Weather settings. The [free hosted API terms](https://open-meteo.com/en/terms) allow non-commercial use. Commercial adopters need a suitable API agreement/provider; the MIT code license does not grant access to a commercial weather service.
- **Desktop dependencies:** Tauri, the Tauri autostart and opener plugins, zbus, keepawake and their dependencies retain their respective licenses. Exact versions are recorded in `src-tauri/Cargo.lock` and `package-lock.json`. Development tooling is not bundled in the frontend distribution.

No sponsorship or endorsement by asset creators or service providers is implied.

## Network radio

Radio Paradise supplies the optional live audio streams. Official stream addresses and codec choices are published at <https://radioparadise.com/listen/stream-links>. HORIZON provides a direct personal-listening player and links back to that page; it does not relay, record or distribute the audio. Radio Paradise and the musical works retain their respective rights and are not covered by this repository's MIT license. This project is independent of Radio Paradise. No provider account, API credential, artwork or song-metadata API is used.
