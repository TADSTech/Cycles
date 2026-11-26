// Chunked file & text transfer protocol with optional SHA-256 integrity.

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

// Binary frame layout: [4B magic "CYC1"][16B transferId ASCII/UTF8 padded][4B chunkIndex u32][payload...]
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

export class TransferSessionManager {
  constructor({ onProgress, onIncomingOffer, onFileReceived, onTextReceived, onError }) {
    this.onProgress = onProgress;
    this.onIncomingOffer = onIncomingOffer;
    this.onFileReceived = onFileReceived;
    this.onTextReceived = onTextReceived;
    this.onError = onError;
    this.incoming = new Map();
    this.outgoingCancelled = new Set();
  }

  cancelOutgoing(transferId) {
    this.outgoingCancelled.add(transferId);
  }

  async sendText(peer, text) {
    const id = crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : String(Date.now()).slice(0, 16);
    await peer.sendJson({
      type: 'text',
      id,
      text,
      timestamp: Date.now(),
    });
    return id;
  }

  async sendFile(peer, file, settings) {
    const id = crypto.randomUUID ? crypto.randomUUID().slice(0, 16) : `${Date.now()}`.slice(0, 16);
    const chunkSize = (settings.chunkSizeKb || 64) * 1024;
    const buffer = await file.arrayBuffer();
    const sha256 = settings.verifyIntegrity ? await computeSha256Hex(buffer) : null;
    const totalChunks = Math.max(1, Math.ceil(buffer.byteLength / chunkSize));

    await peer.sendJson({
      type: 'file-offer',
      id,
      name: file.name,
      size: file.size,
      mime: file.type || 'application/octet-stream',
      totalChunks,
      sha256,
    });

    const startTime = performance.now();
    let sentBytes = 0;

    for (let i = 0; i < totalChunks; i++) {
      if (this.outgoingCancelled.has(id)) {
        this.outgoingCancelled.delete(id);
        await peer.sendJson({ type: 'file-cancel', id });
        return;
      }
      const start = i * chunkSize;
      const end = Math.min(buffer.byteLength, start + chunkSize);
      const slice = buffer.slice(start, end);
      const frame = encodeBinaryChunk(id, i, slice);
      await peer.sendBinary(frame);

      sentBytes += slice.byteLength;
      const elapsedSec = Math.max(0.001, (performance.now() - startTime) / 1000);
      this.onProgress?.({
        id,
        direction: 'out',
        name: file.name,
        transferred: sentBytes,
        total: file.size,
        speed: sentBytes / elapsedSec,
        peerName: peer.name,
        done: i === totalChunks - 1,
      });
    }

    await peer.sendJson({ type: 'file-complete', id });
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
          totalChunks: msg.totalChunks,
          sha256: msg.sha256,
          chunks: new Array(msg.totalChunks),
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
        return;
      }

      if (msg.type === 'file-cancel') {
        this.incoming.delete(msg.id);
        return;
      }

      if (msg.type === 'file-complete') {
        const entry = this.incoming.get(msg.id);
        if (!entry || !entry.accepted) return;
        this.incoming.delete(msg.id);

        const blob = new Blob(entry.chunks, { type: entry.mime });
        let verified = null;
        if (entry.sha256 && settings.verifyIntegrity) {
          const fullBuf = await blob.arrayBuffer();
          const actual = await computeSha256Hex(fullBuf);
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
      }
      return;
    }

    // Binary chunk
    const buf = data instanceof ArrayBuffer ? data : await data.arrayBuffer?.();
    if (!buf) return;
    const chunk = decodeBinaryChunk(buf);
    if (!chunk) return;

    const entry = this.incoming.get(chunk.transferId);
    if (!entry || !entry.accepted) return;

    entry.chunks[chunk.chunkIndex] = chunk.payload;
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
