# Cycles2

**Zero-install, peer-to-peer cross-device file and note transfer.**

Cycles2 is a lightweight, zero-dependency web application backed by a minimal Bun HTTP/WebSocket signaling broker and a stripped Rust LAN/BLE transport core. It is built to move files, folders, and notes seamlessly across phones, tablets, and desktops over **2.4 GHz / 5 GHz Wi-Fi**, **mobile hotspots**, **public Wi-Fi**, **Bluetooth LE**, or **browser tabs**.

---

## Features

- **Zero-Install Web Client (`web/`)**: Open in any modern browser—no native app required on the receiving device.
- **8-Character Alphanumeric Pairing & QR**:
  - Host generates an unambiguous 8-character code (`XXXX-XXXX`) and scannable `?join=CODE` QR code.
  - Guest enters the code, scans the QR (live camera via `BarcodeDetector` or photo capture), or opens the `?join=CODE` link.
  - Salted deterministic SHA-256 handshake proof + automatic WebRTC Offer/Answer/ICE negotiation over `/ws`.
  - Collapsible **Offline / No-Server Manual Mode** for air-gapped SDP exchange when no broker is reachable.
- **1-Click LAN Discovery & Persistent Auto-Reconnect**:
  - Devices on the same broker appear under **Devices** for 1-click connection.
  - Trusted peers are remembered in `localStorage` and reconnect automatically when online.
- **Zero-RAM Streaming & Parallel DataChannels**:
  - Outgoing files stream via `file.slice()` instead of loading entire files into memory.
  - Incoming chunks write directly to **OPFS** (`FileSystemWritableFileStream`) at exact chunk offsets (with automatic `Blob` fallback), keeping RAM flat for large files.
  - Configurable **1–4 parallel WebRTC DataChannels**, chunk sizes (`16 KB`–`512 KB`), and **Screen Wake Lock** during active transfers.
  - **Pause**, **Resume**, and **Cancel** controls on outgoing transfers, plus optional SHA-256 integrity verification (`<= 64 MB`).
- **Seamless Transfer Workflows**:
  - **Drag onto a Device** to send immediately without queueing.
  - **Folder Drop / Pick** + zero-dependency uncompressed **ZIP** bundler (`web/zip.js` with CRC32).
  - **Instant Share Link** (`?join=CODE`) that auto-sends queued files the moment the recipient connects.
  - **Note or Link** beaming with 1-click clipboard copy and optional arrival chime/haptic feedback.
  - **PWA & Web Share Target** (`web/manifest.json`, `web/sw.js`) for offline shell caching and OS share-sheet intake.
- **Customizable Network & Transport Settings**:
  - **LAN-Only ICE** mode (zero external STUN / cellular data), custom **STUN** server, optional **TURN** server credentials, **Tab Mesh** (`BroadcastChannel`), **WebSocket** signaling URL, and **Web Bluetooth** GATT scan hook.

---

## Project Structure

```text
Cycles2/
├── server.js          # Zero-dependency Bun static server + /ws room & peer broker
├── DESIGN.md          # 13 typography, spacing, and minimalist UI guidelines
├── AGENTS.md          # Project workflow rules (Ralph's Method)
├── web/
│   ├── index.html     # Minimalist single-column UI + custom modals
│   ├── style.css      # Paper & Ink token-locked stylesheet
│   ├── app.js         # UI controller, folder/drag-to-peer, QR scanner, settings
│   ├── transports.js  # BroadcastChannel, WebRTC (parallel + TURN), /ws broker, BLE
│   ├── transfer.js    # file.slice() streaming, OPFS receive, Wake Lock, Pause/Cancel
│   ├── qr.js          # Pure-JS SVG QR code generator
│   ├── zip.js         # Pure-JS uncompressed ZIP + CRC32 builder
│   ├── manifest.json  # PWA manifest + Web Share Target
│   └── sw.js          # Offline shell & share-target service worker
├── rust/              # Stripped Rust transport core (lan/ mDNS+TCP, ble/ GATT+framing)
└── assets/icon/
    └── cycle.svg      # Vector app mark
```

---

## Quick Start

Run the zero-dependency Bun server (no `bun install` needed):

```bash
bun server.js
```

By default it listens on `0.0.0.0:3000`:
- **This machine**: `http://localhost:3000`
- **Other devices on the same Wi-Fi / hotspot**: `http://<your-lan-ip>:3000`

To use a custom port:

```bash
PORT=8080 bun server.js
```

---

## Design System

All UI work in Cycles2 follows the 13 rules in [DESIGN.md](DESIGN.md).
