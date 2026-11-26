// Keyboard + mouse input with pointer-lock mouselook (MMO-style third person).

// Ability key bindings: up to two keys per action-bar slot (codes from KeyboardEvent.code, or Mouse1/3/4).
export const DEFAULT_BINDS = [['Digit1'], ['Digit2'], ['Digit3'], ['Digit4'], ['Digit5', 'KeyQ'], ['Digit6', 'KeyE']];
// keys that already do something and can't be bound to an ability
export const RESERVED_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'Tab', 'Escape', 'F1', 'F2', 'KeyG', 'KeyB']); // G: drop the flag, B (hold): battleground scoreboard
export function keyLabel(code) {
  if (!code) return '';
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Numpad')) return 'N' + code.slice(6);
  return { Mouse1: 'MMB', Mouse3: 'M4', Mouse4: 'M5', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\',
    ControlLeft: 'Ctrl', ControlRight: 'Ctrl', AltLeft: 'Alt', AltRight: 'Alt', CapsLock: 'Caps' }[code] || code.replace(/^(Arrow|Page)/, '');
}

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.keys = new Set();
    this.pressed = []; // ability presses since last poll
    this.jumpPressed = false; this.tabPressed = false; this.attackPressed = false; this.friendKey = 0; this.dropPressed = false;
    this.clickPos = { x: 0.5, y: 0.45 }; this.mouseHeld = false;
    this.yaw = 0; this.pitch = 0.32; this.zoom = 9;
    this.sens = 1; this.invert = false;
    this.enabled = false;
    this.locked = false;
    this.fallback = false; // true when the browser refuses pointer lock (e.g. embedded frames)
    this.onEscape = null;
    this.onUnlock = null;

    this.setBinds(DEFAULT_BINDS);
    this.capture = null; // rebinding in the settings: the next key / mouse button goes to this callback
    addEventListener('keydown', e => {
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(e.code); return; }
      if (!this.enabled) return;
      if (e.code === 'Tab') { e.preventDefault(); this.tabPressed = true; return; }
      if (e.code === 'Escape') { this.onEscape && this.onEscape(); return; }
      if (e.code === 'F1' || e.code === 'F2') { e.preventDefault(); this.friendKey = e.code === 'F1' ? 1 : 2; return; }
      if (e.repeat) return;
      this.keys.add(e.code);
      const slot = this.binds.get(e.code) ?? (/^Numpad([1-6])$/.exec(e.code) ? +e.code.slice(6) - 1 : undefined);
      if (slot !== undefined) { this.pressed.push(slot); if (e.code.startsWith('Key') || e.code.startsWith('Digit')) e.preventDefault(); }
      else if (e.code === 'KeyG') this.dropPressed = true;
      if (e.code === 'Space') { this.jumpPressed = true; e.preventDefault(); }
    });
    // extra mouse buttons (middle, back, forward) can be bound to abilities
    addEventListener('mousedown', e => {
      if (e.button === 0 || e.button === 2) return;
      const code = 'Mouse' + e.button;
      if (this.capture) { e.preventDefault(); const c = this.capture; this.capture = null; c(code); return; }
      if (!this.enabled) return;
      const slot = this.binds.get(code); if (slot !== undefined) { e.preventDefault(); this.pressed.push(slot); }
    });
    addEventListener('mouseup', e => { if (e.button === 3 || e.button === 4) e.preventDefault(); }); // keep back / forward from navigating
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('mouseup', e => { if (e.button === 0) this.mouseHeld = false; });
    addEventListener('blur', () => { this.keys.clear(); this.mouseHeld = false; });
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
    this.mousePos = { x: 0.5, y: 0.45 }; // cursor (only differs from the crosshair without pointer lock)
    addEventListener('mousemove', e => {
      if (!this.enabled) return;
      if (!this.locked) this.mousePos = { x: e.clientX / innerWidth, y: e.clientY / innerHeight };
      // pointer-locked mouselook, or hold any mouse button to look when pointer lock is unavailable
      if (!this.locked && !(this.fallback && (e.buttons & 2))) return; // fallback: the right button looks, the left one attacks
      this.yaw -= e.movementX * 0.0025 * this.sens;
      this.pitch += e.movementY * 0.0025 * this.sens * (this.invert ? -1 : 1);
      this.pitch = Math.max(-0.35, Math.min(1.25, this.pitch));
    });
    addEventListener('wheel', e => { if (!this.enabled) return; this.zoom = Math.max(4, Math.min(16, this.zoom + Math.sign(e.deltaY) * 0.8)); }, { passive: true });
    // A refused lock request is normal — Chrome refuses a re-lock right after Esc, a request that didn't come from
    // a click, the first try with raw input on systems without it — and only means "try again on the next click".
    // Only a page that can never lock (an embedded view) switches to the fallback controls for good.
    this.lockFails = 0;
    document.addEventListener('pointerlockerror', () => { if (!this.promiseLock && ++this.lockFails >= 3) this.noLock(); });
    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === canvas;
      if (this.locked) this.lockFails = 0;
      if (was && !this.locked) { this.keys.clear(); this.mouseHeld = false; this.onUnlock && this.onUnlock(); }
    });
  }

  requestLock() {
    if (this.fallback || this.locked) return;
    if (!this.canvas.requestPointerLock) { this.noLock(); return; }
    const plain = () => { try { const q = this.canvas.requestPointerLock(); if (q && q.catch) q.catch(e => this.lockRefused(e)); } catch (e) { this.lockRefused(e); } };
    try {
      const p = this.canvas.requestPointerLock({ unadjustedMovement: true }); // raw mouse input where the system has it
      if (p && p.catch) { this.promiseLock = true; p.catch(e => (e && e.name === 'NotSupportedError' ? plain() : this.lockRefused(e))); }
    } catch { plain(); }
  }
  // why a lock request failed: an embedded view can never lock; anything else is retried on the next click
  lockRefused(e) { if (e && e.name === 'WrongDocumentError') this.noLock(); }
  noLock() { if (this.fallback) return; this.fallback = true; this.onFallback && this.onFallback(); }
  setBinds(binds) {
    this.bindList = binds.map(l => [...(l || [])]);
    this.binds = new Map();
    this.bindList.forEach((codes, slot) => { for (const c of codes) if (c) this.binds.set(c, slot); });
  }
  get active() { return this.locked || this.fallback; }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }

  // Returns the movement intent and consumes one-shot presses.
  poll() {
    const k = this.keys;
    const mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const mx = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    const out = { mx, mz, yaw: this.yaw, jump: this.jumpPressed, sprint: k.has('ShiftLeft') || k.has('ShiftRight'), abilities: this.pressed.slice(), targetReq: this.tabPressed, attack: this.attackPressed, atkHeld: this.mouseHeld, clickPos: this.clickPos, friendKey: this.friendKey, dropFlag: this.dropPressed, scoreHeld: k.has('KeyB') && !this.binds.has('KeyB'),
      aimPos: this.locked ? { x: 0.5, y: 0.45 } : this.mousePos };
    this.pressed.length = 0; this.jumpPressed = false; this.tabPressed = false; this.attackPressed = false; this.friendKey = 0; this.dropPressed = false;
    return out;
  }
}
