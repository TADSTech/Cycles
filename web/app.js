import { formatBytes, formatSpeed, TransferSessionManager } from './transfer.js';
import { TransportManager } from './transports.js';

const STORAGE_KEY = 'cycles.settings.v1';

const DEFAULT_SETTINGS = {
  deviceName: `Device-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  chunkSizeKb: 64,
  verifyIntegrity: true,
  autoAcceptTrusted: true,
  lanOnlyIce: false,
  stunUrl: 'stun:stun.l.google.com:19302',
  signalingUrl: '',
  transports: {
    broadcast: true,
    wsSignaling: true,
  },
};

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      transports: { ...DEFAULT_SETTINGS.transports, ...(parsed.transports || {}) },
    };
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

let settings = loadSettings();
const deviceId = `cyc-${Math.random().toString(36).slice(2, 10)}`;
let currentPeers = [];
let lanDiscovered = [];
let selectedPeerId = null;
const queuedFiles = [];
const transferItems = new Map();

// DOM refs
const deviceBadge = document.getElementById('device-badge');
const transportBar = document.getElementById('transport-bar');
const peerList = document.getElementById('peer-list');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileList = document.getElementById('file-list');
const transferList = document.getElementById('transfer-list');
const textInput = document.getElementById('text-input');
const btnSendText = document.getElementById('btn-send-text');
const btnSendFiles = document.getElementById('btn-send-files');
const toastEl = document.getElementById('toast');
const pairModal = document.getElementById('modal-pair');
const pairStatus = document.getElementById('pair-status');

let toastTimer = null;
function showToast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2600);
}

// Custom Incoming Prompt Modal
function askIncomingFile({ name, size, peerName }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('modal-incoming');
    const desc = document.getElementById('incoming-desc');
    const acceptBtn = document.getElementById('btn-incoming-accept');
    const rejectBtn = document.getElementById('btn-incoming-reject');
    desc.textContent = `${peerName} wants to send "${name}" (${formatBytes(size)}).`;
    modal.classList.remove('hidden');

    const cleanup = (result) => {
      modal.classList.add('hidden');
      acceptBtn.onclick = null;
      rejectBtn.onclick = null;
      resolve(result);
    };
    acceptBtn.onclick = () => cleanup(true);
    rejectBtn.onclick = () => cleanup(false);
  });
}

const transferMgr = new TransferSessionManager({
  onProgress: (info) => {
    transferItems.set(info.id, { kind: 'progress', ...info });
    renderTransfers();
  },
  onIncomingOffer: (offer) => askIncomingFile(offer),
  onFileReceived: ({ id, name, size, blob, verified, peerName }) => {
    const url = URL.createObjectURL(blob);
    transferItems.set(id, { kind: 'file', id, name, size, url, verified, peerName });
    renderTransfers();
    showToast(`Received ${name}`);
  },
  onTextReceived: ({ id, text, peerName }) => {
    transferItems.set(id, { kind: 'text', id, text, peerName });
    renderTransfers();
    showToast(`Text received from ${peerName}`);
  },
  onError: (err) => showToast(err.message || 'Transfer error'),
});

const transportMgr = new TransportManager({
  deviceId,
  getSettings: () => settings,
  onPeersChanged: (peers, discovered) => {
    currentPeers = peers;
    lanDiscovered = discovered || [];
    if (!peers.some((p) => p.id === selectedPeerId)) {
      selectedPeerId = peers[0]?.id || null;
    }
    renderPeers();
    updateSendButtons();
  },
  onMessage: (peer, data) => transferMgr.handleMessage(peer, data, settings),
  onRoomEvent: (ev) => {
    if (ev.type === 'ws-status') {
      renderCapabilities();
      const autoJoin = new URLSearchParams(location.search).get('join');
      if (ev.connected && autoJoin) {
        history.replaceState(null, '', location.pathname);
        try {
          transportMgr.joinRoomCode(autoJoin);
          showToast(`Joining room ${autoJoin}...`);
        } catch (err) {
          showToast(err.message);
        }
      }
    } else if (ev.type === 'room-created') {
      const display = document.getElementById('room-code-display');
      const qrBox = document.getElementById('room-qr');
      display.textContent = `${ev.code.slice(0, 4)}-${ev.code.slice(4)}`;
      display.classList.remove('hidden');
      const joinUrl = `${location.origin}${location.pathname}?join=${ev.code}`;
      try {
        qrBox.innerHTML = QR.toSvg(joinUrl, 180);
        qrBox.classList.remove('hidden');
      } catch {
        qrBox.classList.add('hidden');
      }
      pairStatus.textContent = 'Waiting for other device to enter or scan code...';
    } else if (ev.type === 'room-joined') {
      pairStatus.textContent = `Handshaking with ${ev.hostName}...`;
    } else if (ev.type === 'room-error') {
      pairStatus.textContent = ev.message;
      showToast(ev.message);
    } else if (ev.type === 'connected') {
      stopQrScan();
      pairModal.classList.add('hidden');
      showToast(`Connected to ${ev.peer.name}`);
    }
  },
});

function renderCapabilities() {
  deviceBadge.textContent = settings.deviceName;
  const caps = transportMgr.getCapabilities();
  const chips = [
    ['Auto-Broker', caps.wsBroker],
    ['WebRTC P2P', caps.webrtc],
    ['Tab Mesh', caps.broadcastChannel && settings.transports.broadcast],
    ['Web Bluetooth', caps.webBluetooth],
    [settings.lanOnlyIce ? 'LAN-Only ICE' : 'STUN Enabled', true],
  ];
  transportBar.innerHTML = '';
  for (const [label, on] of chips) {
    const span = document.createElement('span');
    span.className = `cap-chip ${on ? 'on' : ''}`;
    span.textContent = `${on ? '●' : '○'} ${label}`;
    transportBar.appendChild(span);
  }
}

function renderPeers() {
  const connectedIds = new Set(currentPeers.map((p) => p.id));
  const availableLan = lanDiscovered.filter((p) => !connectedIds.has(p.id));

  if (currentPeers.length === 0 && availableLan.length === 0) {
    peerList.innerHTML = '<li class="empty">No peers yet. Click + Pair Device or open on another device.</li>';
    return;
  }
  peerList.innerHTML = '';

  for (const peer of currentPeers) {
    const li = document.createElement('li');
    li.className = `peer-item ${peer.id === selectedPeerId ? 'selected' : ''}`;
    li.onclick = () => {
      selectedPeerId = peer.id;
      renderPeers();
      updateSendButtons();
    };

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const title = document.createElement('strong');
    title.textContent = peer.name;
    const sub = document.createElement('span');
    sub.className = 'peer-sub';
    sub.textContent = `${peer.transport}${peer.trusted ? ' · Trusted' : ''}`;
    meta.append(title, sub);

    const trustBtn = document.createElement('button');
    trustBtn.type = 'button';
    trustBtn.className = 'btn btn-xs';
    trustBtn.textContent = peer.trusted ? 'Trusted' : 'Trust';
    trustBtn.onclick = (e) => {
      e.stopPropagation();
      transportMgr.setPeerTrusted(peer.id, !peer.trusted);
    };

    li.append(meta, trustBtn);
    peerList.appendChild(li);
  }

  for (const lanPeer of availableLan) {
    const li = document.createElement('li');
    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const title = document.createElement('strong');
    title.textContent = lanPeer.name;
    const sub = document.createElement('span');
    sub.className = 'peer-sub';
    sub.textContent = 'Nearby on same network';
    meta.append(title, sub);

    const connBtn = document.createElement('button');
    connBtn.type = 'button';
    connBtn.className = 'btn btn-primary btn-xs';
    connBtn.textContent = 'Connect';
    connBtn.onclick = () => transportMgr.connectToLanPeer(lanPeer.id, lanPeer.name);

    li.append(meta, connBtn);
    peerList.appendChild(li);
  }
}

function renderQueue() {
  if (queuedFiles.length === 0) {
    fileList.innerHTML = '<li class="empty">No files queued yet.</li>';
    updateSendButtons();
    return;
  }
  fileList.innerHTML = '';
  queuedFiles.forEach((file, idx) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${file.name} (${formatBytes(file.size)})`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-xs btn-ghost';
    rm.textContent = 'Remove';
    rm.onclick = () => {
      queuedFiles.splice(idx, 1);
      renderQueue();
    };
    li.append(name, rm);
    fileList.appendChild(li);
  });
  updateSendButtons();
}

function renderTransfers() {
  const items = Array.from(transferItems.values()).reverse();
  if (items.length === 0) {
    transferList.innerHTML = '<li class="empty">No transfers yet.</li>';
    return;
  }
  transferList.innerHTML = '';
  for (const item of items) {
    const li = document.createElement('li');
    if (item.kind === 'progress') {
      const wrap = document.createElement('div');
      wrap.className = 'progress-wrap';
      const pct = item.total ? Math.min(100, Math.round((item.transferred / item.total) * 100)) : 100;
      const top = document.createElement('span');
      top.textContent = `${item.direction === 'out' ? '↑' : '↓'} ${item.name} · ${pct}% (${formatSpeed(item.speed)})`;
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      wrap.append(top, bar);
      li.appendChild(wrap);
    } else if (item.kind === 'file') {
      const info = document.createElement('span');
      const badge = item.verified === true ? ' · SHA-256 OK' : item.verified === false ? ' · Hash Mismatch' : '';
      info.textContent = `↓ ${item.name} (${formatBytes(item.size)})${badge}`;
      const dl = document.createElement('a');
      dl.href = item.url;
      dl.download = item.name;
      dl.className = 'btn btn-primary btn-xs';
      dl.textContent = 'Save';
      li.append(info, dl);
    } else if (item.kind === 'text') {
      const info = document.createElement('span');
      info.textContent = `${item.peerName}: ${item.text}`;
      const cp = document.createElement('button');
      cp.type = 'button';
      cp.className = 'btn btn-xs';
      cp.textContent = 'Copy';
      cp.onclick = async () => {
        await navigator.clipboard?.writeText(item.text);
        showToast('Copied to clipboard');
      };
      li.append(info, cp);
    }
    transferList.appendChild(li);
  }
}

function updateSendButtons() {
  const hasPeer = currentPeers.some((p) => p.id === selectedPeerId);
  btnSendFiles.disabled = !(hasPeer && queuedFiles.length > 0);
  btnSendText.disabled = !hasPeer;
}

function getSelectedPeer() {
  return currentPeers.find((p) => p.id === selectedPeerId) || null;
}

function addFiles(files) {
  for (const f of files) queuedFiles.push(f);
  renderQueue();
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', (e) => {
  if (e.target.files.length) addFiles(e.target.files);
  fileInput.value = '';
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('active');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('active');
  if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
});

btnSendFiles.addEventListener('click', async () => {
  const peer = getSelectedPeer();
  if (!peer || queuedFiles.length === 0) return;
  const batch = queuedFiles.splice(0, queuedFiles.length);
  renderQueue();
  for (const file of batch) {
    try {
      await transferMgr.sendFile(peer, file, settings);
      showToast(`Sent ${file.name}`);
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
  }
});

btnSendText.addEventListener('click', async () => {
  const peer = getSelectedPeer();
  const txt = textInput.value.trim();
  if (!peer || !txt) return;
  try {
    await transferMgr.sendText(peer, txt);
    textInput.value = '';
    showToast('Text sent');
  } catch (err) {
    showToast(`Failed: ${err.message}`);
  }
});

document.getElementById('btn-ble-scan').addEventListener('click', async () => {
  try {
    const peer = await transportMgr.scanBluetoothPeer();
    showToast(`Connected BLE: ${peer.name}`);
  } catch (err) {
    showToast(err.message);
  }
});

// Modal helpers
document.querySelectorAll('[data-close]').forEach((btn) => {
  btn.addEventListener('click', () => {
    stopQrScan();
    document.getElementById(btn.dataset.close).classList.add('hidden');
  });
});

// Built-in QR Scanner
const scannerWrap = document.getElementById('qr-scanner-wrap');
const qrVideo = document.getElementById('qr-video');
let scanStream = null;
let scanRaf = null;

function stopQrScan() {
  if (scanRaf) {
    cancelAnimationFrame(scanRaf);
    scanRaf = null;
  }
  if (scanStream) {
    scanStream.getTracks().forEach((t) => t.stop());
    scanStream = null;
  }
  qrVideo.srcObject = null;
  scannerWrap.classList.add('hidden');
}

function extractJoinCode(raw) {
  try {
    const u = new URL(raw);
    const code = u.searchParams.get('join');
    if (code) return code.replace(/[^A-Z0-9]/gi, '').toUpperCase();
  } catch {
    // Not a URL
  }
  return raw.replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 8);
}

async function startQrScan(onDetected) {
  stopQrScan();
  if (!('BarcodeDetector' in window)) {
    pairStatus.textContent = 'Live QR scan requires Chrome/Edge/Android. Enter the 6-digit code instead.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    pairStatus.textContent = 'Live camera requires HTTPS or localhost. Use "Scan from Photo" or type the 6-digit code.';
    return;
  }
  try {
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    scanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
    qrVideo.srcObject = scanStream;
    await qrVideo.play();
    scannerWrap.classList.remove('hidden');
    pairStatus.textContent = 'Point camera at QR code...';

    const tick = async () => {
      if (!scanStream) return;
      try {
        const codes = await detector.detect(qrVideo);
        if (codes.length > 0 && codes[0].rawValue) {
          const val = codes[0].rawValue;
          stopQrScan();
          onDetected(val);
          return;
        }
      } catch {
        // Ignore single-frame error
      }
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  } catch (err) {
    stopQrScan();
    pairStatus.textContent = `Camera unavailable (${err.message}). Type the 6-digit code.`;
  }
}

document.getElementById('btn-stop-scan').addEventListener('click', () => {
  stopQrScan();
  pairStatus.textContent = '';
});

document.getElementById('btn-scan-room').addEventListener('click', () => {
  startQrScan((raw) => {
    const code = extractJoinCode(raw);
    if (code.length >= 6) {
      document.getElementById('room-code-in').value = code;
      document.getElementById('btn-join-room').click();
    } else {
      pairStatus.textContent = 'Invalid QR code.';
    }
  });
});

document.getElementById('qr-file-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  if (!('BarcodeDetector' in window)) {
    pairStatus.textContent = 'QR decoding requires Chrome/Edge/Android. Type the 6-digit code.';
    return;
  }
  try {
    const bmp = await createImageBitmap(file);
    const detector = new BarcodeDetector({ formats: ['qr_code'] });
    const codes = await detector.detect(bmp);
    bmp.close?.();
    if (codes.length > 0 && codes[0].rawValue) {
      const code = extractJoinCode(codes[0].rawValue);
      document.getElementById('room-code-in').value = code;
      document.getElementById('btn-join-room').click();
    } else {
      pairStatus.textContent = 'No QR code found in photo.';
    }
  } catch (err) {
    pairStatus.textContent = `Could not decode image: ${err.message}`;
  }
});

// Pair Modal logic
document.getElementById('btn-pair').addEventListener('click', () => {
  pairStatus.textContent = '';
  pairModal.classList.remove('hidden');
});

document.querySelectorAll('[data-pair-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    stopQrScan();
    document.querySelectorAll('[data-pair-tab]').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const isHost = tab.dataset.pairTab === 'host';
    document.getElementById('pair-host-pane').classList.toggle('hidden', !isHost);
    document.getElementById('pair-join-pane').classList.toggle('hidden', isHost);
  });
});

document.getElementById('btn-create-room').addEventListener('click', () => {
  try {
    transportMgr.createRoomCode();
  } catch (err) {
    pairStatus.textContent = err.message;
  }
});

document.getElementById('btn-join-room').addEventListener('click', () => {
  try {
    transportMgr.joinRoomCode(document.getElementById('room-code-in').value);
  } catch (err) {
    pairStatus.textContent = err.message;
  }
});

// Offline Manual SDP Fallback
document.getElementById('btn-create-offer').addEventListener('click', async () => {
  pairStatus.textContent = 'Creating offline offer...';
  const code = await transportMgr.createRtcOfferCode();
  const out = document.getElementById('offer-out');
  out.value = code;
  out.classList.remove('hidden');
  document.getElementById('answer-in').classList.remove('hidden');
  document.getElementById('btn-complete-answer').classList.remove('hidden');
  pairStatus.textContent = 'Offline offer ready.';
});

document.getElementById('btn-complete-answer').addEventListener('click', async () => {
  try {
    await transportMgr.completeRtcWithAnswer(document.getElementById('answer-in').value);
  } catch (err) {
    pairStatus.textContent = err.message;
  }
});

document.getElementById('btn-accept-offer').addEventListener('click', async () => {
  try {
    const ans = await transportMgr.acceptRtcOfferAndCreateAnswer(document.getElementById('offer-in').value);
    const out = document.getElementById('answer-out');
    out.value = ans;
    out.classList.remove('hidden');
    pairStatus.textContent = 'Offline answer ready. Copy back to host.';
  } catch (err) {
    pairStatus.textContent = err.message;
  }
});

// Settings Modal logic
const settingsModal = document.getElementById('modal-settings');
function syncSettingsForm() {
  document.getElementById('set-name').value = settings.deviceName;
  document.getElementById('set-chunk').value = String(settings.chunkSizeKb);
  document.getElementById('set-integrity').checked = settings.verifyIntegrity;
  document.getElementById('set-auto-accept').checked = settings.autoAcceptTrusted;
  document.getElementById('set-lan-only').checked = settings.lanOnlyIce;
  document.getElementById('set-stun').value = settings.stunUrl;
  document.getElementById('set-tr-broadcast').checked = settings.transports.broadcast;
  document.getElementById('set-tr-ws').checked = settings.transports.wsSignaling;
  document.getElementById('set-ws-url').value = settings.signalingUrl;
}

document.getElementById('btn-settings').addEventListener('click', () => {
  syncSettingsForm();
  settingsModal.classList.remove('hidden');
});

document.getElementById('settings-form').addEventListener('submit', (e) => {
  e.preventDefault();
  settings = {
    deviceName: document.getElementById('set-name').value.trim() || DEFAULT_SETTINGS.deviceName,
    chunkSizeKb: Number(document.getElementById('set-chunk').value) || 64,
    verifyIntegrity: document.getElementById('set-integrity').checked,
    autoAcceptTrusted: document.getElementById('set-auto-accept').checked,
    lanOnlyIce: document.getElementById('set-lan-only').checked,
    stunUrl: document.getElementById('set-stun').value.trim(),
    signalingUrl: document.getElementById('set-ws-url').value.trim(),
    transports: {
      broadcast: document.getElementById('set-tr-broadcast').checked,
      wsSignaling: document.getElementById('set-tr-ws').checked,
    },
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  settingsModal.classList.add('hidden');
  renderCapabilities();
  transportMgr.restart();
  showToast('Settings saved');
});

document.getElementById('btn-reset-settings').addEventListener('click', () => {
  settings = structuredClone(DEFAULT_SETTINGS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  syncSettingsForm();
  renderCapabilities();
  transportMgr.restart();
  showToast('Defaults restored');
});

// Boot
renderCapabilities();
transportMgr.start();
updateSendButtons();
