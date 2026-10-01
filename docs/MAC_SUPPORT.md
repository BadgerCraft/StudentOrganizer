# Mac test packages

F-006 approved October 1, 2026. This branch adds per-architecture Mac disk-image and archive builds. Electron 44 requires macOS 13 or later. CI uses native Apple Silicon and Intel macOS 15 runners rather than presenting cross-compilation as native launch evidence.

Run `npm run package:mac -- --arm64 --publish never` on Apple Silicon or replace `--arm64` with `--x64` on Intel. Run `npm run test:mac:packages` on the matching Mac after packaging. The test mounts the actual DMG, copies the app, detaches the image, launches the copied app twice and checks assessment persistence. It also extracts the exact ZIP and repeats the flow. Evidence, source ID, architecture, screenshots and checksums are uploaded alongside the packages for 90 days.

The bundles use an ad-hoc test signature, not an Apple Developer ID certificate or notarization. CI launch has no downloaded-file quarantine and does not establish what a colleague's Mac or school policy will allow. Do not ask users to disable protection. Wider distribution/signing and release remain separate decisions. No signing account or subscription is created.

The application ID and local data directory are unchanged. Copying the app to another device does not copy its records. Use Import/Export to save a full JSON backup and restore it on the destination. Restoration replaces destination records after whole-file validation; independently edited devices are not merged. Preserve a destination backup first. No automatic synchronization is included.

Full platform completion also needs participation, mark entry, photo/file handling and backup round-trip checks, and physical iPad validation. Assessment smoke alone does not establish those flows. See IPAD_SUPPORT.md and the current work-order report for observed results.

Primary documentation checked October 1: [Electron 44 minimum macOS](https://www.electronjs.org/blog/electron-44-0), [electron-builder v26 Mac configuration](https://www.electron.build/v26/docs/mac/), [GitHub runner architectures](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
