// Peer-to-peer online play over WebRTC (PeerJS public broker for signalling only).
// The host runs the authoritative simulation; the guest sends inputs and receives
// state snapshots + events. No server of our own is required.
import { Peer } from 'peerjs';

const PREFIX = 'runefall-arena-v1-';
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function makeCode() { let s = ''; for (let i = 0; i < 6; i++) s += ALPHA[Math.floor(Math.random() * ALPHA.length)]; return s; }

export class Net {
  constructor() { this.peer = null; this.conn = null; this.handlers = {}; this.role = null; this.code = null; this.closed = false; }

  on(type, fn) { this.handlers[type] = fn; }
  emit(type, data) { const h = this.handlers[type]; if (h) h(data); }

  host(onReady) {
    this.role = 'host';
    const tryOpen = (attempt = 0) => {
      this.code = makeCode();
      this.peer = new Peer(PREFIX + this.code, { debug: 0 });
      this.peer.on('open', () => onReady(this.code));
      this.peer.on('error', err => {
        if (err.type === 'unavailable-id' && attempt < 3) { this.peer.destroy(); tryOpen(attempt + 1); return; }
        this.emit('error', err.type || String(err));
      });
      this.peer.on('connection', conn => {
        if (this.conn && this.conn.open) { conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); }); return; }
        this.attach(conn);
      });
      this.peer.on('disconnected', () => { if (!this.closed && this.peer && !this.peer.destroyed) this.peer.reconnect(); });
    };
    tryOpen();
  }

  join(code, onOpen) {
    this.role = 'guest';
    this.code = code.toUpperCase();
    this.peer = new Peer({ debug: 0 });
    this.peer.on('open', () => {
      const conn = this.peer.connect(PREFIX + this.code, { reliable: true, serialization: 'json' });
      this.attach(conn, onOpen);
      setTimeout(() => { if (!this.conn || !this.conn.open) this.emit('error', 'timeout'); }, 12000);
    });
    this.peer.on('error', err => this.emit('error', err.type || String(err)));
  }

  attach(conn, onOpen) {
    this.conn = conn;
    conn.on('open', () => { this.emit('connected'); onOpen && onOpen(); });
    conn.on('data', msg => { if (msg && msg.t) this.emit(msg.t, msg); this.emit('any', msg); });
    conn.on('close', () => { if (!this.closed) this.emit('disconnected'); });
    conn.on('error', () => { if (!this.closed) this.emit('disconnected'); });
  }

  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); }
  get connected() { return !!(this.conn && this.conn.open); }

  close() {
    this.closed = true;
    try { this.conn && this.conn.close(); } catch {}
    try { this.peer && this.peer.destroy(); } catch {}
    this.conn = null; this.peer = null;
  }
}
