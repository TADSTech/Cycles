# Plan: Seamless Upgrades

1. Create `web/zip.js` (CRC32 + uncompressed ZIP Blob builder).
2. Update `web/transfer.js` (`file.slice()` streaming, OPFS receive, Pause/Resume/Cancel, Wake Lock).
3. Update `web/transports.js` (parallel DataChannels, TURN ICE config, persistent trusted peer auto-reconnect).
4. Create `web/manifest.json` and `web/sw.js` for PWA + Share Target.
5. Update `web/index.html`, `web/style.css`, and `web/app.js` with all UI controls, folder drop, drag-to-peer, instant link, and settings.
6. Verify JS syntax and restart `bun server.js`.
