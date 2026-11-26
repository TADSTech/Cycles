# Spec: Short-Code Auto-Handshake Pairing (`short_code_pairing_20261126`)

## Problem Statement
Manually copying and pasting long SDP offer/answer strings in both directions is tedious and breaks seamlessness. Users should be able to pair with a single 6-digit code (or a tiny QR URL) and have the WebRTC handshake happen automatically.

## Requirements
1. Zero external dependencies (`Bun.serve` native HTTP + WebSocket).
2. `server.js` serves `web/` and provides `/ws` signaling:
   - **6-digit Room Code** pairing: Host creates a 6-digit code (`create-room`), Guest joins with that code (`join-room`), and `/ws` relays WebRTC `offer`, `answer`, and `ice` messages automatically.
   - **Salted Handshake Proof**: Room code + random salt hashed to verify pairing authenticity without sending raw secrets.
   - **LAN Auto-Discovery**: Devices connected to `/ws` can see each other in Nearby Devices and initiate 1-click WebRTC pairing.
3. Simplified Pair Modal in `web/`:
   - Big 6-digit code + tiny scannable QR (`?join=CODE`) on Host.
   - Single 6-digit code input + `Connect` (or `Scan QR`) on Guest.
   - Auto-connects via `?join=CODE` URL parameter.
   - Keep manual offline SDP under a collapsible "Offline (No Server)" section.
