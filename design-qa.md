# Music mode design QA

Source truth: the existing HORIZON clock design and Paige's final brief: a4:6player/information split, time/date/weather retained on the right, a measured waveform on the left, and a straight line when not playing. This is a scoped redesign, not a pixel clone of the rejected full-screen player.

Implementation evidence:

- `previews/waveform-idle-native.png`: installed normal app, fullscreen1920×1080physical,1408×792logical, device scale1.3635966. Idle straight line; clock, date, Shanghai weather and footer visible.
- `previews/waveform-playing-native.png`: installed normal app with actual live audio, captured on the same1920×1080display. The app is windowed in this capture; its frame is approximately1900×1024physical. Window chrome and state differences are intentional comparison limits, not font or layout defects.
- Private handoff evidence includes the previous split capture and the native size-correction report. Full-view review confirms that the player occupies the left region and the time remains dominant on the right. Source and implementation are compared by hierarchy and region bounds; no exact pixel-fidelity claim is made across different playback/window states.

## Required surfaces

- Typography: existing Plex/PlexMono Latin fonts and system CJK serif/sans fallbacks are retained. The native music clock uses the corrected213.84CSSpxsize in the1408×792logical viewport. No cropped seconds or unreadable date/weather content remains in the full-screen idle capture.
- Spacing and layout: the measured desktop player/information width ratio is0.666656, consistent with4:6. Player controls and the original information remain separate. Narrow screens stack the information above the player and can scroll at the minimum window height rather than hiding controls.
- Color and tokens: the original glacier palette, landscape treatment and display brightness remain. Waveform colors follow the three existing channel palettes. A thin illuminated line is the stopped state; movement and amplitude come from actual waveform data during playback.
- Imagery and rendering: existing licensed landscape assets remain unchanged. The sculpture/poster and particle sphere are removed. The final visual uses a local antialiased canvas with no external model, image or texture request.
- Copy: no normal-state explanatory paragraph or dropdown remains. Three directly selectable channels, brief playback status, volume, official source and an independent waveform-motion control are present.

## Interactions and checks

Play/stop, channel selection, local volume preferences, actual decoded PCM response, silence/mute/stopped baselines, reduced motion, idle redraw suspension, collapse/background playback, settings access, missing canvas support and logical viewport sizing are covered by15radio browser regressions. All59browser regressions passed. Final native playback rendered a changing waveform while the HORIZON-only meter was active. The idle native capture shows the required straight line. No page errors were observed in the native meter QA reports; final normal visual inspection is distinct from that earlier instrumented QA run.

## Comparison history

A native font-scale mismatch initially enlarged the music time to290CSSpxand caused4pxofhorizontal overflow. The logical viewport correction restored213.84CSSpxand1408×792containment. The final normal build includes the correction. The final visual was changed to waveform after Paige's sphere feedback; no sphere or ambient rotation remains.

No actionable P0/P1/P2 visual issue was found in the final inspected states. Focused visual review covered the waveform baseline, play/volume controls, full time/seconds and date/weather text. Subjective acceptance belongs to Paige; a passing QA result does not imply artistic approval.

final result: passed
