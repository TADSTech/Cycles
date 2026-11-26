# Spec: Fix Handshake & Alphanumeric Codes (`fix_handshake_alphanum_20261126`)

## Root Causes Identified
1. **Cross-origin proof mismatch**: `localhost` has `crypto.subtle` (SHA-256) while plain `http://<LAN-IP>` does not, causing one peer to use SHA-256 and the other to use FNV-1a fallback, failing verification.
2. **ICE candidate race**: Trickle ICE candidates arriving before `setRemoteDescription` finishes were silently dropped.
3. **Numeric-only codes**: 6 digits (`10^6`) collide too easily at scale.

## Requirements
1. Use a deterministic pure-JS SHA-256 for `computeSaltedProof` so `localhost` and `http://<LAN-IP>` always produce identical hashes.
2. Buffer incoming ICE candidates per peer until `remoteDescription` is set.
3. Switch room codes to 8-character unambiguous alphanumeric (`ABCDEFGHJKLMNPQRSTUVWXYZ23456789`, formatted `XXXX-XXXX`).
