# Cycles

Minimal cross-device file transfer app.

## Structure
- `web/` — Zero-dependency static web UI (`index.html`, `style.css`, `app.js`).
- `rust/` — Minimal Rust transport core (`lan/` mDNS + TCP, `ble/` framing, pairing, and transport).
- `assets/icon/cycle.svg` — App icon.
