# Spec: In-App QR Scanner (`in_app_qr_scanner_20261126`)

## Problem Statement
Users cannot scan pairing QR codes directly inside the Cycles web app when joining or completing pairing—they are forced to paste text codes manually.

## Requirements
1. Zero external dependencies.
2. Add a **Scan QR** button to both:
   - **Join Pairing (Guest)**: scans Offer QR -> populates `#offer-in` and auto-generates Answer.
   - **Start Pairing (Host)**: scans Answer QR -> populates `#answer-in` and auto-connects.
3. Support live camera scanning via `navigator.mediaDevices.getUserMedia` + native `BarcodeDetector` (`qr_code` format).
4. Provide a **Scan from Photo / Camera Capture** fallback (`<input type="file" accept="image/*" capture="environment">`) for browsers/origins where live `getUserMedia` is restricted (e.g., plain `http://` LAN IPs), and a clear status message if `BarcodeDetector` is unavailable in the current browser.
