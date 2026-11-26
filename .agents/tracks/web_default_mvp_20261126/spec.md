# Spec: Web Default MVP (`web_default_mvp_20261126`)

## Problem Statement
Cycles needs to be a seamless, zero-install-required cross-device transfer system that works across 2.4 GHz / 5 GHz Wi-Fi, hotspots, public Wi-Fi, and Bluetooth, with full customizability. Before building native platform customizations, the default must work cleanly on the Web with zero external dependencies or package installations.

## Requirements
1. **Zero Dependencies**: Pure HTML, CSS, and vanilla ES modules/scripts in `web/` — no npm/bun packages, no build step, works offline.
2. **Multi-Transport Architecture (`TransportManager`)**:
   - **WebRTC P2P DataChannel**: Direct browser-to-browser transfer over 2.4/5 GHz Wi-Fi, hotspots, or public Wi-Fi. Supports:
     - **Offline QR / Copy-Paste SDP Pairing** (using CompressionStream/base64url when available + pure-JS QR code rendering).
     - **Optional WebSocket Signaling URL** (for auto-discovery when a local Rust/LAN signaling server is present).
     - **LAN-only ICE mode** (zero STUN/cellular data) or customizable STUN servers.
   - **Same-Device / Multi-Tab (`BroadcastChannel`)**: Instant zero-config transfer between browser tabs for immediate testing and local workflows.
   - **Web Bluetooth (`navigator.bluetooth`)**: Capability detection and GATT connect hook aligned with `CYCLES_SERVICE_UUID` (`4379636c-6573-0001-0000-000000000001`).
3. **Chunked Transfer Protocol**:
   - Supports **Files** (multi-file queue, drag-and-drop, progress, throughput MB/s, cancel) and **Instant Text / Links** (1-click send & copy).
   - Configurable chunk size (16 KB – 512 KB) and optional SHA-256 integrity verification via Web Crypto API.
4. **Full Customizability (persisted in `localStorage`)**:
   - Device name, transport priority/toggles, chunk size, integrity check toggle, auto-accept trusted peers toggle, LAN-only ICE toggle, custom STUN URL, custom WebSocket signaling URL.
5. **Custom UI Modals**:
   - All dialogs (Pairing, Settings, Incoming Transfer Prompt) use custom HTML/CSS dialogs — never `window.alert()`, `window.confirm()`, or `window.prompt()`.

## Acceptance Criteria
- `web/` loads cleanly with zero network requests and zero external scripts.
- Two browser tabs can immediately pair and transfer files + text via `BroadcastChannel` or WebRTC.
- Two devices on any network (Wi-Fi 2.4/5 GHz, hotspot, public Wi-Fi) can pair via QR code / copy-paste SDP or custom signaling and transfer files + text.
- All settings persist across reloads and dynamically configure the transport & chunking behavior.
