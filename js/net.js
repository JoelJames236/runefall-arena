// Peer-to-peer online play over WebRTC (PeerJS public broker for signalling only).
// Star topology: the room host runs the authoritative simulation; up to 3 guests connect
// to it, send inputs and receive state snapshots + events. No server of our own.
//
// Matchmaking (2v2 "Find Opponents") also needs no server: waiting parties claim one of a
// few well-known queue ids on the broker; a searching party that finds a slot taken connects
// to it and is handed the waiting party's room code.
import { Peer } from 'peerjs';

const PREFIX = 'runefall-arena-v2-';
const QPREFIX = 'runefall-arena-v2-queue2v2-';
const QSLOTS = 3;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() { let s = ''; for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

export class Net {
  constructor() { this.peer = null; this.conns = new Map(); this.handlers = {}; this.role = null; this.code = null; this.closed = false; this.maxGuests = 3; }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, data, cid) { const h = this.handlers[type]; if (h) h(data, cid); }

  // ---- host a room
  host(onReady) {
    this.role = 'host';
    const tryOpen = (attempt = 0) => {
      this.code = makeCode();
      this.peer = new Peer(PREFIX + this.code, { debug: 0 });
      this.peer.on('open', () => onReady(this.code));
      this.peer.on('error', err => {
        if (err.type === 'unavailable-id' && attempt < 3) { this.peer.destroy(); tryOpen(attempt + 1); return; }
        if (err.type === 'peer-unavailable') return; // a guest vanished mid-handshake
        this.emit('error', err.type || String(err));
      });
      this.peer.on('connection', conn => {
        if (this.conns.size >= this.maxGuests) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
        this.attach(conn);
      });
      this.peer.on('disconnected', () => { if (!this.closed && this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    };
    tryOpen();
  }

  // ---- join a room
  join(code, onOpen) {
    this.role = 'guest';
    this.code = code.toUpperCase();
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.attach(conn, onOpen);
      setTimeout(() => { if (!this.connected && !this.closed) this.emit('error', 'timeout'); }, 12000);
    });
    this.peer.on('error', err => this.emit('error', err.type || String(err)));
  }

  attach(conn, onOpen) {
    const cid = conn.peer;
    conn.on('open', () => { this.conns.set(cid, conn); this.emit('connected', null, cid); onOpen && onOpen(); });
    conn.on('data', msg => { if (msg && msg.t) this.emit(msg.t, msg, cid); });
    const gone = () => { if (!this.conns.has(cid)) return; this.conns.delete(cid); if (!this.closed) this.emit('disconnected', null, cid); };
    conn.on('close', gone);
    conn.on('error', gone);
  }

  send(msg) { for (const c of this.conns.values()) if (c.open) c.send(msg); }          // guest → host, host → everyone
  sendTo(cid, msg) { const c = this.conns.get(cid); if (c && c.open) c.send(msg); }
  kick(cid) { const c = this.conns.get(cid); if (c) { this.conns.delete(cid); try { c.close(); } catch {} } }
  get connected() { for (const c of this.conns.values()) if (c.open) return true; return false; }
  get guestCount() { return this.conns.size; }

  close() {
    this.closed = true;
    this.stopQueue();
    for (const c of this.conns.values()) { try { c.close(); } catch {} }
    try { this.peer && this.peer.destroy(); } catch {}
    this.conns.clear(); this.peer = null;
  }

  // ------------------------------------------------------------ 2v2 matchmaking
  // onWaiting(): we hold a queue slot and wait. onHosting(): someone found us (they will join our room).
  // onFound(code): we found a waiting party — move our party into room `code`.
  startQueue(roomCode, { onWaiting, onFound, onHosting, onStatus }) {
    this.stopQueue();
    const q = this.queue = { active: true, slot: 0, peer: null, conn: null, timer: null };
    const next = (delay = 400) => { if (!q.active) return; q.timer = setTimeout(() => tryClaim((q.slot + 1) % QSLOTS), delay); };
    const tryClaim = (slot) => {
      if (!q.active) return;
      q.slot = slot;
      onStatus && onStatus(`Searching for opponents… (slot ${slot + 1})`);
      const p = q.peer = new Peer(QPREFIX + slot, { debug: 0 });
      p.on('open', () => {
        // we hold the slot: wait for a challenger
        onWaiting && onWaiting();
        p.on('connection', conn => {
          conn.on('open', () => {
            if (!q.active) { conn.close(); return; }
            conn.send({ t: 'qroom', code: roomCode });
            q.active = false;
            onHosting && onHosting();
            setTimeout(() => { try { conn.close(); } catch {} try { p.destroy(); } catch {} }, 1500);
          });
        });
      });
      p.on('error', err => {
        if (!q.active) return;
        if (err.type === 'unavailable-id') { p.destroy(); challenge(slot); }
        else { try { p.destroy(); } catch {} next(2000); }
      });
    };
    const challenge = (slot) => {
      if (!q.active) return;
      const p = q.peer = new Peer({ debug: 0 });
      let done = false;
      const fail = () => { if (done) return; done = true; try { p.destroy(); } catch {} next(600); };
      p.on('open', () => {
        const conn = p.connect(QPREFIX + slot, { reliable: true, serialization: 'json' });
        conn.on('data', m => { if (m && m.t === 'qroom' && q.active && !done) { done = true; q.active = false; try { p.destroy(); } catch {} onFound && onFound(m.code); } });
        conn.on('close', fail); conn.on('error', fail);
        setTimeout(fail, 5000);
      });
      p.on('error', fail);
    };
    tryClaim(0);
  }

  stopQueue() {
    const q = this.queue; if (!q) return;
    q.active = false; clearTimeout(q.timer);
    try { q.peer && q.peer.destroy(); } catch {}
    this.queue = null;
  }
}
