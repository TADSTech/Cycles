import { formatBytes, formatSpeed, TransferSessionManager } from './transfer.js';
import { TransportManager } from './transports.js';
import { buildZipFile } from './zip.js';

const STORAGE_KEY = 'cycles.settings.v1';
const DEVICE_ID_KEY = 'cycles.deviceId.v1';

const DEFAULT_SETTINGS = {
  deviceName: `Device-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
  chunkSizeKb: 64,
  parallelChannels: 2,
  verifyIntegrity: true,
  autoAcceptTrusted: true,
  autoReconnectTrusted: true,
  soundAndHaptics: true,
  lanOnlyIce: false,
  stunUrl: 'stun:stun.l.google.com:19302',
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  signalingUrl: '',
  transports: {
    broadcast: true,
    wsSignaling: true,
  },
};

function getPersistentDeviceId() {
  try {
    let id = localStorage.getItem(DEVICE_ID_KEY);
    if (!id) {
      id = `cyc-${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(DEVICE_ID_KEY, id);
    }
    return id;
  } catch {
    return `cyc-${Math.random().toString(36).slice(2, 10)}`;
  }
}

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
const deviceId = getPersistentDeviceId();
let currentPeers = [];
let lanDiscovered = [];
let selectedPeerId = null;
let autoSendOnNextConnect = false;
const queuedEntries = []; // Array<{ file: File, path: string }>
const transferItems = new Map();

// DOM refs
const deviceBadge = document.getElementById('device-badge');
const peerList = document.getElementById('peer-list');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const folderInput = document.getElementById('folder-input');
const fileList = document.getElementById('file-list');
const transferList = document.getElementById('transfer-list');
const textInput = document.getElementById('text-input');
const btnSendText = document.getElementById('btn-send-text');
const btnSendFiles = document.getElementById('btn-send-files');
const btnSendZip = document.getElementById('btn-send-zip');
const btnShareLink = document.getElementById('btn-share-link');
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

function playArrivalFeedback() {
  if (!settings.soundAndHaptics) return;
  try {
    navigator.vibrate?.([40, 30, 60]);
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(660, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.12);
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.19);
  } catch {
    // Ignore autoplay restrictions
  }
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
    playArrivalFeedback();
    showToast(`Received ${name}`);
  },
  onTextReceived: ({ id, text, peerName }) => {
    transferItems.set(id, { kind: 'text', id, text, peerName });
    renderTransfers();
    playArrivalFeedback();
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
  onRoomEvent: async (ev) => {
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
      if (autoSendOnNextConnect) {
        navigator.clipboard?.writeText(joinUrl).catch(() => {});
        pairStatus.textContent = 'Instant Link copied! Queued files will auto-send when opened.';
      } else {
        pairStatus.textContent = 'Waiting for other device to enter or scan code...';
      }
    } else if (ev.type === 'room-joined') {
      pairStatus.textContent = `Handshaking with ${ev.hostName}...`;
    } else if (ev.type === 'room-error') {
      pairStatus.textContent = ev.message;
      showToast(ev.message);
    } else if (ev.type === 'connected') {
      stopQrScan();
      pairModal.classList.add('hidden');
      showToast(`Connected to ${ev.peer.name}`);
      if (autoSendOnNextConnect && queuedEntries.length > 0) {
        autoSendOnNextConnect = false;
        await sendBatchToPeer(ev.peer, queuedEntries.splice(0, queuedEntries.length));
        renderQueue();
      }
    }
  },
});

function renderCapabilities() {
  deviceBadge.textContent = settings.deviceName;
}

async function sendBatchToPeer(peer, entries) {
  for (const { file } of entries) {
    try {
      await transferMgr.sendFile(peer, file, settings);
      showToast(`Sent ${file.name}`);
    } catch (err) {
      showToast(`Failed: ${err.message}`);
    }
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

    // Drag-onto-Peer Card to send immediately
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      li.classList.remove('drop-target');
      const dropped = await collectDroppedEntries(e.dataTransfer);
      if (dropped.length > 0) {
        await sendBatchToPeer(peer, dropped);
      }
    });

    const meta = document.createElement('div');
    meta.className = 'peer-meta';
    const title = document.createElement('span');
    title.className = 'card-title';
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
    const title = document.createElement('span');
    title.className = 'card-title';
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
  if (queuedEntries.length === 0) {
    fileList.innerHTML = '<li class="empty">No files queued yet.</li>';
    updateSendButtons();
    return;
  }
  fileList.innerHTML = '';
  queuedEntries.forEach(({ file, path }, idx) => {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = `${path} (${formatBytes(file.size)})`;
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'btn btn-xs btn-ghost';
    rm.textContent = 'Remove';
    rm.onclick = () => {
      queuedEntries.splice(idx, 1);
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
      const statusSuffix = item.cancelled ? ' · Cancelled' : item.paused ? ' · Paused' : ` · ${pct}% (${formatSpeed(item.speed)})`;
      const top = document.createElement('span');
      top.textContent = `${item.direction === 'out' ? '↑' : '↓'} ${item.name}${statusSuffix}`;
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      const fill = document.createElement('div');
      fill.className = 'progress-fill';
      fill.style.width = `${pct}%`;
      bar.appendChild(fill);
      wrap.append(top, bar);
      li.appendChild(wrap);

      if (item.direction === 'out' && !item.done && !item.cancelled) {
        const ctrlWrap = document.createElement('div');
        ctrlWrap.className = 'row-actions';
        const pauseBtn = document.createElement('button');
        pauseBtn.type = 'button';
        pauseBtn.className = 'btn btn-xs';
        pauseBtn.textContent = item.paused ? 'Resume' : 'Pause';
        pauseBtn.onclick = () => {
          if (transferMgr.isPaused(item.id)) transferMgr.resumeOutgoing(item.id);
          else transferMgr.pauseOutgoing(item.id);
        };
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'btn btn-xs btn-ghost';
        cancelBtn.textContent = 'Cancel';
        cancelBtn.onclick = () => transferMgr.cancelOutgoing(item.id);
        ctrlWrap.append(pauseBtn, cancelBtn);
        li.appendChild(ctrlWrap);
      }
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
  const hasFiles = queuedEntries.length > 0;
  btnSendFiles.disabled = !(hasPeer && hasFiles);
  btnSendZip.disabled = !(hasPeer && hasFiles);
  btnShareLink.disabled = !(hasFiles && transportMgr.wsConnected);
  btnSendText.disabled = !hasPeer;
}

function getSelectedPeer() {
  return currentPeers.find((p) => p.id === selectedPeerId) || null;
}

function addFiles(files) {
  for (const f of files) {
    queuedEntries.push({ file: f, path: f.webkitRelativePath || f.name });
  }
  renderQueue();
}

async function readEntryRecursive(entry, prefix = '') {
  if (entry.isFile) {
    return new Promise((resolve) => {
      entry.file((file) => resolve([{ file, path: `${prefix}${file.name}` }]), () => resolve([]));
    });
  }
  if (entry.isDirectory) {
    const reader = entry.createReader();
    const all = [];
    const readBatch = () => new Promise((resolve) => reader.readEntries(resolve, () => resolve([])));
    let batch = await readBatch();
    while (batch.length > 0) {
      for (const child of batch) {
        const sub = await readEntryRecursive(child, `${prefix}${entry.name}/`);
        all.push(...sub);
      }
      batch = await readBatch();
    }
    return all;
  }
  return [];
}

async function collectDroppedEntries(dataTransfer) {
  const items = Array.from(dataTransfer?.items || []);
  const entries = items.map((it) => it.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length > 0) {
    const out = [];
    for (const ent of entries) {
      out.push(...(await readEntryRecursive(ent)));
    }
    return out;
  }
  return Array.from(dataTransfer?.files || []).map((file) => ({ file, path: file.name }));
}

document.getElementById('btn-pick-folder').addEventListener('click', (e) => {
  e.stopPropagation();
  folderInput.click();
});

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
folderInput.addEventListener('change', (e) => {
  if (e.target.files.length) addFiles(e.target.files);
  folderInput.value = '';
});
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('active');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('active'));
dropZone.addEventListener('drop', async (e) => {
  e.preventDefault();
  dropZone.classList.remove('active');
  const dropped = await collectDroppedEntries(e.dataTransfer);
  if (dropped.length) {
    queuedEntries.push(...dropped);
    renderQueue();
  }
});

btnSendFiles.addEventListener('click', async () => {
  const peer = getSelectedPeer();
  if (!peer || queuedEntries.length === 0) return;
  const batch = queuedEntries.splice(0, queuedEntries.length);
  renderQueue();
  await sendBatchToPeer(peer, batch);
});

btnSendZip.addEventListener('click', async () => {
  const peer = getSelectedPeer();
  if (!peer || queuedEntries.length === 0) return;
  const batch = queuedEntries.splice(0, queuedEntries.length);
  renderQueue();
  showToast('Packing ZIP...');
  const zipFile = await buildZipFile(batch, `cycles2-${Date.now()}.zip`);
  await sendBatchToPeer(peer, [{ file: zipFile, path: zipFile.name }]);
});

btnShareLink.addEventListener('click', () => {
  if (queuedEntries.length === 0) return;
  autoSendOnNextConnect = true;
  pairStatus.textContent = '';
  pairModal.classList.remove('hidden');
  try {
    transportMgr.createRoomCode();
  } catch (err) {
    pairStatus.textContent = err.message;
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
    pairStatus.textContent = 'Live QR scan requires Chrome/Edge/Android. Enter the code instead.';
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    pairStatus.textContent = 'Live camera requires HTTPS or localhost. Use "Scan from Photo" or type the code.';
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
        // Ignore
      }
      scanRaf = requestAnimationFrame(tick);
    };
    scanRaf = requestAnimationFrame(tick);
  } catch (err) {
    stopQrScan();
    pairStatus.textContent = `Camera unavailable (${err.message}). Type the code.`;
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
    pairStatus.textContent = 'QR decoding requires Chrome/Edge/Android. Type the code.';
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
  autoSendOnNextConnect = false;
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
  document.getElementById('set-parallel').value = String(settings.parallelChannels);
  document.getElementById('set-integrity').checked = settings.verifyIntegrity;
  document.getElementById('set-auto-accept').checked = settings.autoAcceptTrusted;
  document.getElementById('set-auto-reconnect').checked = settings.autoReconnectTrusted;
  document.getElementById('set-sound').checked = settings.soundAndHaptics;
  document.getElementById('set-lan-only').checked = settings.lanOnlyIce;
  document.getElementById('set-stun').value = settings.stunUrl;
  document.getElementById('set-turn-url').value = settings.turnUrl;
  document.getElementById('set-turn-user').value = settings.turnUser;
  document.getElementById('set-turn-pass').value = settings.turnPass;
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
    parallelChannels: Number(document.getElementById('set-parallel').value) || 2,
    verifyIntegrity: document.getElementById('set-integrity').checked,
    autoAcceptTrusted: document.getElementById('set-auto-accept').checked,
    autoReconnectTrusted: document.getElementById('set-auto-reconnect').checked,
    soundAndHaptics: document.getElementById('set-sound').checked,
    lanOnlyIce: document.getElementById('set-lan-only').checked,
    stunUrl: document.getElementById('set-stun').value.trim(),
    turnUrl: document.getElementById('set-turn-url').value.trim(),
    turnUser: document.getElementById('set-turn-user').value.trim(),
    turnPass: document.getElementById('set-turn-pass').value,
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

// PWA Service Worker + Web Share Target intake
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('message', (ev) => {
    if (ev.data?.type === 'shared-intake') {
      if (ev.data.files?.length) addFiles(ev.data.files);
      if (ev.data.text) textInput.value = ev.data.text;
      showToast('Imported shared items');
    }
  });
}

// Boot
renderCapabilities();
transportMgr.start();
updateSendButtons();
