const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const PORT = Number(process.env.PORT || 3000);
const clients = new Map(); // id -> { ws, id, name }
const rooms = new Map();   // code -> { hostId, createdAt }

function broadcastPeers() {
  const list = Array.from(clients.values()).map((c) => ({ id: c.id, name: c.name }));
  const payload = JSON.stringify({ type: 'peers', peers: list });
  for (const c of clients.values()) {
    try {
      c.ws.send(payload);
    } catch {
      // Ignore closed sockets
    }
  }
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateRoomCode() {
  for (let attempt = 0; attempt < 16; attempt++) {
    let code = '';
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    for (let i = 0; i < 8; i++) {
      code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
    }
    if (!rooms.has(code)) return code;
  }
  return Date.now().toString(36).toUpperCase().slice(-8);
}

Bun.serve({
  hostname: '0.0.0.0',
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === '/ws') {
      if (server.upgrade(req)) return;
      return new Response('WebSocket upgrade failed', { status: 400 });
    }

    const rel = url.pathname === '/' ? '/index.html' : url.pathname;
    if (rel.includes('..')) return new Response('Forbidden', { status: 403 });

    const file = Bun.file(`web${rel}`);
    if (!(await file.exists())) {
      return new Response('Not found', { status: 404 });
    }
    const dot = rel.lastIndexOf('.');
    const ext = dot >= 0 ? rel.slice(dot) : '';
    return new Response(file, {
      headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
    });
  },
  websocket: {
    open(ws) {
      ws.data = { id: null, name: 'Device' };
    },
    message(ws, raw) {
      let msg;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }

      if (msg.type === 'hello' && msg.id) {
        ws.data.id = msg.id;
        ws.data.name = msg.name || 'Device';
        clients.set(msg.id, { ws, id: msg.id, name: ws.data.name });
        broadcastPeers();
        return;
      }

      if (msg.type === 'create-room' && ws.data.id) {
        for (const [code, r] of rooms.entries()) {
          if (r.hostId === ws.data.id) rooms.delete(code);
        }
        const code = generateRoomCode();
        rooms.set(code, { hostId: ws.data.id, createdAt: Date.now() });
        ws.send(JSON.stringify({ type: 'room-created', code }));
        return;
      }

      if (msg.type === 'join-room' && ws.data.id) {
        const clean = String(msg.code || '').replace(/[^A-Z0-9]/gi, '').toUpperCase();
        const room = rooms.get(clean);
        const host = room ? clients.get(room.hostId) : null;
        if (!room || !host) {
          ws.send(JSON.stringify({ type: 'room-error', message: 'Code not found or expired.' }));
          return;
        }
        if (host.id === ws.data.id) {
          ws.send(JSON.stringify({ type: 'room-error', message: 'Cannot join your own code.' }));
          return;
        }
        rooms.delete(clean);
        host.ws.send(JSON.stringify({
          type: 'peer-joined',
          code: clean,
          peerId: ws.data.id,
          peerName: ws.data.name,
        }));
        ws.send(JSON.stringify({
          type: 'room-joined',
          code: clean,
          hostId: host.id,
          hostName: host.name,
        }));
        return;
      }

      if (msg.type === 'signal' && ws.data.id && msg.to) {
        const target = clients.get(msg.to);
        if (target) {
          target.ws.send(JSON.stringify({
            type: 'signal',
            from: ws.data.id,
            fromName: ws.data.name,
            data: msg.data,
          }));
        }
      }
    },
    close(ws) {
      if (!ws.data?.id) return;
      clients.delete(ws.data.id);
      for (const [code, r] of rooms.entries()) {
        if (r.hostId === ws.data.id) rooms.delete(code);
      }
      broadcastPeers();
    },
  },
});

console.log(`Cycles server running on http://0.0.0.0:${PORT}`);
