# Spec: Seamless Upgrades (`seamless_upgrades_20261126`)

## Goal
Upgrade Cycles Web to match and exceed PairDrop, LocalSend, and FilePizza while remaining 100% zero-dependency.

## Features
1. **Zero-RAM Streaming**: `file.slice()` chunked reads on send; OPFS (`FileSystemWritableFileStream`) or `Blob` fallback on receive.
2. **Transfer Controls & Wake Lock**: Pause, Resume, and Cancel per transfer; `navigator.wakeLock` during active transfers.
3. **Parallel DataChannels & TURN**: Configurable 1–4 WebRTC DataChannels per peer + optional TURN server credentials in Customize.
4. **Persistent Trusted Peers**: Remember paired/trusted peer IDs in `localStorage` and auto-connect when both are on `/ws`.
5. **Instant Share Link**: Generate a `?join=CODE` link for queued files that auto-sends upon guest connection.
6. **Folder Drop & Zero-Dep ZIP**: Recursive folder drop (`webkitGetAsEntry` / `webkitdirectory`) + zero-dependency CRC32 uncompressed `.zip` builder (`web/zip.js`).
7. **Creative UX & PWA**: Drag-onto-peer card to send immediately, optional arrival chime/haptic feedback, `manifest.json` + `sw.js` with Web Share Target.
