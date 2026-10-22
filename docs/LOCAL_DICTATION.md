# Optional local feedback dictation

In the installed desktop app, select a photo mark or passage feedback draft. **Start dictation** asks permission for one microphone recording. Speak feedback, then **Stop dictation** (maximum 60 seconds). Edit the transcript preview and select **Add transcript to feedback**. This appends to the selected draft, preserving existing text. Use the existing Save feedback / Save comment button. Existing local draft autosave still applies after insertion; dictation does not finalize an assessment or change marks.

Cancel discards the current recording/transcript, not existing feedback. Changing target, disabling the editor, closing marking, or leaving the app window cancels pending capture/transcription. Save/Cancel feedback still has its established meaning. Native text undo works for insertion in Chromium; no application-wide redo system is added. Dictation supports English feedback on selected image and passage annotations; category/overall/rubric/private-note fields remain typed.

## Teacher setup: optional model

Use a desktop build containing the local runtime. If the app reports that the runtime is missing, ask for a build prepared with the steps below; typing remains available.

1. Download `ggml-tiny.en.bin` from the [official whisper.cpp model repository](https://huggingface.co/ggerganov/whisper.cpp/tree/main) on a connected computer. Direct file: `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin`. The model is approximately **75 MiB**; allow space for the downloaded original and the installed copy. It can be transferred to an offline computer.
2. In the selected feedback editor, click **Choose local speech model** and select that file. The app checks its size and upstream model checksum before storing it in its own user-data `dictation` directory. Other models, renamed arbitrary files and corrupt downloads are rejected. No model download runs inside the app; no credentials or subscription are needed.
3. Start dictation and explicitly allow the microphone. If the OS denies microphone access or no microphone exists, continue typing or enable this app's microphone permission in Windows/macOS settings and retry.

The model and [Whisper model weights](https://github.com/openai/whisper#license) use MIT licensing; [whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/v1.7.6/LICENSE) is also MIT. Upstream estimates tiny runtime memory around **273 MB**, in addition to Electron and captured audio. The smallest English model prioritizes modest resources, not guaranteed accuracy: names, punctuation, accents and classroom noise may be misrecognized. Review every result. No automatic grading, rewriting or cloud fallback exists.

## Maintainer setup and packaging

Requirements: Git, CMake, and a native C++ toolchain (Visual Studio C++ build tools on Windows; Xcode command-line tools on Mac). Run:

```sh
npm ci
npm run dictation:prepare
npm run package:win -- --publish never
# On Mac, use matching target architecture for BOTH steps:
npm run dictation:prepare -- --arch=arm64
npm run package:mac -- --arm64 --publish never
```

The preparation script clones pinned whisper.cpp **v1.7.6**, verifies commit `a8d002cfd879315632a579e73f0148d06959de36`, and compiles the CPU CLI with static libraries. No model is downloaded or bundled. For x64 Mac use `--arch=x64` and `--x64`. The two primary desktop CI packaging jobs run this explicit preparation step. Direct electron-builder/upgrade-fixture builds may omit it and will report missing runtime gracefully.

The manifest preserves the prepared byte count and SHA-256. The packaging `afterPack` hook checks the copied runtime against that provenance before signing. On Mac, `afterSign` verifies the native architecture and code signature, binds the signed runtime to the exact prepared snapshot using the comparison below, and records final bytes/SHA-256 in `release/dictation-runtime-<arch>.json`, outside the signed app. The packaged smoke check requires this receipt, checks the final hash and signature again, then runs `--help`. Windows retains exact prepared-byte/hash checks. These are build-integrity checks, not trusted-publisher or recognition-accuracy claims.

Generated binaries, license and provenance manifest go in ignored `dictation-runtime/`; electron-builder copies only those into `resources/dictation-runtime`, outside `app.asar`. Linux verification built a 2,375,064-byte binary; Windows/Mac sizes and physical performance require native checks. Build preparation uses network only for public source. The installed dictation path imports no network client, invokes no shell and has no arbitrary executable/path/argument input from the renderer.

Audio remains in memory, is encoded as bounded mono 16 kHz PCM, and travels to the local CLI through stdin. Plain transcript text returns through stdout. No recording/transcript files are created; cancellation kills the process and closes microphone tracks. The renderer's existing network deny policy remains in place. This is not an OS sandbox guarantee against a tampered executable, operating-system swap/crash dumps, or a compromised computer. Runtime source and exact fixed arguments are auditable; no audio is logged or added to backups. Normal saved feedback continues through existing authorized draft/history/backup flows.

## Verification and acceptance

- `npx vitest run src/dictation`: permission ordering, target generations, denied/missing microphone, delayed capture/transcription, bounded input/output, process cancel/timeout/retry, model validation and owning-frame checks.
- `npm run test:dictation:browser`: real Chromium MediaRecorder/Web Audio using a generated oscillator only; no physical microphone. Checks review/add/save, append, native undo, repeated use, target/window cancellation, missing microphone, disabled editor, and external requests.
- `npm run test:annotation-feedback`: existing actual annotation editing/Save/Cancel regressions.
- `npm test`, `npm run build`: repository baseline.

Physical acceptance is still required on Windows and Mac: install the genuine model, disconnect network, dictate fictional feedback, verify OS permission prompts, indicator/Stop/Cancel, unplug microphone, switch windows/teacher/student, repeat Save/Cancel, restart and check draft/backup preservation. Record architecture, runtime/model versions and timings. Linux dummy-model process checks prove execution, not recognition accuracy; the model download was HTTP 403 in the development environment. No real student audio has been collected.


### Signing comparison and threat boundary (October 21 reconciliation)

The hooks retain the exact hash-checked prepared bytes in memory. After signing, Apple's `/usr/bin/codesign` normalizes disposable copies of both snapshots with the same ad-hoc identity/identifier and no timestamp, then removes those signatures. The complete remaining files must have identical byte counts and SHA-256. This compares executable instructions, constants, load commands and link-edit data together; no custom parser skips arbitrary byte ranges and no presign size equality is imposed on the signed executable. Failure to normalize or compare is fatal. The signed packaged file is never rewritten by this check; its final snapshot hash is checked again before recording the receipt and again before actual `--help` execution.

This detects ordinary accidental or deliberate replacement by another correctly signed same-architecture executable between packaging hooks. Native regression tests compile two different programs, accept re-signing of the original and reject substitution even after signature verification succeeds. Normalization relies on the trusted Apple signing tool and a trusted build host; it is not a proof against a compromised compiler/signing tool, hostile concurrent host writes or specially crafted Mach-O/tool vulnerabilities. The pin identifies expected source, not a reproducible-build or complete supply-chain guarantee. Apple documents that [signing modifies the executable](https://developer.apple.com/library/archive/technotes/tn2206/_index.html). Unsupported normalization differences fail closed and require investigation.
