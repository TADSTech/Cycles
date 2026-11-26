# Spec: Strip to Bare Minimum (`strip_to_minimal_20261126`)

## Problem Statement
The cloned `Cycles` repository is a full-featured Flutter + Rust + Automerge CRDT + SQLite + Go relay task-sync application with 5 native platform folders and heavy dependencies. Due to tight storage and cellular data constraints, and a pivot in goal toward **an app that makes it easy to move files amongst devices in creative, seamless ways**, we need to strip the repository down to its barest minimum without installing any packages.

## Requirements
1. **Do not install anything** (no `flutter pub get`, no `cargo build`, no `bun install`, no network package fetches).
2. **Remove non-essential bloat**:
   - Flutter app & platform folders: `android/`, `ios/`, `linux/`, `macos/`, `windows/`, `lib/`, `test/`, `pubspec.yaml`, `pubspec.lock`, `analysis_options.yaml`, `.metadata`.
   - Extra services/research/docs: `ble_research/`, `relay-server/`, `docs/`, `scripts/`, `.github/`, `ARCHITECTURE.md`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `SHA256SUMS`.
   - Redundant icon PNGs in `assets/icon/` (keep only `cycle.svg`).
3. **Strip `rust/` to minimal LAN/BLE transport**:
   - Remove `crdt.rs`, `store.rs`, `frb_generated.rs`, `api.rs`, `relay/`, `wifi_direct/`.
   - Remove heavy dependencies from `rust/Cargo.toml` (`automerge`, `flutter_rust_bridge`, `rusqlite`, `tokio-tungstenite`, `futures-util`) and `rust/Cargo.lock` (since we aren't running cargo to regenerate it, remove stale lockfile or note it).
   - Keep `lan/` and `ble/` modules cleanly wired in `rust/src/lib.rs` (removing any `crdt`/`store` references in `lan`/`ble` if needed, or marking them cleanly).
4. **Add a super minimal, zero-dependency `web/` scaffold**:
   - Plain `index.html`, `style.css`, `app.js` (no bundler, no `node_modules`) tailored to moving files across devices.
5. **Update `README.md` and `.gitignore`** to reflect the stripped-down file-transfer focus.

## Acceptance Criteria
- All Flutter/platform/relay/research/CRDT bloat is removed.
- `rust/` contains only minimal LAN/BLE transport code and minimal `Cargo.toml`.
- `web/` contains a working static, zero-dependency UI shell for file transfer.
- Zero packages downloaded or installed.
