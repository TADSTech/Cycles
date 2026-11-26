# Plan: Strip to Bare Minimum

1. Remove Flutter, native platform folders (`android`, `ios`, `linux`, `macos`, `windows`), `lib`, `test`, `relay-server`, `ble_research`, `docs`, `scripts`, `.github`, and unused root/asset files.
2. Inspect `rust/src/lan/` and `rust/src/ble/` for references to `crdt` or `store` or `api`, clean them up, remove `crdt.rs`, `store.rs`, `frb_generated.rs`, `api.rs`, `relay/`, `wifi_direct/`, `Cargo.lock`, and slim down `rust/Cargo.toml` and `rust/src/lib.rs`.
3. Create minimal `web/` (`index.html`, `style.css`, `app.js`) with zero dependencies.
4. Update `README.md` and `.gitignore`.
5. Verify final directory tree and sizes with PowerShell `Get-ChildItem`.
