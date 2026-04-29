export class LiveRoom {
constructor(state, env) {
this.state = state;
this.sessions = new Map();

```
// Ghost — autonomous spirit wandering the screen
this.ghost = {
  x: 0.5, y: 0.5,
  vx: (Math.random() - 0.5) * 0.003,
  vy: (Math.random() - 0.5) * 0.003,
  phase: Math.random() * Math.PI * 2,
  alive: true,
  respawnAt: 0
};

// Move ghost every 400ms
setInterval(() => this.tickGhost(), 400);
// Heartbeat every 12s
setInterval(() => this.heartbeat(), 12000);
```

}

async fetch(request) {
if (request.headers.get(‘Upgrade’) === ‘websocket’) {
const pair = new WebSocketPair();
const [client, server] = Object.values(pair);
await this.handleSession(server);
return new Response(null, { status: 101, webSocket: client });
}
return new Response(JSON.stringify({
count: this.sessions.size,
ghost: this.ghost
}), { headers: { ‘Content-Type’: ‘application/json’, ‘Access-Control-Allow-Origin’: ‘*’ } });
}

async handleSession(ws) {
ws.accept();
const id = crypto.randomUUID().slice(0, 8);
const color = Math.floor(Math.random() * 8);
this.sessions.set(id, { ws, color, lastSeen: Date.now() });

```
// Send init with current ghost state
this.send(ws, {
  type: 'init', id, color,
  count: this.sessions.size,
  ghost: this.ghost
});
this.broadcast({ type: 'join', id, color, count: this.sessions.size }, id);

ws.addEventListener('message', (event) => {
  try {
    const msg = JSON.parse(event.data);
    const session = this.sessions.get(id);
    if (!session) return;
    session.lastSeen = Date.now();

    if (msg.type === 'move') {
      this.broadcast({ type: 'move', id, color, tid: msg.tid || 'M0', x: msg.x, y: msg.y }, id);
    } else if (msg.type === 'lift') {
      this.broadcast({ type: 'lift', id, tid: msg.tid || 'M0' }, id);
    } else if (msg.type === 'ghost_catch') {
      // Player caught the ghost!
      if (!this.ghost.alive) return;
      this.ghost.alive = false;
      this.ghost.respawnAt = Date.now() + 5000; // respawn in 5s
      // Broadcast explosion to EVERYONE including catcher
      this.broadcastAll({
        type: 'ghost_caught',
        catcherId: id,
        catcherColor: color,
        x: this.ghost.x,
        y: this.ghost.y
      });
    } else if (msg.type === 'ping') {
      this.send(ws, { type: 'pong', count: this.sessions.size, ghost: this.ghost });
    }
  } catch(e) {}
});

ws.addEventListener('close', () => {
  this.sessions.delete(id);
  this.broadcast({ type: 'liftall', id });
  this.broadcast({ type: 'leave', id, count: this.sessions.size });
});
ws.addEventListener('error', () => { this.sessions.delete(id); });
```

}

// Ghost AI movement
tickGhost() {
const now = Date.now();

```
// Respawn if dead
if (!this.ghost.alive) {
  if (now >= this.ghost.respawnAt) {
    this.ghost.alive = true;
    // Respawn at random position
    this.ghost.x = 0.1 + Math.random() * 0.8;
    this.ghost.y = 0.1 + Math.random() * 0.8;
    this.ghost.vx = (Math.random() - 0.5) * 0.004;
    this.ghost.vy = (Math.random() - 0.5) * 0.004;
    this.broadcastAll({ type: 'ghost_spawn', x: this.ghost.x, y: this.ghost.y });
  }
  return;
}

this.ghost.phase += 0.08;

// Organic wandering with Lissajous influence
const ax = Math.sin(this.ghost.phase * 0.7) * 0.0008 + (Math.random() - 0.5) * 0.001;
const ay = Math.cos(this.ghost.phase * 0.5) * 0.0008 + (Math.random() - 0.5) * 0.001;
this.ghost.vx += ax;
this.ghost.vy += ay;

// Speed limit
const spd = Math.sqrt(this.ghost.vx ** 2 + this.ghost.vy ** 2);
const maxSpd = 0.006;
if (spd > maxSpd) { this.ghost.vx *= maxSpd / spd; this.ghost.vy *= maxSpd / spd; }

this.ghost.x += this.ghost.vx;
this.ghost.y += this.ghost.vy;

// Bounce off edges
if (this.ghost.x < 0.05 || this.ghost.x > 0.95) this.ghost.vx *= -1;
if (this.ghost.y < 0.05 || this.ghost.y > 0.95) this.ghost.vy *= -1;
this.ghost.x = Math.max(0.05, Math.min(0.95, this.ghost.x));
this.ghost.y = Math.max(0.05, Math.min(0.95, this.ghost.y));

// Broadcast ghost position to all
this.broadcastAll({
  type: 'ghost_move',
  x: this.ghost.x,
  y: this.ghost.y,
  alive: this.ghost.alive
});
```

}

heartbeat() {
const now = Date.now();
this.sessions.forEach((session, id) => {
try {
session.ws.send(JSON.stringify({
type: ‘heartbeat’,
count: this.sessions.size,
ghost: this.ghost,
ts: now
}));
if (now - session.lastSeen > 35000) {
try { session.ws.close(); } catch(e) {}
this.sessions.delete(id);
this.broadcast({ type: ‘leave’, id, count: this.sessions.size });
}
} catch(e) { this.sessions.delete(id); }
});
}

send(ws, data) { try { ws.send(JSON.stringify(data)); } catch(e) {} }
broadcast(data, excludeId) {
const msg = JSON.stringify(data);
this.sessions.forEach((s, sid) => {
if (sid === excludeId) return;
try { s.ws.send(msg); } catch(e) { this.sessions.delete(sid); }
});
}
broadcastAll(data) {
const msg = JSON.stringify(data);
this.sessions.forEach((s, sid) => {
try { s.ws.send(msg); } catch(e) { this.sessions.delete(sid); }
});
}
}

export default {
async fetch(request, env) {
const url = new URL(request.url);
if (request.method === ‘OPTIONS’) {
return new Response(null, { headers: {
‘Access-Control-Allow-Origin’: ‘*’,
‘Access-Control-Allow-Methods’: ‘GET, OPTIONS’,
‘Access-Control-Allow-Headers’: ‘Content-Type, Upgrade’
}});
}
if (url.pathname === ‘/ws’ || url.pathname === ‘/count’) {
const id = env.ROOM.idFromName(‘main-room’);
const room = env.ROOM.get(id);
return room.fetch(request);
}
return new Response(‘ZHIVOY OK’, { status: 200 });
}
};
