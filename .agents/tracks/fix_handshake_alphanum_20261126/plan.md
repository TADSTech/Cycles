# Plan: Fix Handshake & Alphanumeric Codes

1. Update `server.js` to generate and normalize 8-char alphanumeric room codes (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`).
2. Update `web/transports.js` with pure-JS SHA-256 for `computeSaltedProof`, ICE candidate buffering, and alphanumeric code handling.
3. Update `web/index.html` and `web/app.js` for `XXXX-XXXX` alphanumeric codes.
4. Restart `bun server.js` and verify syntax.
