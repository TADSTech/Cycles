# Plan: Short-Code Auto-Handshake Pairing

1. Create `server.js` using `Bun.serve` for static `web/` serving + `/ws` WebSocket room-code & peer-discovery signaling.
2. Update `web/transports.js` to auto-connect `/ws` (defaulting to current origin `ws(s)://host/ws`), support `hostWithCode()` / `joinWithCode(code)` with salted proof + automatic WebRTC Offer/Answer/ICE exchange, and 1-click `connectToLanPeer(peerId)`.
3. Update `web/index.html`, `web/style.css`, and `web/app.js` for the 6-digit code UX and `?join=CODE` auto-join.
4. Stop old daemon, start `bun server.js`, and verify JS syntax.
