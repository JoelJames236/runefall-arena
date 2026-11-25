// Keyboard + mouse input with pointer-lock mouselook (MMO-style third person).
export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = []; // ability presses since last poll
    this.jumpPressed = false; this.tabPressed = false; this.attackPressed = false; this.friendKey = 0;
    this.clickPos = { x: 0.5, y: 0.45 }; this.mouseHeld = false;
    this.yaw = 0; this.pitch = 0.32; this.zoom = 9;
    this.sens = 1; this.invert = false;
    this.enabled = false;
    this.locked = false;
    this.fallback = false; // true when the browser refuses pointer lock (e.g. embedded frames)
    this.onEscape = null;
    this.onUnlock = null;

    addEventListener('keydown', e => {
      if (!this.enabled) return;
      if (e.code === 'Tab') { e.preventDefault(); this.tabPressed = true; return; }
      if (e.code === 'Escape') { this.onEscape && this.onEscape(); return; }
      if (e.code === 'F1' || e.code === 'F2') { e.preventDefault(); this.friendKey = e.code === 'F1' ? 1 : 2; return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      const m = /^Digit([1-6])$/.exec(e.code) || /^Numpad([1-6])$/.exec(e.code);
      if (m) this.pressed.push(+m[1] - 1);
      if (e.code === 'KeyQ') this.pressed.push(4); // convenience alternates
      if (e.code === 'KeyE') this.pressed.push(5);
      if (e.code === 'Space') { this.jumpPressed = true; e.preventDefault(); }
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseHeld = false; });
    addEventListener('blur', () => this.keys.clear());
    canvas.addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    canvas.addEventListener('mousedown', e => {
      if (!this.enabled) return;
      if (!this.locked && !this.fallback) { this.requestLock(); return; }
      if (e.button === 0) {
        this.attackPressed = true; this.mouseHeld = true;
        this.clickPos = this.locked ? { x: 0.5, y: 0.45 } : { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
      }
      if (this.fallback) e.preventDefault();
    });
    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      // pointer-locked mouselook, or hold any mouse button to look when pointer lock is unavailable
      if (!this.locked && !(this.fallback && e.buttons)) return;
      this.yaw -= e.movementX * 0.0025 * this.sens;
      this.pitch += e.movementY * 0.0025 * this.sens * (this.invert ? -1 : 1);
      this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch));
    });
    addEventListener('wheel', e => { if (!this.enabled) return; this.zoom = Math.max(4, Math.min(16, this.zoom + Math.sign(e.deltaY) * 0.8)); }, { passive: true });
    document.addEventListener('pointerlockerror', () => { this.fallback = true; this.onFallback && this.onFallback(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (was && !this.locked) { this.keys.clear(); this.onUnlock && this.onUnlock(); }
    });
  }

  requestLock() {
    if (this.fallback) return;
    const fail = () => { this.fallback = true; this.onFallback && this.onFallback(); };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true });
      if (p && p.catch) p.catch(() => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(fail); } catch { fail(); } });
    } catch { try { this.canvas.requestPointerLock(); } catch { fail(); } }
  }
  get active() { return this.locked || this.fallback; }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Returns the movement intent and consumes one-shot presses.
  poll() {
    const k = this.keys;
    const mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const out = { mx, mz, yaw: this.yaw, jump: this.jumpPressed, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), abilities: this.pressed.slice(), targetReq: this.tabPressed, attack: this.attackPressed, clickPos: this.clickPos, friendKey: this.friendKey };
    this.pressed.length = 0; this.jumpPressed = false; this.tabPressed = false; this.attackPressed = false; this.friendKey = 0;
    return out;
  }
}
