// Zero-RAM streaming file & text transfer protocol with OPFS, Wake Lock, and Pause/Resume/Cancel.

export async function computeSha256Hex(buffer) {
  if (!globalThis.crypto?.subtle) return null;
  try {
    const hash = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatSpeed(bytesPerSec) {
  if (!bytesPerSec || !Number.isFinite(bytesPerSec)) return '0 B/s';
  return `${formatBytes(bytesPerSec)}/s`;
}

// Binary frame layout: [4B magic "CYC1"][16B transferId ASCII][4B chunkIndex u32][payload...]
const MAGIC = [0x43, 0x59, 0x43, 0x31];

export function encodeBinaryChunk(transferId, chunkIndex, payloadBytes) {
  const idBytes = new TextEncoder().encode(transferId.slice(0, 16).padEnd(16, ' '));
  const out = new Uint8Array(24 + payloadBytes.byteLength);
  out.set(MAGIC, 0);
  out.set(idBytes, 4);
  new DataView(out.buffer).setUint32(20, chunkIndex, false);
  out.set(new Uint8Array(payloadBytes), 24);
  return out.buffer;
}

export function decodeBinaryChunk(arrayBuffer) {
  if (arrayBuffer.byteLength < 24) return null;
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < 4; i++) {
    if (view[i] !== MAGIC[i]) return null;
  }
  const transferId = new TextDecoder().decode(view.slice(4, 20)).trim();
  const chunkIndex = new DataView(arrayBuffer).getUint32(20, false);
  const payload = arrayBuffer.slice(24);
  return { transferId, chunkIndex, payload };
}

class WakeLockHelper {
  constructor() {
    this.sentinel = null;
    this.activeCount = 0;
  }

  async acquire() {
    this.activeCount++;
    if (this.sentinel || !navigator?.wakeLock?.request) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      // Ignore if denied or unsupported
    }
  }

  async release() {
    this.activeCount = Math.max(0, this.activeCount - 1);
    if (this.activeCount === 0 && this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignore
      }
      this.sentinel = null;
    }
  }
}

export class TransferSessionManager {
  constructor({ onProgress, onIncomingOffer, onFileReceived, onTextReceived, onError }) {
    this.onProgress = onProgress;
    this.onIncomingOffer = onIncomingOffer;
    this.onFileReceived = onFileReceived;
    this.onTextReceived = onTextReceived;
    this.onError = onError;
    this.incoming = new Map();
    this.outgoingState = new Map(); // id -> { paused, cancelled, resumeResolve }
    this.wakeLock = new WakeLockHelper();
  }

  pauseOutgoing(transferId) {
    const st = this.outgoingState.get(transferId);
    if (st) st.paused = true;
  }

  resumeOutgoing(transferId) {
    const st = this.outgoingState.get(transferId);
    if (st) {
      st.paused = false;
      st.resumeResolve?.();
      st.resumeResolve = null;
    }
  }

  cancelOutgoing(transferId) {
    const st = this.outgoingState.get(transferId);
    if (st) {
      st.cancelled = true;
      st.paused = false;
      st.resumeResolve?.();
    }
  }

  isPaused(transferId) {
    return Boolean(this.outgoingState.get(transferId)?.paused);
  }

  async sendText(peer, text) {
    const id = crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : String(Date.now()).slice(0, 16);
    await peer.sendJson({ type: 'text', id, text, timestamp: Date.now() });
    return id;
  }

  async sendFile(peer, file, settings) {
    const id = crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : `${Date.now()}`.slice(0, 16);
    const chunkSize = (settings.chunkSizeKb || 64) * 1024;
    const totalChunks = Math.max(1, Math.ceil(file.size / chunkSize));

    // Only compute full-file SHA-256 in memory for files <= 64 MB to keep RAM low
    let sha256 = null;
    if (settings.verifyIntegrity && file.size <= 64 * 1024 * 1024) {
      sha256 = await computeSha256Hex(await file.arrayBuffer());
    }

    const state = { paused: false, cancelled: false, resumeResolve: null };
    this.outgoingState.set(id, state);
    await this.wakeLock.acquire();

    try {
      await peer.sendJson({
        type: 'file-offer',
        id,
        name: file.name,
        size: file.size,
        mime: file.type || 'application/octet-stream',
        chunkSize,
        totalChunks,
        sha256,
      });

      const startTime = performance.now();
      let sentBytes = 0;

      for (let i = 0; i < totalChunks; i++) {
        while (state.paused && !state.cancelled) {
          this.onProgress?.({
            id,
            direction: 'out',
            name: file.name,
            transferred: sentBytes,
            total: file.size,
            speed: 0,
            paused: true,
            peerName: peer.name,
            done: false,
          });
          await new Promise((resolve) => {
            state.resumeResolve = resolve;
          });
        }

        if (state.cancelled) {
          await peer.sendJson({ type: 'file-cancel', id });
          this.onProgress?.({
            id,
            direction: 'out',
            name: file.name,
            transferred: sentBytes,
            total: file.size,
            speed: 0,
            cancelled: true,
            peerName: peer.name,
            done: true,
          });
          return;
        }

        const start = i * chunkSize;
        const end = Math.min(file.size, start + chunkSize);
        const sliceBuf = await file.slice(start, end).arrayBuffer();
        const frame = encodeBinaryChunk(id, i, sliceBuf);
        await peer.sendBinary(frame, i);

        sentBytes += sliceBuf.byteLength;
        const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
        this.onProgress?.({
          id,
          direction: 'out',
          name: file.name,
          transferred: sentBytes,
          total: file.size,
          speed: sentBytes / elapsedSec,
          paused: false,
          peerName: peer.name,
          done: i === totalChunks - 1,
        });
      }

      await peer.sendJson({ type: 'file-complete', id });
    } finally {
      this.outgoingState.delete(id);
      await this.wakeLock.release();
    }
  }

  async _openOpfsWritable(id) {
    if (!navigator?.storage?.getDirectory) return null;
    try {
      const root = await navigator.storage.getDirectory();
      const fileHandle = await root.getFileHandle(`cyc-${id}.part`, { create: true });
      if (!fileHandle.createWritable) return null;
      const writable = await fileHandle.createWritable();
      return { root, fileHandle, writable, name: `cyc-${id}.part` };
    } catch {
      return null;
    }
  }

  async handleMessage(peer, data, settings) {
    if (typeof data === 'string') {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      if (msg.type === 'text') {
        this.onTextReceived?.({
          id: msg.id,
          text: msg.text,
          peerName: peer.name,
          timestamp: msg.timestamp || Date.now(),
        });
        return;
      }

      if (msg.type === 'file-offer') {
        const entry = {
          id: msg.id,
          name: msg.name,
          size: msg.size,
          mime: msg.mime,
          chunkSize: msg.chunkSize || 64 * 1024,
          totalChunks: msg.totalChunks,
          sha256: msg.sha256,
          chunks: [],
          opfs: null,
          writeChain: Promise.resolve(),
          receivedBytes: 0,
          startTime: performance.now(),
          accepted: Boolean(settings.autoAcceptTrusted && peer.trusted),
          peer,
        };
        this.incoming.set(msg.id, entry);

        if (!entry.accepted) {
          const allow = await this.onIncomingOffer?.({
            id: msg.id,
            name: msg.name,
            size: msg.size,
            peerName: peer.name,
          });
          entry.accepted = Boolean(allow);
          if (!entry.accepted) {
            this.incoming.delete(msg.id);
            return;
          }
        }

        await this.wakeLock.acquire();
        entry.opfs = await this._openOpfsWritable(msg.id);
        if (!entry.opfs) {
          entry.chunks = new Array(msg.totalChunks);
        }
        return;
      }

      if (msg.type === 'file-cancel') {
        const entry = this.incoming.get(msg.id);
        this.incoming.delete(msg.id);
        if (entry?.opfs) {
          try {
            await entry.opfs.writable.abort();
            await entry.opfs.root.removeEntry(entry.opfs.name);
          } catch {
            // Ignore cleanup errors
          }
        }
        await this.wakeLock.release();
        return;
      }

      if (msg.type === 'file-complete') {
        const entry = this.incoming.get(msg.id);
        if (!entry || !entry.accepted) return;
        this.incoming.delete(msg.id);

        try {
          let blob;
          if (entry.opfs) {
            await entry.writeChain;
            await entry.opfs.writable.close();
            const file = await entry.opfs.fileHandle.getFile();
            blob = new Blob([file], { type: entry.mime });
            try {
              await entry.opfs.root.removeEntry(entry.opfs.name);
            } catch {
              // Ignore
            }
          } else {
            blob = new Blob(entry.chunks, { type: entry.mime });
          }

          let verified = null;
          if (entry.sha256 && settings.verifyIntegrity && entry.size <= 64 * 1024 * 1024) {
            const actual = await computeSha256Hex(await blob.arrayBuffer());
            verified = actual ? actual === entry.sha256 : null;
          }

          this.onFileReceived?.({
            id: entry.id,
            name: entry.name,
            size: entry.size,
            blob,
            verified,
            peerName: peer.name,
          });
        } finally {
          await this.wakeLock.release();
        }
      }
      return;
    }

    const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer?.();
    if (!buf) return;
    const chunk = decodeBinaryChunk(buf);
    if (!chunk) return;

    const entry = this.incoming.get(chunk.transferId);
    if (!entry || !entry.accepted) return;

    if (entry.opfs) {
      const payload = chunk.payload;
      const pos = chunk.chunkIndex * entry.chunkSize;
      entry.writeChain = entry.writeChain.then(() =>
        entry.opfs.writable.write({ type: 'write', position: pos, data: payload })
      );
    } else {
      entry.chunks[chunk.chunkIndex] = chunk.payload;
    }

    entry.receivedBytes += chunk.payload.byteLength;
    const elapsedSec = Math.max(0.001, (performance.now() - entry.startTime) / 1000);

    this.onProgress?.({
      id: entry.id,
      direction: 'in',
      name: entry.name,
      transferred: entry.receivedBytes,
      total: entry.size,
      speed: entry.receivedBytes / elapsedSec,
      peerName: peer.name,
      done: false,
    });
  }
}
