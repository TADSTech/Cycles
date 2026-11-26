# Plan: Web Default MVP

1. Create `web/qr.js`: Lightweight, zero-dependency QR code SVG/Canvas renderer for offline pairing codes.
2. Create `web/transfer.js`: Chunked binary/JSON framing protocol with SHA-256 verification, throughput calculation, and file/text reassembly.
3. Create `web/transports.js`: `TransportManager` supporting WebRTC DataChannel (manual QR/SDP + optional WebSocket signaling + customizable ICE), `BroadcastChannel` local peer discovery, and Web Bluetooth capability/GATT hook.
4. Update `web/index.html`, `web/style.css`, and `web/app.js`:
   - Transport Matrix status bar & quick-pair buttons
   - File drop-zone + Instant Text/Link sender
   - Live transfer queue (outgoing & incoming) with speed & progress
   - Custom modals for QR/Code Pairing, Settings/Customization, and Incoming Accept/Reject
5. Verify JS syntax and test serving `web/` locally (without installing any packages).
