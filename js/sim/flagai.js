// Bots for the flag battleground: the arena AI fights (abilities, interrupts, aiming), this layer decides where to
// go. Waypoints come from the map; links between them are found by walking (walkLine) once, with the gates open.
//
// Roles, chosen per team from the specs at the start: offense (push through to the enemy flag), mid (heads there too
// but fights everyone on the way), defense (guard the own flag room), escort (healers: follow the carrier or the
// offense). Events override roles: own flag taken → defense and
// the nearest teammates hunt the carrier; own flag dropped → nearest goes to return it; enemy flag dropped → nearest
// goes to pick it up; carrying the enemy flag → run home (picking the exit with the fewest enemies), wait in the own
// flag room if the own flag is out.
import { AI } from './ai.js';
import { walkLine, floorAt, currentMap, useMap } from './sim.js';
import { kitOf } from '../data/classes.js';

const ENGAGE = 26;      // enemies closer than this (and in sight) are fought
const LEASH = 30;       // defenders don't chase further than this from their flag room
const hd = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ------------------------------------------------------------------ waypoint graph (once per map)
const GRAPHS = new WeakMap();
export function navGraph(map) {
  if (GRAPHS.has(map)) return GRAPHS.get(map);
  const prevMap = currentMap(), was = map.gatesOpen; useMap(map); map.gatesOpen = true; // links are walked on this map, gates open
  const nodes = map.nodes.map((n, i) => ({ ...n, i, y: floorAt(n.x, n.z, n.y + 0.5) }));
  const adj = nodes.map(() => []);
  for (const a of nodes) for (const b of nodes) {
    if (a === b) continue;
    const d = hd(a, b); if (d > 30) continue;
    const y = walkLine(a.x, a.y, a.z, b.x, b.z, true);
    if (y !== null && Math.abs(y - b.y) < 1.0) adj[a.i].push({ to: b.i, cost: d });
  }
  map.gatesOpen = was; useMap(prevMap);
  const G = { nodes, adj, byId: Object.fromEntries(nodes.map(n => [n.id, n])) };
  GRAPHS.set(map, G);
  return G;
}
// cheapest path from node s to node t; `penalty(node)` adds cost (e.g. near enemies)
function astar(G, s, t, penalty) {
  const N = G.nodes, g = new Float64Array(N.length).fill(Infinity), prev = new Int32Array(N.length).fill(-1), done = new Uint8Array(N.length);
  g[s] = 0;
  for (;;) {
    let u = -1, best = Infinity;
    for (let i = 0; i < N.length; i++) if (!done[i]) { const f = g[i] + hd(N[i], N[t]); if (f < best) { best = f; u = i; } }
    if (u < 0 || u === t) break;
    done[u] = 1;
    for (const e of G.adj[u]) { const c = g[u] + e.cost + (penalty ? penalty(N[e.to]) : 0); if (c < g[e.to]) { g[e.to] = c; prev[e.to] = u; } }
  }
  if (!isFinite(g[t])) return null;
  const path = []; for (let v = t; v >= 0; v = prev[v]) path.unshift(v);
  return path;
}
// a node near p that can be walked to straight from p (from = true) or that p can be reached from. With `toward`,
// of the near nodes the one that leaves the shortest way on is taken: halfway up a ramp the node at its foot is the
// nearest, and starting there sent bots back down, then up, then down again
function anchor(G, p, from, toward) {
  const order = G.nodes.map(n => ({ n, d: hd(n, p) + Math.abs(n.y - (p.y ?? 0)) * 3 })).sort((a, b) => a.d - b.d);
  let best = null, bestC = Infinity;
  for (const { n, d } of order.slice(0, 8)) {
    const y = from ? walkLine(p.x, p.y ?? floorAt(p.x, p.z, 0), p.z, n.x, n.z, true) : walkLine(n.x, n.y, n.z, p.x, p.z, true);
    if (y === null || (from && Math.abs(y - n.y) > 1)) continue;
    if (!toward) return n;
    const c = d + hd(n, toward) + Math.abs(n.y - (toward.y ?? 0));
    if (c < bestC) { bestC = c; best = n; }
  }
  return best || order[0].n;
}

// ------------------------------------------------------------------ roles
const HEALERS = new Set(['priest:discipline', 'druid:restoration']);
const CONTROL = ['mage:frost', 'priest:shadow', 'necromancer:curser', 'hunter:sharpshooter', 'mage:fire', 'shaman:elemental', 'necromancer:summoner'];
export function assignRoles(sim) {
  const roles = {};
  for (const team of [0, 1]) {
    const mates = sim.fighters.filter(f => f.team === team);
    const key = f => f.cls + ':' + f.spec;
    for (const f of mates) roles[f.id] = HEALERS.has(key(f)) ? 'escort' : 'offense';
    // one defender: the most controlling spec that isn't the healer
    const def = mates.filter(f => roles[f.id] === 'offense').sort((a, b) => (CONTROL.indexOf(key(a)) + 99) % 99 - (CONTROL.indexOf(key(b)) + 99) % 99)[0];
    if (def && mates.length >= 3) roles[def.id] = 'defense';
    // big teams without a healer still send someone with the carrier
    if (!mates.some(f => roles[f.id] === 'escort') && mates.length >= 4) { const e = mates.find(f => roles[f.id] === 'offense'); if (e) roles[e.id] = 'escort'; }
    // and one attacker holds the middle: it heads for the enemy flag too, but takes on every enemy on the way
    // instead of running past (the others push through: without that, no flag was ever reached)
    const offense = mates.filter(f => roles[f.id] === 'offense');
    if (offense.length >= 3) roles[offense.sort((a, b) => b.maxHp - a.maxHp)[0].id] = 'mid';
  }
  return roles;
}

export class FlagAI extends AI {
  constructor(sim, id, diff) { super(sim, id, diff); this.planT = 0; this.path = null; this.goal = null; this.stuck = { x: 0, z: 0, t: 0 }; }
  get G() { return navGraph(currentMap()); }
  get role() { const s = this.sim; if (!s._roles) s._roles = assignRoles(s); return s._roles[this.id]; }

  // fights only enemies near enough to matter (the arena AI would chase anyone, anywhere)
  focusScore(me, e, allies) {
    if (this.hunt === e.id && e.alive) return -1e6; // the enemy carrier
    if (hd(me, e) > ENGAGE + 8) return Infinity;
    return super.focusScore(me, e, allies);
  }

  // ---------------------------------------------------------- where to go
  objective(me) {
    const S = this.sim, M = currentMap(), own = S.flags[me.team], foe = S.flags[1 - me.team];
    const myStand = M.flags[me.team], theirStand = M.flags[1 - me.team];
    const mates = S.fighters.filter(f => f.team === me.team && f.alive && f.id !== me.id);
    const nearestMate = (p, n = 1) => [me, ...mates].sort((a, b) => hd(a, p) - hd(b, p)).slice(0, n).includes(me);
    this.hunt = -1;
    // carrying their flag: go home (and wait in the flag room while ours is away)
    if (foe.state === 'carried' && foe.carrier === me.id) return { ...myStand, run: true };
    // our flag dropped: the nearest two go return it
    if (own.state === 'dropped' && (nearestMate(own, 2) || hd(me, own) < 25)) return { x: own.x, y: own.y, z: own.z, urgent: true };
    // our flag carried: defense and the nearest two hunt the carrier
    if (own.state === 'carried') {
      const c = S.fighters[own.carrier];
      if (c && (this.role === 'defense' || nearestMate(c, 3))) { this.hunt = c.id; return { x: c.x, y: c.y, z: c.z, urgent: true }; }
    }
    // their flag dropped: the nearest goes to pick it up
    if (foe.state === 'dropped' && nearestMate(foe, 2)) return { x: foe.x, y: foe.y, z: foe.z, urgent: true };
    // a teammate carries their flag: escort and offense guard the carrier
    if (foe.state === 'carried' && this.role !== 'defense') {
      const c = S.fighters[foe.carrier];
      if (c) return { x: c.x - Math.sign(c.x || 1) * 2, y: c.y, z: c.z + (me.id % 2 ? 2 : -2), escort: true };
    }
    if (this.role === 'defense') {
      const g = this.G.byId[(me.team ? 'c_' : 'g_') + 'froom'];
      return { x: g.x + Math.sin(me.id * 2.1) * 2.5, y: g.y, z: g.z + Math.cos(me.id * 2.1) * 2.5, guard: true };
    }
    if (this.role === 'escort') {
      const off = mates.filter(f => S._roles[f.id] === 'offense').sort((a, b) => hd(a, theirStand) - hd(b, theirStand))[0];
      if (off) return { x: off.x, y: off.y, z: off.z, escort: true };
    }
    return { ...theirStand };
  }

  // a waypoint route to the goal, re-planned twice a second; carriers avoid enemies
  route(me, goal, avoid) {
    const G = this.G;
    const yEnd = hd(me, goal) < 40 ? walkLine(me.x, me.y, me.z, goal.x, goal.z, true) : null;
    if (yEnd !== null && Math.abs(yEnd - floorAt(goal.x, goal.z, (goal.y ?? 0) + 0.5)) < 1.2) return null; // straight there
    const enemies = this.sim.fighters.filter(f => f.alive && f.team !== me.team);
    const penalty = avoid ? n => enemies.reduce((s, e) => s + (hd(n, e) < 14 ? 60 : 0), 0) : null;
    const t = anchor(G, goal, false), s = anchor(G, me, true, t);
    return astar(G, s.i, t.i, penalty);
  }
  // steering: a unit vector towards the next waypoint (or straight to the goal)
  nav(me, goal) {
    if (!currentMap()) return super.nav(me, goal);
    this.planT -= 1 / 60;
    if (this.planT <= 0 || !this.goal || hd(this.goal, goal) > 3) {
      this.planT = 0.5 + Math.random() * 0.2; this.goal = { x: goal.x, y: goal.y ?? 0, z: goal.z };
      this.path = this.route(me, this.goal, !!this.carrying);
    }
    let tx = goal.x, tz = goal.z;
    if (this.path && this.path.length) {
      const N = this.G.nodes;
      // skip waypoints we've reached, or can already walk past
      // (reachable = the straight walk ends at that node's height: a ramp is fine, a ledge above is not)
      const canSkip = () => { const n1 = N[this.path[1]], y = walkLine(me.x, me.y, me.z, n1.x, n1.z, true); return y !== null && Math.abs(y - n1.y) < 1; };
      while (this.path.length && (hd(me, N[this.path[0]]) < 1.6 || (this.path.length > 1 && hd(me, N[this.path[0]]) < 12 && canSkip()))) this.path.shift();
      if (this.path.length) { tx = N[this.path[0]].x; tz = N[this.path[0]].z; }
    }
    const dx = tx - me.x, dz = tz - me.z, L = Math.hypot(dx, dz) || 1;
    return { x: dx / L, z: dz / L };
  }

  getInput(dt) {
    const S = this.sim, me = S.fighters[this.id];
    const idle = { mx: 0, mz: 0, yaw: me.yaw, jump: false, sprint: false, abilities: [], targetReq: false };
    if (!me.alive || S.state === 'matchEnd') return idle;
    if (S.state === 'countdown') {
      // wait inside the keep, facing the gate
      const gate = S.fighters.find(f => f.team !== me.team) ? (me.team === 0 ? Math.PI / 2 : -Math.PI / 2) : me.yaw;
      return { ...idle, yaw: gate };
    }
    this.carrying = S.flags[1 - me.team].state === 'carried' && S.flags[1 - me.team].carrier === me.id;
    const goal = this.objective(me);
    const enemies = S.fighters.filter(f => f.alive && f.team !== me.team && S.visibleTo(f, me));
    const fightable = enemies.filter(e => hd(me, e) < ENGAGE && (S.los(me, e) || hd(me, e) < 10) || e.id === this.hunt);
    let inp;
    if (fightable.length) {
      inp = super.getInput(dt); // abilities, interrupts, aim, swing, and the combat movement (chase / kite) through nav()
      // carriers keep running home (fighting on the way), defenders don't leave the base for long,
      // and anyone with an urgent errand goes on with it
      const home = currentMap().flags[me.team];
      const leash = goal.guard && hd(me, home) > LEASH;
      // offense pushes through: it shoots and casts instants on the move and only stands to fight when an enemy is on
      // top of it or it is hurt (otherwise both teams stall in one brawl in the middle and nobody reaches a flag)
      const push = this.role === 'offense' && this.hunt < 0 && !goal.escort && !goal.urgent
        && !enemies.some(e => hd(me, e) < 9) && me.hp > me.maxHp * 0.4;
      if (this.carrying || goal.urgent && this.hunt < 0 || leash || push) this.steer(inp, me, goal);
    } else {
      inp = { ...idle };
      this.focus = -1;
      if (!goal.escort || hd(me, goal) > 4) this.steer(inp, me, goal);
      else inp.yaw = me.yaw;
    }
    // power-ups on the way: detour when one is close
    const pu = (S.powerups || []).filter(u => hd(u, me) < 10 && Math.abs(u.y - me.y) < 1).sort((a, b) => hd(a, me) - hd(b, me))[0];
    if (pu && !this.carrying && !goal.urgent) this.steer(inp, me, pu, true);
    // stuck: jump and re-plan
    const st = this.stuck;
    if (Math.hypot(inp.mx, inp.mz) > 0.3 && !me.cast) {
      if (Math.hypot(me.x - st.x, me.z - st.z) < 0.4) { st.t += dt; if (st.t > 1.2) { inp.jump = true; this.planT = 0; st.t = 0; this.strafe = -this.strafe; } }
      else { st.x = me.x; st.z = me.z; st.t = 0; }
    }
    if (this.carrying) inp.sprint = me.stamina > 15;
    return inp;
  }
  // replace the movement with "go to goal": keep the facing the fight wants (aim), move relative to it
  steer(inp, me, goal, keepFacing = false) {
    const n = this.nav(me, goal);
    const fighting = inp.abilities?.length || inp.atkHold;
    const yaw = fighting || keepFacing ? inp.yaw ?? me.yaw : Math.atan2(n.x, n.z);
    const sy = Math.sin(yaw), cy = Math.cos(yaw);
    inp.yaw = yaw;
    inp.mz = n.x * sy + n.z * cy;
    inp.mx = -(n.x * cy - n.z * sy);
    inp.sprint = !fighting && me.stamina > 40 && inp.mz > 0.5 && hd(me, goal) > 14;
  }
}
