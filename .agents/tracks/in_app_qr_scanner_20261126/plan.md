# Plan: In-App QR Scanner

1. Add camera scanner preview container (`<video>`), `Scan QR` buttons, and photo-capture fallback input to `web/index.html` and `web/style.css`.
2. Implement `startQrScan(onDetected)` and `scanQrFromFile(file, onDetected)` in `web/app.js` using `BarcodeDetector` and `getUserMedia`, wiring them to both Guest Offer and Host Answer flows.
3. Verify with `node --check web/app.js`.
