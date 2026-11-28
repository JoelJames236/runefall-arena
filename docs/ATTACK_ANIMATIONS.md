# Basic-attack animations

Status: **built** (2026-11-27). Every champion's basic attack (left click) plays a real motion made with Tripo
Studio's AI animation, timed so the blow lands exactly when the sim deals the damage.

## Why

The old attacks used the few clips of the animation library: melee champions played only the short strike part of a
sword clip, sped up, so "the weapon just moves a bit"; the rogue punched, casters all played one generic spell shot
and the hunter fired a pistol. The user asked for every basic attack to move the weapon the way you would in real
life — a real swing for melee, a nice motion for the mage's wand.

## The motions

Made with **Tripo Studio → Animate → Eigene Animation (AI, text → motion)**, 20 credits each, on a rigged human
(the arena guard K12 from the colosseum crowd, Mixamo skeleton). Prompts: `assets/models/anims/attacks.map.json`
maps each generated clip (Tripo names it after its prompt, cut to 64 characters) to its id.

| Id | Motion | Used by | Grip | Strike (s into the clip) |
| --- | --- | --- | --- | --- |
| `sword_fore` | diagonal forehand cut | Protection Paladin | rev | 1.33 |
| `sword_back` | backhand cut, left → right | Protection Paladin, Protection Warrior | rev | 1.25 |
| `chop_r` | big one-handed axe chop over the right shoulder | Protection Warrior, Fury Berserker, Enhancement Shaman | fist | 1.52 |
| `chop_l` | the same with the left hand | Fury Berserker, Enhancement Shaman | fist | 1.20 |
| `axe2h` | two-handed diagonal chop over the right shoulder | Arms Warrior, Executioner, Crusader Paladin | fist | 0.93 |
| `sweep2h` | two-handed horizontal sweep | Arms Warrior, Executioner | rev | 0.45 |
| `smash2h` | warhammer raised overhead, slammed into the ground | Crusader Paladin | fist | 1.32 |
| `stab_r` | lunging dagger stab | Rogue | idle | 0.56 |
| `hook_l` | dagger hook slash, left hand | Rogue | idle | 0.57 |
| `wand` | wand cocked by the shoulder, flicked at the target | Mage | rev | 0.53 |
| `scepter` | scepter raised overhead, swung forward to point | Priest, Elemental Shaman | fist | 1.05 |
| `staff` | staff drawn back, thrust head-first at the target | Necromancer, Druid | fist | 0.55 |
| `bow` | loose at full draw, then nock and draw again | Hunter | palmRev | 1.20 |

Three generated motions were dropped after testing (a weak right-hand axe chop with the arm hanging low, a left-hand
chop with both arms flailing, a warhammer "smash" that only held the hammer out like a lance); they were made again
with more precise prompts (`chop_r`, `chop_l`, `smash2h`). Cost: 16 × 20 = 320 credits.

## How it works (`js/render/attack-anims.js`, `js/render/heroes.js`)

1. **Extract**: `node tools/anim-extract.mjs <export.glb> assets/models/anims/attacks.json --map attacks.map.json`
   keeps the skeleton's rest pose and the clips' rotations (+ hip translation), no mesh, no fingers — 667 kB.
2. **Load**: the skeleton is rebuilt with UAL bone names; the champion retargeting (`champions.js`, now with a
   second source skeleton) turns each clip onto every champion.
3. **Facing**: the generated motions turn the whole body (a backhand spins the hips ~120°); 75 % of the hips'
   heading is taken out so the champion keeps facing where its player aims (the spine's twist stays).
4. **Cut**: each clip is trimmed to wind-up + strike + follow-through + recovery around its strike.
5. **Strike times** were measured on the champions with their real weapons: the moment the **weapon tip** moves
   fastest with the blade in front of the body (a sword cut is mostly forearm and wrist: the hand moves ~20 cm,
   the tip over a metre), then checked frame by frame.
6. **Timing in play**: a melee blow lands `hitAt` after the click (0.13–0.24 s, from the sim). The whole wind-up is
   shown, sped up (≤ 2.2×) so the strike frame falls exactly on `hitAt`; strike, follow-through and recovery run at
   natural speed. A ranged shot leaves at the click, so its release is played 0.14 s later (the flick and the bolt
   read as one motion).
7. **Grip**: the weapons' idle grips were set by eye for the hanging idle hand; the motions hold weapons the real
   way. During a Tripo attack each weapon turns (and turns back as the attack fades) into the grip that points the
   blade at the enemy when the blow lands: `fist` (through the fist toward the thumb), `rev` (turned over), `palmRev`
   (along the palm's normal — the upright bow) or `idle`. Such weapons are kept out of the body-mesh merge
   (`noMerge`), about one extra draw call per champion.
8. **Off-hand**: a shield, tome or relic stays in guard — the clip's left arm is replaced by the idle pose
   (`<clip>|offL`).
9. **Fallback**: if `attacks.json` fails to load, the old library clips play.

## Checking a motion

In the game page: `CLIPS['raw:<id>']` holds each untrimmed motion, so it can be stepped frame by frame on any
champion; `handPath(id)` (attack-anims.js) prints the source hand's path. Test strips used for tuning: a side view of
six frames from the click through the strike to the recovery, for every class.

## Adding a motion

Generate it in Tripo (Animate → AI, on the K12 guard), click its card and wait a few seconds (only loaded motions
can be exported), export GLB with the skeleton and all motions, add a line to `attacks.map.json`, re-extract, add
an entry to `ATTACK_ANIMS` (hand, strike time, grip) and use the id in `ACTIONS.attack` (heroes.js).

## Manifest-driven clips (remodel)

Status (2026-11-28): **live for the pilot**. `sns.json` (sns_idle, sns_atk_1..3) and `cm.json` (cm_run, cm_hit_front)
ship. The `sns` set is on for Protection Paladin only (the assembled pilot); Protection Warrior keeps its old clips until
its own model is assembled (its axe and round shield need their own pass). `cm_run` and `cm_hit_front` are common:
every champion without its own walk runs and flinches with them. The remodel's 192 clips
(`docs/remodel/05-animations.md`) come in per stance set and are described by a manifest instead of `ATTACK_ANIMS`.
Pilot: `sns` (Protection Paladin / Warrior) + the common `cm_run` and `cm_hit_front`.

### Files

- `assets/models/anims/manifest.json` — the 05 §7 format: `clips`, `sets` (`'class:spec'` → set), `attacks`
  (set → ids; `[[right…], [left…]]` for dual wield), `idle` (set → id), `abilities`, `fallback` (id or
  `'pattern_*'` → id or [ids]), plus `files` (`"sns.json": false` while a set isn't made: it isn't fetched, so no
  404). A clip: `{ file, src, trim, layer, loop, markers, speed }` and optionally `hand` (`r`/`l`, striking hand),
  `grip` (today's weapon turn), `offL` (true = replace the left arm by the idle pose), `stride` (m per cycle),
  `ikL`, `keepTurn` (hip heading kept, default 0.25), `measured: false` (placeholder markers). `trim` is
  `[start, end]` s in the set file's clip, `null` = whole clip; **markers are s into the trimmed clip**.
- `assets/models/anims/<set>.json` — same shape as `attacks.json`, made by
  `node tools/anim-extract.mjs <export.glb> [more.glb] --set <set> [--map m.json] [--out f.json]`. The map defaults
  to `<set>.map.json`; its ids are the manifest ids (`[["^\\[sns_atk_1\\]", "sns_atk_1"], …]`, or `{ id: regex }`;
  an optional third element `{ markers }` is carried into the file as defaults). The tool lists the manifest clips
  still missing from the file and, when it writes to the default place, flips `files["<set>.json"]` to `true`.

### API (`js/render/attack-anims.js`)

| | |
|---|---|
| `loadManifest()` | fetches the manifest and every set file that exists; builds each clip like `loadAttackAnims` (UAL names, `steadyHeading`, `trim`). Never throws; memoised |
| `MANIFEST` | the parsed tables (empty until loaded) |
| `MANIFEST_CLIPS[id]` / `MANIFEST_RAW[id]` | trimmed / untrimmed `THREE.AnimationClip`, only for clips that loaded; `userData` = `clipMeta(id)` + `src: 'tripo'` |
| `clipMeta(id)` | `{ layer, loop, markers, impact (strike ?? release), speed, trim, hand, grip, offL, stride, ikL, keepTurn, measured, loaded, from, to, source }`; `null` for non-manifest names |
| `clipSource(id)` | the skeleton the clip was made on (`{ key, rest, … }`); a set made on the K12 guard shares `animSource()` (`key: 'attacks'`) |
| `setOf(cls, spec)` | stance set (`setOf('warrior','protection')`, `setOf('paladin:protection')`); no spec → the class's default spec |
| `attacksFor(cls, spec, { has, always })` | the set's attack clips, resolved; `null` while none of them has loaded (keep today's list) |
| `idleFor(cls, spec, { has, always })` | the set's idle clip; `null` while it hasn't loaded |
| `resolveClip(id, has)` | `id` if loaded, else its fallback chain down to a UAL / `attacks.json` name; `has(name)` skips names heroes.js lacks |
| `measureStrike(id)` | hand-peak strike of a loaded clip in raw and trimmed time (05 §8.3), next to the manifest value |

### heroes.js integration (done 2026-11-28)

Pass `this.cls, this.spec`, not `this.lookKey`: Protection Warrior's look key is plain `'warrior'`.
`const has = n => !!CLIPS[n];`

1. **Import** `loadManifest, MANIFEST_CLIPS, MANIFEST_RAW, clipMeta, clipSource, attacksFor, idleFor, resolveClip`.
2. **`loadHeroAssets`**, in the existing `try` right after the `ANIM_CLIPS` loop (`loadAttackAnims` first, so a set
   made on the same master reuses its source):
   ```js
   await loadManifest();
   for (const [n, c] of Object.entries(MANIFEST_CLIPS)) {
     const m = clipMeta(n), source = clipSource(n);
     const cc = cleanClip(c); CLIPS[n] = splitClip(cc, lowerSet); Object.assign(CLIPS[n], { clean: cc, src: 'tripo', speed: m.speed, source });
     if (m.impact != null) IMPACT[n] = m.impact; // the strike / release marker replaces ATTACK_ANIMS[n].at
     const rc = cleanClip(MANIFEST_RAW[n]); CLIPS['raw:' + n] = splitClip(rc, lowerSet); Object.assign(CLIPS['raw:' + n], { clean: rc, src: 'tripo', source });
   }
   ```
3. **Retarget per source** in `clip(name)`'s Tripo branch: `const src = S.source || animSource();` and cache the
   analysis per `src.key` — code-built bodies `TRIPO_ON[src.key] ||= analyse(GL.Male_Ranger.scene, src.rest)`
   (`'attacks'` = today's `TRIPO_ON_UAL`), generated ones `champ.ATs[src.key] ||= analyse(champ.scene, src.rest)`
   (`'attacks'` = today's `champ.AT`).
4. **Idle**: in the constructor `this.idle = idleFor(cls, spec, { has }) || look.idle;` (never write `look.idle`:
   looks are shared) and use `this.idle` wherever `this.look.idle` is read (`setLoco` at the end of the
   constructor, `update()`'s default loco, the `|offL` idle pose).
5. **`ACTIONS.attack`** in `play()`: `const man = kind === 'attack' && attacksFor(this.cls, this.spec, { has });`
   `let list = man || spec[this.lookKey] || spec[this.cls] || spec.any;` — a flat list picks at random without
   repeating the last one (05 §4.3), a nested list alternates its sub-lists R → L on its own counter (05 §4.5);
   neither moves `this.side` (05 §10.2).
6. **Strike timing**: unchanged code — `IMPACT[base]` now holds the marker (step 2) and `CLIPS[base].speed` the
   manifest speed, so the existing wind-up compression lands `strike` on `hitAt` (`release` at `RANGED_LEAD`). The
   05 §6 cap is 2.0× (today 2.2×).
7. **Off-hand and grip**: `const m = clipMeta(base);` → `|offL` only when `m ? m.offL : ATTACK_ANIMS[base]?.hand !== 'l'`
   (sns clips hold the shield themselves); in `update()`'s `gripOf`, `(clipMeta(id)?.grip ?? ATTACK_ANIMS[id]?.grip) || 'fist'`.
8. **Layers** (`m.layer`): `full` → play the `full` part (`full = m ? m.layer === 'full' : !!spec.full`);
   `upper` → as today (the full copy drives the legs only while standing still); `lower` → a locomotion clip
   (`setLoco`), its upper half replaced by `<set>_run_up` once that exists; `additive` → after retargeting,
   `THREE.AnimationUtils.makeClipAdditive(clip)` and `action.blendMode = THREE.AdditiveAnimationBlendMode`
   (not before: `retargetClip` needs absolute rotations). `m.loop` → `LoopRepeat`, else `LoopOnce`.
9. **Locomotion / hits**: run clip `resolveClip('cm_run', has)` (`Jog_Fwd_Loop` until `cm.json` ships;
   `look.walk` still wins); with a manifest clip, `timeScale = v · duration / (stride · height / 1.95)` (v = sim
   speed in m/s). `hit()` plays `cm_hit_front` only when `MANIFEST_CLIPS.cm_hit_front` exists, else keeps today's
   random `Hit_Chest` / `Hit_Head`.

While `files` says `false`, `attacksFor` / `idleFor` return `null` (the fallback with `always`) and
`resolveClip` gives today's clips, so wiring this in changes nothing until a set file ships. Markers flagged `measured: false` are the 05 §4 targets: set `trim` so the cut
matches them, or measure (`measureStrike(id)`, then frame by frame with `CLIPS['raw:<id>']`) and write them in.

At load (`buildClip`), after the trim: a `loop` clip is **closed** (the difference between its last and first key is
spread over the clip, so it has no pop), and `inPlace` (default `true`) does the same for `pelvis.position` of a
one-shot: the AI motions carry root motion (the pilot run travelled 2 m in 2 s) and the sim moves the champion.
An `inPlace` clip is then **re-centred**: the horizontal offset of its first key from the rest pose is taken out of
every key (a run trimmed at 0.4 s had already travelled ~1.5 m: the body ran ahead of its champion); the bob stays.
A manifest run (`stride` set) plays at ground speed / (stride × height / 1.95), at most `RUN_RATE_MAX` (1.7,
heroes.js); `world.js` passes the speed in m/s as `st.v`.

### What the pilot taught (Tripo AI motions, 2026-11-28)

- **Never name the off-hand item in an attack prompt.** "… and a tower shield on the LEFT forearm" made the model
  swing the shield arm in all six clips, even with "only the right arm attacks, the left arm does not move". The
  sword-only style of `attacks.json` works: "A swordsman in a ready stance holding a one-handed sword in his right
  hand …, his left fist stays in front of his chest". The shield is held in guard by `offL: true` instead. An idle
  may name the shield (it shapes the stance).
- **Two variants per clip** (20 credits each), then pick on the source skeleton: the right hand's path must be longer
  than the left's, `measureStrike` gives the strike, a front-view strip (`|offL`, the real items) decides.
- **Trims**: each attack keeps ~0.4 s before the blade's speed peak and ~0.6 s after (1.0 s clips: chop [0.20, 1.20],
  diagonal [0.25, 1.25], backhand [0.17, 1.17] raw s). Checked in game: the strike lands on hitAt (0.13 / 0.18 /
  0.24 s) within one frame with the blade at full speed (chop 30, diagonal 15, backhand 16 m/s), and the three attacks
  are picked at random without repeats.
- **Loops**: the period comes from leg-pose self-similarity, the stride from the planted foot's speed against the
  pelvis. The first run was a 2.86 m/s jog (0.667 s, 1.91 m per cycle, ~30 % foot slide at 7 m/s); "sprinting"
  prompts were irregular. The run in use came from "an athlete running at a fast steady pace with long powerful
  strides, a perfectly regular running cycle": 3.95 m/s, 0.479 s and 1.89 m per cycle, seam 6.7° before closing; it
  is stride-matched up to 6.75 m/s and slides ~4 % at 7 m/s (the 1.7× cap).
- **Grip**: these motions hold the hand so that the blade leaves the fist on the **little-finger side** (as the old
  `attacks.json` sword clips: `grip: 'rev'`). With the thumb-side socket the tip was below knee height in 79 % of the idle
  and 55–74 % of the swings. A manifest `grip` now also turns an assembled weapon: the `grip_r` / `grip_l` socket joint
  is rotated 180° about its palm axis (heroes.js `gripMode` / `turnGrips`, blended over 0.12 s; the playing attack's
  grip, else the locomotion clip's, else the idle's). All four `sns` clips are `rev`: the tip never drops below the
  knees, the idle holds the sword high. Strikes re-measured as the blade tip's speed peak: chop 0.33, backhand 0.45.
- **No right-to-left cuts behind a tower shield.** Six forehand takes (incl. "at arm's length, far out in front")
  all crossed the body behind the shield held in guard and were slow (tip 7–15 m/s, jerky). Thrusts were weak too
  (the whole body lunges, tip 6–7 m/s). `sns_atk_2` is now a **diagonal cut on the sword side**: "swings from above
  his right shoulder down and outward to beside his right knee, the arm extended away from the body" — right hand
  path 2.6 vs 0.9 for the left, tip 15 m/s in front at waist height, over the shield's top seen from the front.
- **Hit**: the chest-hit clip leans back until 0.42 s and is upright again at 0.78 s; trimmed to [0, 0.78].
- Source of the pilot clips: `assets/models/anims/src/anim_pilot_v5.glb` (all 32 motions made on the master, task
  3aae5edf-641b-4820-aec8-088f014ad17f); `sns.map.json` / `cm.map.json` pick the four + two used.
