# 04 — Pets, summons, forms, totems and traps

Every non-champion creature the game shows: what it is, who makes it, its model, rig, animations, effects and
budget. Reference: WoW's hunter pets, a shaman's spirit wolves, a death-themed caster's ghoul and abomination, a
druid's cat / bear / tree forms and shaman totems — as archetypes only, with our own designs.

---

## 1. Inventory and problems (2026-11-27)

| Entity | Made by | Sim (hp / dmg / swing / speed / life / range) | Drawn today | Main problems |
|---|---|---|---|---|
| Silverback gorilla | Hunter Beastmaster passive pet (`classes.js:215`) | 450 / 22 / 1.3 s / 9.5 / ∞ (respawn 18 s) / 2.4 | `hunter_gorilla.glb`, UE5 humanoid rig, human UAL clips, hunch 0.42, knee −0.32, punches | human jog instead of a knuckle-walk, feet slide (rate fixed at 1.0), no slam / chest-beat, no death (removed instantly), Kill Command and Intimidation show nothing on the pet, Bestial Wrath invisible, white summon burst |
| Ghoul | Necromancer Summoner passive pet (`classes.js:246`) | 520 / 30 / 1.2 s / 11 / ∞ (respawn 8 s) / 2.2, slows 25 % | code-built UAL body (peasant + transplanted head), zombie clips, no glowing eyes | walk clip at rate 0.7 while moving 11 m/s (sliding), no spawn / death / hit, Corpse Explosion just removes it |
| Abomination | Necromancer Summoner signature (`classes.js:265`) | 800 / 40 / 1.4 s / 7.5 / 15 s / 2.8, slows 30 % | code-built bare "superhero" body at scale 1.4 with zombie clips | looks like a big human, hitbox still 1.5 m tall, no morph from the ghoul, no despawn |
| Spirit wolf | Shaman Enhancement signature (`classes.js:530`) | 400 / 28 / 1.1 s / 10 / 12 s / 2.2, slows 30 % | procedural cat skeleton (`beasts.js`) with a longer muzzle, spectral material, aura sphere | always gallops, pounce attack peaks 0.21 s after the damage, no spawn / despawn |
| Cat form | Druid Feral (default form) | champion hitbox, speed 7.8, Claws 35 / 1.5 s | `druid_cat.glb` (Tripo quadruped, 33 joints) + procedural gait | small (≈1.33 m long), one attack for every ability, no hit / stun / roar / strafe / back, receives actions meant for the hidden humanoid, no hit-stop |
| Bear form | Druid Feral (Bear Form) | speed 6.8, defense 0.3, Swipe 36 / 1.8 s | `druid_bear.glb` (17 joints; hind-right leg is **one bone**, no tail, no jaw) | stiff leg, one maul for everything |
| Tree of Life | Druid Restoration signature, 10 s | +40 % healing, slow immunity | primitive cylinder + icosahedrons treant, only sways | no walk / cast / transform; leaks its geometry (no `dispose`) |
| Fire Spirit | Shaman Elemental signature buff, 10 s | a `spirit_bolt` every 1.2 s from the shaman | white sphere + orange halo + horn cones orbiting at r 1.2 | the bolt starts at the shaman, not the spirit; no firing gesture |
| Quake / Stoneskin / Earthbind totems | Shaman zones (1.2 s / 8 s / 8 s) | can't be hit | `makeTotem`: 2.2 m pole + box head, rises from the ground | look the same, removed instantly, geometry never disposed |
| Freezing Trap | Hunter Sharpshooter zone, 20 s | r 2.5 | ring + metal torus "jaws" | no trap model, spring has no motion |
| Jungle cat | gorilla fallback | — | procedural `beasts.js` | dropped in the remodel |

Shared minion system: max 1 minion per owner, spawn 1.2 m beside the owner, `MINION_HITBOX` **r 0.45, h 1.5** for
every kind, damage at the start of the attack, `minionAtk` event has no listener, the model is removed the frame the
minion dies.

---

## 2. Design rules

1. **Animations are generated on the creature's own rig** (no retargeting from the human master): pets and forms
   have proportions a human clip can't fit. Humanoid creatures (gorilla, ghoul, abomination, treant) use Tripo's
   humanoid rig; four-legged ones (cat, bear, wolf) Tripo's four-legged rig, renamed to the standard below.
2. **Every creature has the full state set**: spawn, idle, move (speed-matched), attack variants, its specials,
   hit, stun, death. No creature vanishes on death: the sim removes it at once, the renderer keeps a **corpse
   visual** (death clip, then a 0.6 s dissolve) for 1.8 s.
3. **Locomotion speed from the sim velocity**, rate = speed / stride (no fixed 0.7 / 1.0).
4. **One material, one draw** per creature (+ shadow). Glowing eyes and runes via the emissive mask (`07-performance.md`).
5. **Sockets** (`03-weapons-and-sockets.md` §3.3) on every creature: `mouth`, `head_top`, `eyes`, `chest`, `back`,
   paws / hands, `tail_tip`, `base`, `overhead`.
6. Sim follow-ups (optional, re-run balance after): **R3** pet damage at the clip's strike time; **R4** hitbox per
   kind (gorilla r 0.60 h 1.7; ghoul r 0.45 h 1.6; abomination r 0.80 h 2.6; wolf r 0.50 h 1.1).

### 2.1 Standard four-legged rig (after renaming)

Tripo's four-legged bone names are unreliable (`1_Right_Limb_*` was the cat's tail, `Head_0..2` the bear's
spine). A one-off tool renames them from the rest-pose geometry, like `creatures.js readRig` does at runtime today,
and **rejects** rigs that don't meet the minimum:

| Bone | Required | Notes |
|---|---|---|
| `qd_root` | yes | ground, under the pelvis |
| `qd_pelvis`, `qd_spine_1`, `qd_spine_2`, `qd_chest` | ≥ 3 spine bones | chest = the front-leg junction |
| `qd_neck_1`, `qd_neck_2`, `qd_head` | ≥ 2 | |
| `qd_jaw` | wanted | Tripo doesn't make one: models are sculpted with the mouth **half open in a snarl**; a jaw bone is added only if the rig is ever done by hand |
| per leg `qd_<fl/fr/bl/br>_1` (shoulder / hip), `_2` (elbow / knee), `_3` (wrist / hock), `_4` (paw) | **≥ 3 per leg** | a one-bone leg (today's bear) → re-rig (20 credits, worth one retry) |
| `qd_tail_1..n` | wolf ≥ 4, saber-toothed cat ≥ 2 (short tail) | tail tip must carry weight |

Rest pose: standing square, all four feet flat, head straight forward (no "looking over the shoulder", today's cat
needs `HEAD_FIX`), mouth half open, facing +Z after the fix-up.

### 2.2 Four-legged animation: decision

Plan A (chosen): **Tripo AI animation on the four-legged rig**, pilot with 2 clips on the cat (idle + claw
attack, 40 credits). Plan B if the pilot fails the QA strip: keep the procedural driver (`creatures.js`) and extend
it with the missing states listed in §3. Both use the same state machine and markers, so the game code doesn't care
which one produced the motion.

---

## 3. The creatures

### 3.1 Silverback gorilla — Hunter Beastmaster pet

| | |
|---|---|
| Look | massive silverback ape with tribal war-paint and a bone-and-leather harness, a carved tusk necklace, iron-banded forearm wraps, a scar over one eye; dark grey fur, silver back, tusked jungle-troll ornaments that tie it to its master |
| Size | knuckle stance: 1.55 m at the shoulder; standing upright 2.3 m |
| Model | Tripo text → T-pose upright ape (arms out), retopo **9,000 tris**, 1 material 1024² |
| Rig | humanoid (UE5 Mannequin), check: hands with all finger joints (fists) |
| Hitbox (R4) | r 0.60, h 1.7 |
| Sockets | `grip_r/l` (fists), `head_top`, `mouth`, `chest`, `base`, `overhead` |

| Clip | Len | Markers | Motion | Plays on |
|---|---|---|---|---|
| `go_spawn` | 1.00 | — | drops in from a leap, lands on its knuckles, chest-beat | summon / re-summon (Bestial Bond) |
| `go_idle` | 3.00 loop | — | on its knuckles, shoulders rolling, looking around, snort | idle |
| `go_walk` | 1.10 loop | stride 1.8 | knuckle-walk | speed < 0.5 |
| `go_run` | 0.65 loop | stride 4.6 | galloping knuckle-run | moving (9.5 m/s) |
| `go_atk_1` | 0.80 | strike 0.24 | rears up and hammers both fists down | basic attack |
| `go_atk_2` | 0.70 | strike 0.22 | right-hook backhand swipe | basic attack |
| `go_atk_3` | 0.70 | strike 0.22 | left-hook backhand swipe | basic attack |
| `go_command` | 0.80 | strike 0.30 | huge double-fist ground slam | Kill Command (the pet's own blow) |
| `go_leap` | 0.90 | strike 0.55 | leaps onto the target and pins it | Intimidation (needs the sim to move the pet; until then it plays in place) |
| `go_beat` | 1.20 | release 0.40 | stands upright, beats its chest, roars | Bestial Wrath |
| `go_hit` | 0.35 | — | flinch, snarl | damage taken |
| `go_stun` | 1.50 loop | — | sways, shakes its head | stunned |
| `go_death` | 1.40 | — | staggers, falls on its side | death (then dissolve) |

**13 clips** (made on the gorilla's own rig).

### 3.2 Ghoul — Necromancer Summoner pet

| | |
|---|---|
| Look | gaunt, hunched undead, grey-green skin stretched over bones, exposed ribs and spine ridge, long clawed hands, torn burial wraps, iron collar with a broken chain, **glowing green eyes** (emissive) |
| Size | 1.70 m standing upright, hunched to ~1.45 m |
| Model | Tripo, T-pose, retopo **7,000 tris**, 1 material 1024² (emissive mask: eyes, rib cracks) |
| Rig | humanoid (UE5) |
| Hitbox (R4) | r 0.45, h 1.6 |
| Sockets | `grip_r/l` (claw tips), `eyes`, `chest` (Corpse Explosion centre), `base`, `overhead` |

| Clip | Len | Markers | Motion | Plays on |
|---|---|---|---|---|
| `gh_spawn` | 1.20 | — | claws out of the ground and drags itself up (the root rises from −1.2 m to 0 by code) | summon / respawn |
| `gh_idle` | 2.00 loop | — | hunched, twitching, head jerking | idle |
| `gh_run` | 0.60 loop | stride 4.8 | fast lurching run on bent legs, arms swinging low | moving (11 m/s) |
| `gh_atk_1` | 0.70 | strike 0.22 | right claw rake downward | basic attack |
| `gh_atk_2` | 0.70 | strike 0.22 | double claw swipe across | basic attack |
| `gh_hit` | 0.30 | — | jerks back, hisses | damage taken |
| `gh_stun` | 1.20 loop | — | swaying, head lolling | stunned |
| `gh_swell` | 0.40 | release 0.38 | body convulses, arms out, swells (blend shape not needed: the chest scales 1 → 1.3 by code) | Corpse Explosion, then hidden at `release` |
| `gh_death` | 1.20 | — | collapses into a heap | death (then dissolve into dust) |

**9 clips.**

### 3.3 Abomination — Necromancer Summoner signature (15 s)

| | |
|---|---|
| Look | towering stitched undead brute, bloated pale-green flesh with iron staples and stitches, one huge arm ending in a rusted **meat-hook** blade, the other a giant fist, several mismatched heads' worth of jaw, chains, a glowing green vial embedded in its belly (emissive) |
| Size | 2.70 m, very wide (shoulders 1.6 m) |
| Model | Tripo, T-pose (arms out), retopo **10,000 tris**, 1 material 1024²; the hook is part of the mesh |
| Rig | humanoid (UE5) |
| Hitbox (R4) | r 0.80, h 2.6 |
| Sockets | `grip_r` (hook tip), `grip_l` (fist), `chest` (vial), `mouth`, `base`, `overhead` |

| Clip | Len | Markers | Motion | Plays on |
|---|---|---|---|---|
| `ab_spawn` | 1.50 | — | rises from a pile of corpses (the ghoul's spot), straightens up, roars | summon (replaces the ghoul with a green burst) |
| `ab_idle` | 2.80 loop | — | heavy breathing, belly heaving, hook dragging | idle |
| `ab_walk` | 1.00 loop | stride 2.6 | lumbering heavy stride, dragging one foot | moving (7.5 m/s: walk at rate ~1.1) |
| `ab_atk_1` | 0.95 | strike 0.34 | overhead hook swing down | basic attack |
| `ab_atk_2` | 0.95 | strike 0.34 | horizontal fist sweep | basic attack |
| `ab_hit` | 0.40 | — | shrugs off the blow, grunts | damage taken |
| `ab_stun` | 1.50 loop | — | swaying, dazed | stunned |
| `ab_death` | 1.80 | — | falls forward, bursts at the seams | death / end of life (then dissolve) |

**8 clips.**

### 3.4 Spirit wolf — Shaman Enhancement signature (12 s)

| | |
|---|---|
| Look | large ghost-wolf made of storm-blue spirit light: translucent body with a bright fresnel rim, white glowing eyes, lightning crackling along the spine and paws, a wispy tail that trails light |
| Size | 1.05 m at the shoulder, 1.9 m long |
| Model | Tripo four-legged, retopo **6,000 tris**, 512² texture (most of the look is the shader) |
| Rig | standard four-legged (§2.1), tail ≥ 4 bones |
| Material | **spectral**: alpha-hashed transparency (one draw, no sorting), opacity 0.6, cyan fresnel rim (power 2.5, intensity 2), emissive mask = eyes + spine; depth write on |
| Sockets | `mouth`, `eyes`, `paw_*`, `tail_tip`, `chest`, `base`, `overhead` |

| Clip | Len | Markers | Motion | Plays on |
|---|---|---|---|---|
| `wo_spawn` | 0.80 | — | leaps out of a lightning strike, lands, shakes its fur | summon |
| `wo_idle` | 2.00 loop | — | low stance, hackles raised, panting | idle |
| `wo_trot` | 0.80 loop | stride 2.4 | trot | speed < 0.6 |
| `wo_run` | 0.55 loop | stride 4.4 | gallop | moving (10 m/s) |
| `wo_atk_1` | 0.60 | strike 0.20 | lunging bite at the throat | basic attack |
| `wo_atk_2` | 0.60 | strike 0.20 | snapping bite at the leg, head twist | basic attack |
| `wo_hit` | 0.30 | — | yelp, recoil | damage taken |
| `wo_stun` | 1.20 loop | — | shaking its head | stunned |
| `wo_despawn` | 0.80 | — | howls and dissolves upward into sparks (shader fade 0.4 s) | end of life / death |

**9 clips.**

### 3.5 Cat form — Druid Feral (default form): saber-toothed tiger

WoW's druid cat is a big predator, clearly larger than a real big cat. Ours is a **saber-toothed tiger**:
heavier and more powerful than a panther, built to pin and stab rather than chase. It carries **bull-folk druid
ornaments** so it reads as the druid: carved horn cuffs on the forelegs, a leather band with small wooden totems
around the neck, faint green glowing druidic tattoo lines that follow some of its stripes, green eyes.

| | |
|---|---|
| Look | massive, muscular saber-toothed tiger: thick forelegs and heavy shoulders, a short neck, a deep chest, a lower back that slopes to the hips, a **short thick bobbed tail**; **two long ivory saber fangs**, 0.28 m, reaching below the chin, with a thin gold band and a carved rune near each root; tawny-amber coat with dark brown tiger stripes, cream belly, throat and muzzle |
| Colours | `#c08a3a` tawny / `#3a2414` stripes / `#f0e2c4` cream / glow `#8ad86a` |
| Glows | eyes, tattoo lines (≤ 3 % of the texture) |
| Size | **2.2 m** long (body, without the tail), 1.05 m at the shoulder (today ≈1.33 m long) |
| Model | Tripo four-legged, retopo **9,000 tris**, 1 material 1024²; the sabers are part of the head mesh, weighted 100 % to `qd_head` so they never bend; mouth sculpted **half open in a snarl** so both sabers show their full length (no jaw bone, `04` §2.1) |
| Rig | standard four-legged, **tail ≥ 2 bones** (short tail), every leg ≥ 3 bones |
| Sockets | `mouth`, `saber_tip_l` / `saber_tip_r` (on `qd_head`, at the fang tips: bite impacts), `head_top`, `eyes`, `paw_*`, `tail_tip`, `chest`, `base`, `overhead` |
| Hitbox | the champion's (unchanged) |
| Prompt core | "massive muscular saber-toothed tiger with two very long ivory saber fangs reaching below the chin, thick forelegs and heavy shoulders, deep chest, short thick bobbed tail, tawny amber coat with dark brown tiger stripes, cream belly and muzzle, carved horn cuffs on the forelegs, a leather neck band with small wooden totems, faint glowing green tattoo lines along the stripes, green eyes, mouth half open in a snarl, standing square on all four legs, head straight forward" |

| Clip | Len | Markers | Motion | Used by |
|---|---|---|---|---|
| `ca_shift_in` | 0.40 | — | lands heavily on all fours out of a leap, snarls with the sabers bared | Cat Form (and match start) |
| `ca_idle` | 2.40 loop | — | low stalking stance, shoulders rolling, short tail twitching, ears turning, head low | idle |
| `ca_walk` | 1.00 loop | stride 1.8 | heavy prowl, shoulder blades rolling | speed < 0.5 |
| `ca_run` | 0.50 loop | stride 4.0 | powerful bounding gallop | moving |
| `ca_back` | 0.90 loop | stride 1.4 | backing off low, head and sabers toward the enemy | moving backwards |
| `ca_strafe_l` / `ca_strafe_r` | 0.70 loop | stride 2.0 | side-hop trot keeping the head on the enemy | strafing |
| `ca_atk_1` / `ca_atk_2` | 0.55 | strike 0.16 | right / left forepaw swipe | Claws (basic attack) |
| `ca_rake` | 0.60 | strike 0.18 | both claws raking down the target | Rake |
| `ca_shred` | 0.65 | strike 0.16, hit2 0.32 | rapid two-paw shredding | Shred |
| `ca_bite` | 0.70 | strike 0.24 | rears the head back, then drives both sabers down into the target in a stabbing bite and wrenches the head sideways | Ferocious Bite |
| `ca_pounce_start` / `ca_pounce_air` / `ca_pounce_land` | 0.12 / 0.40 loop / 0.45 | launch 0.04; land strike 0.05 | spring, stretched in the air with the claws out; lands pinning the target with both forepaws, sabers stabbing down | Wild Pounce |
| `ca_roar` | 0.90 | release 0.30 | rears its head and roars, sabers bared | Berserk Instinct |
| `ca_hit` | 0.30 | — | flinch, snarl | damage taken |
| `ca_stun` | 1.20 loop | — | dazed, swaying, head low | stunned |
| `ca_death` | 1.60 | — | collapses onto its side; then the humanoid druid's corpse replaces it with a burst of leaves | death |

**19 clips** (`ca_atk_1/2` and `ca_strafe_l/r` count as two each, the pounce as three).

### 3.6 Bear form — Druid Feral (Bear Form)

An **armoured cave bear**: massive, hump-shouldered, with carved bone plates strapped to its shoulders and brow,
the same druidic stripes (amber glow), small amber eyes.

| | |
|---|---|
| Size | **2.6 m** long, 1.5 m at the shoulder, 3.0 m when reared (today ≈2.24 m long) |
| Model | Tripo four-legged, retopo **10,000 tris**, 1 material 1024² |
| Rig | standard four-legged, **every leg ≥ 3 bones** (today's hind-right leg is one bone → re-rig) |

| Clip | Len | Markers | Motion | Used by |
|---|---|---|---|---|
| `be_shift_in` | 0.45 | — | slams down onto all fours, shakes | Bear Form |
| `be_idle` | 2.80 loop | — | heavy breathing, head swinging low | idle |
| `be_walk` | 1.20 loop | stride 1.8 | heavy walk | speed < 0.5 |
| `be_run` | 0.70 loop | stride 3.6 | lumbering charge-run | moving |
| `be_back` | 1.10 loop | stride 1.3 | backing off | moving backwards |
| `be_strafe_l` / `be_strafe_r` | 0.90 loop | stride 1.6 | side-step | strafing |
| `be_atk_1` / `be_atk_2` | 0.70 | strike 0.18 | right / left paw swipe | Swipe (basic attack) |
| `be_maul` | 0.90 | strike 0.24 | rears up and smashes both paws down | Maul |
| `be_thrash` | 0.90 | strike 0.22, hit2 0.45 | spins half around swiping, then stomps | Thrash |
| `be_roar` | 1.00 | release 0.30 | rears up and roars, chest out | Frenzied Regeneration, Berserk Instinct (bear) |
| `be_pounce_start` / `be_pounce_air` / `be_pounce_land` | 0.15 / 0.40 loop / 0.45 | launch 0.05; land strike 0.05 | heavy leap, crash landing | Wild Pounce (bear) |
| `be_hit` | 0.35 | — | grunts, recoils | damage taken |
| `be_stun` | 1.50 loop | — | dazed | stunned |
| `be_death` | 1.80 | — | rolls onto its side | death |

**18 clips.**

### 3.7 Tree of Life — Druid Restoration signature (10 s)

A **walking ancient tree-guardian**: bark body with a face in the trunk, glowing green eyes, two long branch arms
with leafy hands, root feet, a crown of blossoms and antler-like branches (ties to the druid's antler crown),
fireflies.

| | |
|---|---|
| Size | 3.0 m (crown included) |
| Model | Tripo, T-pose (branch arms out), retopo **10,000 tris**, 1 material 1024² (leaves as solid clumps, no alpha cards) |
| Rig | humanoid (UE5) — a two-legged tree with arms; check that the crown is weighted to `head` / `spine_05` |
| Sockets | `grip_r/l` (palm of the branch hands: heal origin), `head_top`, `eyes`, `base`, `overhead` |

| Clip | Len | Markers | Motion | Used by |
|---|---|---|---|---|
| `tr_shift_in` | 0.60 | — | unfolds upward from a crouch, branches spreading (scale 0.6 → 1.0 by code, overshoot) | Tree of Life start |
| `tr_shift_out` | 0.40 | — | folds down into a crouch (then the druid reappears in a burst of leaves) | end of the 10 s |
| `tr_idle` | 3.00 loop | — | swaying, leaves rustling, breathing | idle |
| `tr_walk` | 1.20 loop | stride 2.4 | lumbering root-footed walk, arms swinging slowly | moving |
| `tr_pre_loop` | 1.20 loop | — | both branch arms raised, gathering light | casting (Regrowth) |
| `tr_rel_ally` | 0.60 | release 0.15 | sweeps a branch hand toward the ally, petals fly | Regrowth, Rejuvenation |
| `tr_rel_dir` | 0.55 | release 0.12 | points a branch at the enemy | Moonfire, Wrath (basic attack) |
| `tr_stomp` | 0.70 | strike 0.25 | stamps a root foot, roots burst | Entangling Roots |
| `tr_hit` | 0.40 | — | creaks back | damage taken |
| `tr_stun` | 1.50 loop | — | sways, leaves falling | stunned |

**10 clips.** Death in tree form: the form ends (the druid reverts, then `cm_death_*`).

### 3.8 Fire Spirit — Shaman Elemental signature (buff, 10 s)

A small **horned fire elemental**: a molten-rock skull with two curved horns, a body of flame below it.

| | |
|---|---|
| Model | tiny mesh: rock skull + horns, **400 tris**, 256² (in the VFX atlas), emissive cracks |
| Rest | flame body = VFX (flipbook fire, 40 particles) |
| Motion | orbits at r 1.2 m, height +2.4 m (as today), bobbing ±0.1 m; turns to face the target |
| Firing | every 1.2 s: 0.15 s "inhale" (skull pulls back, flame flares) → `spirit_bolt` **leaves from the spirit** (the visual origin blends from the spirit to the sim's path over 0.18 s, like weapon-tip projectiles today) |
| Spawn / end | bursts out of the relic in a pillar of fire; at the end shrinks into embers |

### 3.9 Totems (Shaman)

Static models (no rig), **1,200 tris** each, one shared 1024² totem atlas. Rise: `y = −2.2 → 0` in 0.25 s with a
0.08 m overshoot and dust; end: sink 0.4 s + crumble VFX (today they vanish). Glow via the emissive mask, pulsing.

| Totem | Look | Height | Glow |
|---|---|---|---|
| Quake | cracked basalt pillar with an amber earth rune, stones orbiting the top | 2.2 m | amber `#ffa040`, pulses faster as the 1.2 s eruption nears |
| Stoneskin | mossy grey stone with a green crystal set in a carved face | 2.0 m | green `#b0ff80` |
| Earthbind | carved wooden totem wrapped in living roots, a spiral earth glyph | 2.0 m | tan `#d0b070` |

### 3.10 Freezing Trap (Hunter Sharpshooter)

| | |
|---|---|
| Model | iron bear-trap jaws on a round plate with a frost rune, **600 tris**, 2 jaw halves as separate nodes |
| Size | Ø 0.9 m |
| Armed | jaws open flat; rune glows faintly; enemies see it at 18 % opacity (as today) |
| Spring | jaws snap shut in 0.08 s (rotate 80° each), frost burst, then the victim is frozen (`cm_frozen` + ice shell) |

---

## 4. Form state machine (druid)

Forms get their own state machine instead of reacting to actions meant for the hidden humanoid:

| Input | Cat | Bear | Tree |
|---|---|---|---|
| basic attack (`auto`, `hitAt`) | `ca_atk_1/2` alternating, strike on `hitAt` | `be_atk_1/2` | `tr_rel_dir` (Wrath) |
| ability → clip (manifest `abilities`) | Rake `ca_rake`, Shred `ca_shred`, Ferocious Bite `ca_bite`, Wild Pounce `ca_pounce_*`, Berserk Instinct `ca_roar`, Bear Form → swap | Maul `be_maul`, Thrash `be_thrash`, Frenzied Regen `be_roar`, Wild Pounce `be_pounce_*`, Cat Form → swap | Regrowth `tr_pre_loop` → `tr_rel_ally`, Rejuvenation `tr_rel_ally`, Moonfire `tr_rel_dir`, Roots `tr_stomp`, Wild Charge `tr_walk` (fast) |
| move / back / strafe | run / back / strafe clips | same | walk |
| stunned / disoriented / frozen | `*_stun` / `*_stun` / pose freeze | same | same |
| hit | `*_hit` (additive during attacks) | same | same |
| hit-stop | yes (update the form after the dt scaling) | yes | yes |
| swap | VFX burst 0.25 s covers it: old model hidden at +0.05 s, new model plays `*_shift_in` | same | `tr_shift_in` / `tr_shift_out` |

The cat / bear / tree models also get the champion's material treatment: rim light, stealth opacity, hit flash
(today `formMats` skip emissive materials and rim).

---

## 5. Budget summary

| Creature | Tris | Joints | Texture | Clips | Draws |
|---|---|---|---|---|---|
| Gorilla | 9,000 | ~80 | 1024² | 13 | 1 + shadow |
| Ghoul | 7,000 | ~80 | 1024² | 9 | 1 + shadow |
| Abomination | 10,000 | ~80 | 1024² | 8 | 1 + shadow |
| Spirit wolf | 6,000 | ≤ 40 | 512² | 9 | 1 (no shadow: spectral) |
| Cat form (saber-toothed tiger) | 9,000 | ≤ 40 | 1024² | 19 | 1 + shadow |
| Bear form | 10,000 | ≤ 40 | 1024² | 18 | 1 + shadow |
| Tree of Life | 10,000 | ~80 | 1024² | 10 | 1 + shadow |
| Fire Spirit | 400 | 0 | VFX atlas | — (code) | in the VFX draw |
| 3 totems | 3 × 1,200 | 0 | 1024² shared | — (code) | 1 each |
| Freezing Trap | 600 | 0 | in the totem atlas | — (code) | 1 |
| **Total** | | | | **86 clips** | |

At most on screen in a 2v2: 2 pets + 1 summon + forms replace their champion (no extra), 2 totems, 1 trap.
