export class LiveRoom {
  constructor(state, env) {
    this.state = state;
    this.sessions = new Map();
    setInterval(() => this.cleanup(), 30000);
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') === 'websocket') {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      await this.handleSession(server);
      return new Response(null, { status: 101, webSocket: client });
    }
    return new Response(JSON.stringify({ count: this.sessions.size }), {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
    });
  }
  async handleSession(ws) {
    ws.accept();
    const id = crypto.randomUUID().slice(0, 8);
    const color = Math.floor(Math.random() * 8);
    this.sessions.set(id, { ws, color, lastSeen: Date.now() });
    this.send(ws, { type: 'init', id, color, count: this.sessions.size });
    this.broadcast({ type: 'join', id, color, count: this.sessions.size }, id);
    ws.addEventListener('message', (event) => {
      try {
        const msg = JSON.parse(event.data);
        const session = this.sessions.get(id);
        if (!session) return;
        session.lastSeen = Date.now();
        if (msg.type === 'move') {
          this.broadcast({ type: 'move', id, color, x: msg.x, y: msg.y }, id);
        } else if (msg.type === 'lift') {
          this.broadcast({ type: 'lift', id }, id);
        } else if (msg.type === 'ping') {
          this.send(ws, { type: 'pong', count: this.sessions.size });
        }
      } catch(e) {}
    });
    ws.addEventListener('close', () => {
      this.sessions.delete(id);
      this.broadcast({ type: 'leave', id, count: this.sessions.size });
    });
    ws.addEventListener('error', () => { this.sessions.delete(id); });
  }
  send(ws, data) { try { ws.send(JSON.stringify(data)); } catch(e) {} }
  broadcast(data, excludeId) {
    const msg = JSON.stringify(data);
    this.sessions.forEach((session, id) => {
      if (id === excludeId) return;
      try { session.ws.send(msg); } catch(e) { this.sessions.delete(id); }
    });
  }
  cleanup() {
    const cutoff = Date.now() - 60000;
    this.sessions.forEach((session, id) => {
      if (session.lastSeen < cutoff) {
        try { session.ws.close(); } catch(e) {}
        this.sessions.delete(id);
        this.broadcast({ type: 'leave', id, count: this.sessions.size });
      }
    });
  }
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Upgrade'
        }
      });
    }
    if (url.pathname === '/ws' || url.pathname === '/count') {
      const id = env.ROOM.idFromName('main-room');
      const room = env.ROOM.get(id);
      return room.fetch(request);
    }
    return new Response('ZHIVOY OK', { status: 200 });
  }
};
