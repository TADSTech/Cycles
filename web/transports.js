// Multi-transport engine for Cycles Web:
// 1. BroadcastChannel (instant same-device multi-tab transfer)
// 2. WebSocket Auto-Broker + WebRTC P2P (6-digit code or 1-click LAN peer auto-handshake)
// 3. Offline WebRTC QR/SDP fallback (no server required)
// 4. Web Bluetooth (Chromium GATT hook aligned with rust/src/ble/discovery.rs UUIDs)

export const CYCLES_BLE_SERVICE_UUID = '4379636c-6573-0001-0000-000000000001';
export const CYCLES_BLE_CHAR_UUID = '4379636c-6573-0002-0000-000000000001';

function toBase64Url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(padded);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Deterministic pure-JS SHA-256 so secure (localhost/HTTPS) and plain HTTP LAN origins
// always compute identical salted handshake proofs.
function sha256Bytes(bytes) {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const buf = new Uint8Array(paddedLen);
  buf.set(bytes);
  buf[bytes.length] = 0x80;
  const dv = new DataView(buf.buffer);
  dv.setUint32(paddedLen - 4, bitLen >>> 0, false);
  dv.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);

  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));

  for (let off = 0; off < paddedLen; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4, false);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }
  const out = new Uint8Array(32);
  const outDv = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) outDv.setUint32(i * 4, H[i], false);
  return out;
}

async function computeSaltedProof(code, salt) {
  const bytes = new TextEncoder().encode(`${code}:${salt}`);
  return toBase64Url(sha256Bytes(bytes)).slice(0, 16);
}

export async function encodeSignalPayload(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (globalThis.CompressionStream) {
    try {
      const cs = new CompressionStream('deflate-raw');
      const writer = cs.writable.getWriter();
      writer.write(raw);
      writer.close();
      const compressed = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      return 'z1:' + toBase64Url(compressed);
    } catch {
      // Fallback to uncompressed
    }
  }
  return 'j1:' + toBase64Url(raw);
}

export async function decodeSignalPayload(code) {
  const trimmed = code.trim();
  if (trimmed.startsWith('z1:')) {
    const bytes = fromBase64Url(trimmed.slice(3));
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const raw = await new Response(ds.readable).arrayBuffer();
    return JSON.parse(new TextDecoder().decode(raw));
  }
  if (trimmed.startsWith('j1:')) {
    const bytes = fromBase64Url(trimmed.slice(3));
    return JSON.parse(new TextDecoder().decode(bytes));
  }
  return JSON.parse(trimmed);
}

function waitIceGathering(pc, timeoutMs = 2500) {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    const onChange = () => {
      if (pc.iceGatheringState === 'complete') {
        clearTimeout(timer);
        pc.removeEventListener('icegatheringstatechange', onChange);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', onChange);
  });
}

const TRUSTED_STORAGE_KEY = 'cycles.trustedPeers.v1';

function loadTrustedPeerIds() {
  try {
    return new Set(JSON.parse(localStorage.getItem(TRUSTED_STORAGE_KEY) || '[]'));
  } catch {
    return new Set();
  }
}

function saveTrustedPeerIds(set) {
  try {
    localStorage.setItem(TRUSTED_STORAGE_KEY, JSON.stringify(Array.from(set)));
  } catch {
    // Ignore storage quota errors
  }
}

export class TransportManager {
  constructor({ deviceId, getSettings, onPeersChanged, onMessage, onRoomEvent }) {
    this.deviceId = deviceId;
    this.getSettings = getSettings;
    this.onPeersChanged = onPeersChanged;
    this.onMessage = onMessage;
    this.onRoomEvent = onRoomEvent;

    this.peers = new Map();
    this.trustedIds = loadTrustedPeerIds();
    this.discoveredLanPeers = [];
    this.bc = null;
    this.ws = null;
    this.wsConnected = false;
    this.pendingRtc = null;
    this.activeRtcByPeer = new Map();
    this.pendingIce = new Map();
    this.activeRoomCode = null;
  }

  getCapabilities() {
    return {
      broadcastChannel: typeof BroadcastChannel !== 'undefined',
      webrtc: typeof RTCPeerConnection !== 'undefined',
      webBluetooth: Boolean(navigator?.bluetooth),
      webCrypto: Boolean(globalThis.crypto?.subtle),
      qrReady: typeof QR !== 'undefined',
      wsBroker: this.wsConnected,
    };
  }

  _defaultWsUrl() {
    const s = this.getSettings();
    if (s.signalingUrl && s.signalingUrl.trim()) return s.signalingUrl.trim();
    if (location.protocol === 'http:' || location.protocol === 'https:') {
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${location.host}/ws`;
    }
    return '';
  }

  start() {
    const settings = this.getSettings();
    if (settings.transports.broadcast && typeof BroadcastChannel !== 'undefined') {
      this.startBroadcastChannel();
    }
    if (settings.transports.wsSignaling) {
      const url = this._defaultWsUrl();
      if (url) this.connectSignaling(url);
    }
  }

  stop() {
    if (this.bc) {
      this.bc.postMessage({ type: 'bye', from: this.deviceId });
      this.bc.close();
      this.bc = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.wsConnected = false;
  }

  restart() {
    this.stop();
    for (const [id, peer] of this.peers.entries()) {
      if (peer.transport === 'Tab Mesh') this.peers.delete(id);
    }
    this.discoveredLanPeers = [];
    this.emitPeers();
    this.start();
  }

  emitPeers() {
    this.onPeersChanged?.(Array.from(this.peers.values()), this.discoveredLanPeers);
  }

  setPeerTrusted(peerId, trusted) {
    const peer = this.peers.get(peerId);
    if (peer) {
      peer.trusted = trusted;
      if (trusted) this.trustedIds.add(peerId);
      else this.trustedIds.delete(peerId);
      saveTrustedPeerIds(this.trustedIds);
      this.emitPeers();
    }
  }

  // --- 1. BroadcastChannel (Same-device tabs) ---
  startBroadcastChannel() {
    if (this.bc) return;
    this.bc = new BroadcastChannel('cycles-local-mesh');
    const announce = () => {
      const s = this.getSettings();
      this.bc?.postMessage({
        type: 'hello',
        from: this.deviceId,
        name: s.deviceName,
      });
    };

    this.bc.onmessage = (ev) => {
      const msg = ev.data;
      if (!msg || msg.from === this.deviceId) return;

      if (msg.type === 'hello') {
        const isNew = !this.peers.has(msg.from);
        this.peers.set(msg.from, {
          id: msg.from,
          name: msg.name || 'Browser Tab',
          transport: 'Tab Mesh',
          trusted: true,
          sendJson: async (obj) => {
            this.bc?.postMessage({
              type: 'data',
              from: this.deviceId,
              to: msg.from,
              payload: JSON.stringify(obj),
            });
          },
          sendBinary: async (buf) => {
            this.bc?.postMessage({
              type: 'data',
              from: this.deviceId,
              to: msg.from,
              payload: buf,
            });
          },
        });
        if (isNew) announce();
        this.emitPeers();
      } else if (msg.type === 'bye') {
        this.peers.delete(msg.from);
        this.emitPeers();
      } else if (msg.type === 'data' && (!msg.to || msg.to === this.deviceId)) {
        const peer = this.peers.get(msg.from);
        if (peer) this.onMessage?.(peer, msg.payload);
      }
    };

    announce();
    window.addEventListener('beforeunload', () => {
      this.bc?.postMessage({ type: 'bye', from: this.deviceId });
    });
  }

  // --- 2. WebRTC Core ---
  _buildRtcConfig() {
    const s = this.getSettings();
    if (s.lanOnlyIce) return { iceServers: [] };
    const servers = [];
    const stunUrl = (s.stunUrl || 'stun:stun.l.google.com:19302').trim();
    if (stunUrl) servers.push({ urls: stunUrl });
    if (s.turnUrl && s.turnUrl.trim()) {
      const turn = { urls: s.turnUrl.trim() };
      if (s.turnUser) turn.username = s.turnUser;
      if (s.turnPass) turn.credential = s.turnPass;
      servers.push(turn);
    }
    return { iceServers: servers };
  }

  _wireMultiChannelPeer(pc, peerId, peerName, trusted = false) {
    const channels = [];
    const isTrusted = trusted || this.trustedIds.has(peerId);
    if (isTrusted) {
      this.trustedIds.add(peerId);
      saveTrustedPeerIds(this.trustedIds);
    }

    const peer = {
      id: peerId,
      name: peerName || 'WebRTC Peer',
      transport: 'WebRTC P2P',
      trusted: isTrusted,
      pc,
      channels,
      sendJson: async (obj) => {
        const ctrl = channels[0];
        if (!ctrl || ctrl.readyState !== 'open') throw new Error('DataChannel not open');
        ctrl.send(JSON.stringify(obj));
      },
      sendBinary: async (buf, chunkIndex = 0) => {
        const open = channels.filter((c) => c.readyState === 'open');
        if (open.length === 0) throw new Error('DataChannel not open');
        const ch = open[chunkIndex % open.length];
        if (ch.bufferedAmount > 1024 * 1024) {
          await new Promise((resolve) => {
            ch.bufferedAmountLowThreshold = 256 * 1024;
            const onLow = () => {
              ch.removeEventListener('bufferedamountlow', onLow);
              resolve();
            };
            ch.addEventListener('bufferedamountlow', onLow);
          });
        }
        ch.send(buf);
      },
    };

    const attachChannel = (dc) => {
      dc.binaryType = 'arraybuffer';
      channels.push(dc);
      dc.onopen = () => {
        if (!this.peers.has(peerId)) {
          this.peers.set(peerId, peer);
          this.emitPeers();
          this.onRoomEvent?.({ type: 'connected', peer });
        }
      };
      dc.onclose = () => {
        if (channels.every((c) => c.readyState === 'closed')) {
          this.peers.delete(peerId);
          this.activeRtcByPeer.delete(peerId);
          this.pendingIce.delete(peerId);
          this.emitPeers();
        }
      };
      dc.onmessage = (ev) => {
        this.onMessage?.(peer, ev.data);
      };
    };

    return { peer, attachChannel };
  }

  _wireDataChannel(dc, pc, peerId, peerName, trusted = false) {
    const { attachChannel } = this._wireMultiChannelPeer(pc, peerId, peerName, trusted);
    attachChannel(dc);
  }

  // --- 3. WebSocket Auto-Handshake (6-Digit Code & 1-Click LAN) ---
  connectSignaling(url) {
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.wsConnected = true;
        const s = this.getSettings();
        this.ws?.send(JSON.stringify({ type: 'hello', id: this.deviceId, name: s.deviceName }));
        this.onRoomEvent?.({ type: 'ws-status', connected: true });
      };
      this.ws.onclose = () => {
        this.wsConnected = false;
        this.discoveredLanPeers = [];
        this.emitPeers();
        this.onRoomEvent?.({ type: 'ws-status', connected: false });
      };
      this.ws.onerror = () => {
        this.wsConnected = false;
      };
      this.ws.onmessage = async (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        await this._handleWsMessage(msg);
      };
    } catch {
      this.wsConnected = false;
    }
  }

  async _handleWsMessage(msg) {
    if (msg.type === 'peers') {
      this.discoveredLanPeers = (msg.peers || []).filter((p) => p.id !== this.deviceId);
      this.emitPeers();
      // Auto-reconnect to previously trusted peers when both are online (deterministic tie-break)
      if (this.getSettings().autoReconnectTrusted) {
        for (const p of this.discoveredLanPeers) {
          if (
            this.trustedIds.has(p.id) &&
            !this.peers.has(p.id) &&
            !this.activeRtcByPeer.has(p.id) &&
            this.deviceId < p.id
          ) {
            this._initiateBrokerRtc(p.id, p.name, null).catch(() => {});
          }
        }
      }
      return;
    }

    if (msg.type === 'room-created') {
      this.activeRoomCode = msg.code;
      this.onRoomEvent?.({ type: 'room-created', code: msg.code });
      return;
    }

    if (msg.type === 'room-error') {
      this.onRoomEvent?.({ type: 'room-error', message: msg.message });
      return;
    }

    if (msg.type === 'room-joined') {
      this.activeRoomCode = msg.code;
      this.onRoomEvent?.({ type: 'room-joined', hostName: msg.hostName, code: msg.code });
      return;
    }

    if (msg.type === 'peer-joined') {
      await this._initiateBrokerRtc(msg.peerId, msg.peerName, msg.code);
      return;
    }

    if (msg.type === 'signal' && msg.from && msg.data) {
      await this._handleBrokerSignal(msg.from, msg.fromName || 'Remote Device', msg.data);
    }
  }

  createRoomCode() {
    if (!this.wsConnected || !this.ws) {
      throw new Error('Not connected to signaling broker.');
    }
    this.ws.send(JSON.stringify({ type: 'create-room' }));
  }

  joinRoomCode(code) {
    if (!this.wsConnected || !this.ws) {
      throw new Error('Not connected to signaling broker.');
    }
    const clean = String(code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
    if (clean.length < 6) throw new Error('Enter the full pairing code.');
    this.activeRoomCode = clean;
    this.ws.send(JSON.stringify({ type: 'join-room', code: clean }));
  }

  async connectToLanPeer(peerId, peerName) {
    await this._initiateBrokerRtc(peerId, peerName, null);
  }

  async _initiateBrokerRtc(peerId, peerName, code) {
    const pc = new RTCPeerConnection(this._buildRtcConfig());
    const { attachChannel } = this._wireMultiChannelPeer(pc, peerId, peerName, Boolean(code));
    const count = Math.min(4, Math.max(1, Number(this.getSettings().parallelChannels) || 2));
    for (let i = 0; i < count; i++) {
      attachChannel(pc.createDataChannel(`cycles-${i}`, { ordered: true }));
    }
    this.activeRtcByPeer.set(peerId, pc);

    pc.onicecandidate = (ev) => {
      if (ev.candidate && this.wsConnected) {
        this.ws.send(JSON.stringify({
          type: 'signal',
          to: peerId,
          data: { kind: 'ice', candidate: ev.candidate },
        }));
      }
    };

    const salt = Math.random().toString(36).slice(2, 10);
    const proof = code ? await computeSaltedProof(code, salt) : null;
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    this.ws.send(JSON.stringify({
      type: 'signal',
      to: peerId,
      data: { kind: 'offer', sdp: offer.sdp, salt, proof },
    }));
  }

  async _handleBrokerSignal(fromId, fromName, data) {
    if (data.kind === 'offer') {
      if (data.proof && this.activeRoomCode) {
        const expected = await computeSaltedProof(this.activeRoomCode, data.salt || '');
        if (expected !== data.proof) {
          this.onRoomEvent?.({ type: 'room-error', message: 'Handshake verification failed.' });
          return;
        }
      }
      const pc = new RTCPeerConnection(this._buildRtcConfig());
      this.activeRtcByPeer.set(fromId, pc);
      const { attachChannel } = this._wireMultiChannelPeer(pc, fromId, fromName, Boolean(data.proof));
      pc.ondatachannel = (ev) => {
        attachChannel(ev.channel);
      };
      pc.onicecandidate = (ev) => {
        if (ev.candidate && this.wsConnected) {
          this.ws.send(JSON.stringify({
            type: 'signal',
            to: fromId,
            data: { kind: 'ice', candidate: ev.candidate },
          }));
        }
      };
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      await this._flushIce(fromId, pc);
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.ws.send(JSON.stringify({
        type: 'signal',
        to: fromId,
        data: { kind: 'answer', sdp: answer.sdp },
      }));
      return;
    }

    if (data.kind === 'answer') {
      const pc = this.activeRtcByPeer.get(fromId);
      if (!pc) return;
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this._flushIce(fromId, pc);
    } else if (data.kind === 'ice' && data.candidate) {
      const pc = this.activeRtcByPeer.get(fromId);
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          // Ignore stale ICE candidates
        }
      } else {
        const list = this.pendingIce.get(fromId) || [];
        list.push(data.candidate);
        this.pendingIce.set(fromId, list);
      }
    }
  }

  async _flushIce(peerId, pc) {
    const queued = this.pendingIce.get(peerId);
    if (!queued || queued.length === 0) return;
    this.pendingIce.delete(peerId);
    for (const c of queued) {
      try {
        await pc.addIceCandidate(c);
      } catch {
        // Ignore stale ICE candidates
      }
    }
  }

  // --- 4. Offline Manual WebRTC Fallback ---
  async createRtcOfferCode() {
    const s = this.getSettings();
    const pc = new RTCPeerConnection(this._buildRtcConfig());
    const dc = pc.createDataChannel('cycles', { ordered: true });
    const remoteId = `rtc-${Math.random().toString(36).slice(2, 8)}`;

    this._wireDataChannel(dc, pc, remoteId, 'Remote Device');
    this.pendingRtc = { pc, dc, remoteId };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIceGathering(pc);

    return encodeSignalPayload({
      t: 'o',
      id: this.deviceId,
      n: s.deviceName,
      s: pc.localDescription.sdp,
    });
  }

  async acceptRtcOfferAndCreateAnswer(offerCode) {
    const s = this.getSettings();
    const data = await decodeSignalPayload(offerCode);
    if (data.t !== 'o' || !data.s) throw new Error('Invalid offer code');

    const pc = new RTCPeerConnection(this._buildRtcConfig());
    const peerId = data.id || `rtc-${Math.random().toString(36).slice(2, 8)}`;
    const peerName = data.n || 'Remote Device';

    pc.ondatachannel = (ev) => {
      this._wireDataChannel(ev.channel, pc, peerId, peerName);
    };

    await pc.setRemoteDescription({ type: 'offer', sdp: data.s });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    await waitIceGathering(pc);

    return encodeSignalPayload({
      t: 'a',
      id: this.deviceId,
      n: s.deviceName,
      s: pc.localDescription.sdp,
    });
  }

  async completeRtcWithAnswer(answerCode) {
    if (!this.pendingRtc) throw new Error('No pending WebRTC offer');
    const data = await decodeSignalPayload(answerCode);
    if (data.t !== 'a' || !data.s) throw new Error('Invalid answer code');

    const { pc, dc, remoteId } = this.pendingRtc;
    const peerId = data.id || remoteId;
    if (peerId !== remoteId) {
      this._wireDataChannel(dc, pc, peerId, data.n || 'Remote Device');
    }
    await pc.setRemoteDescription({ type: 'answer', sdp: data.s });
    this.pendingRtc = null;
  }

  // --- 5. Web Bluetooth (BLE) ---
  async scanBluetoothPeer() {
    if (!navigator?.bluetooth) {
      throw new Error('Web Bluetooth is not supported in this browser.');
    }
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [CYCLES_BLE_SERVICE_UUID] }],
      optionalServices: [CYCLES_BLE_SERVICE_UUID],
    });
    const server = await device.gatt.connect();
    const service = await server.getPrimaryService(CYCLES_BLE_SERVICE_UUID);
    const char = await service.getCharacteristic(CYCLES_BLE_CHAR_UUID);

    const peerId = `ble-${device.id}`;
    const peer = {
      id: peerId,
      name: device.name || 'BLE Device',
      transport: 'Bluetooth LE',
      trusted: false,
      sendJson: async (obj) => {
        const bytes = new TextEncoder().encode(JSON.stringify(obj));
        await char.writeValue(bytes);
      },
      sendBinary: async (buf) => {
        const view = new Uint8Array(buf);
        const mtu = 240;
        for (let i = 0; i < view.length; i += mtu) {
          await char.writeValue(view.slice(i, i + mtu));
        }
      },
    };
    this.peers.set(peerId, peer);
    this.emitPeers();
    return peer;
  }
}
