# 05 — Animations (champions: attacks, spells, movement, reactions)

The complete humanoid animation set: **192 clips** in 9 sets, with the motion each clip must show, its length, its
timing markers and who plays it. Pets and forms are in `04-pets-summons-forms.md`.

Reference model: WoW gives every weapon stance its own ready pose, attacks (several random variants), parry and
run arms (`Ready1H`, `Ready2H`, `ReadyBow`, `Attack1H`, `Attack2H`, `AttackOff`, `ShieldBash`, `Special1H/2H`,
`Whirlwind` …) and splits spellcasting into **directed** and **omni** (`SpellPrecast`, `ReadySpellDirected/Omni`,
`SpellCastDirected/Omni`, `ChannelCastDirected/Omni`, `SpellCastArea`, `BattleRoar`). When a model lacks an
animation it falls back to a related one. We copy that structure, not any motion or name.

---

## 1. What is wrong today (inventory 2026-11-27, file:line in the research notes)

| Area | Today | Problem |
|---|---|---|
| Ability motions | ~30 abilities share `Spell_Simple_Shoot` ("raise"), ~25 share it as "release"; melee abilities use `Sword_Regular_A/B` cut to **0.25 s** | twitches; a mage nova plays a sword swing; rogues punch with daggers in hand |
| Casts | one pose (`Spell_Simple_Idle_Loop`) for every cast; `castProgress` is passed but ignored | a bow's Aimed Shot, a heal and a frost lance look identical |
| Basic attacks | 2 Tripo clips per weapon, alternated; **every** wind-up is compressed at the 2.2× cap and 1–42 % of it is skipped | the start of each swing is missing; `side` also toggles on abilities, so the alternation drifts |
| Locomotion | no walk, no strafe (body yaw hack), backpedal = jog reversed, no jump start / land / fall | foot sliding; legs never step sideways |
| Movement abilities | forward `Roll` (0.66 s) for every dash, blink, disengage (backwards!) and teleport; charges fixed at 0.7 s; `dashEnd` ignored | wrong direction, wrong length, no landing |
| Whirlwinds | `Sword_Regular_Combo` ×1.6 with the mesh spun at 16 rad/s | two-handers hold a one-hand combo; it's a spin hack |
| Reactions | hits are swallowed while any action plays; DoT/zone ticks re-trigger hits; no direction | either no reaction or constant flinching |
| CC | stun / disorient = procedural head wobble; roots, silence, freeze, knockdown: nothing | "Knocked Down" stuns stand upright; the freezing trap sways its head |
| Death | one `Death01`; an upper-body action keeps playing over it; `deadT` never set | the last hit's flinch overlays the death |
| Victory | `Dance_Loop` for everyone, warriors just idle | — |
| Timing | instant abilities deal damage at the press, the clip strikes 0.07 s later (`STRIKE_LEAD`); ranged autos release 0.14 s after the bolt spawned | numbers appear before the blow |

---

## 2. Rules every clip follows

1. **Skeleton**: authored on the animation master (§8), exported with Mixamo or UE5 names, mapped to the UAL names
   the retargeter uses (`attack-anims.js` map). Rotations for every body bone + `pelvis` translation. **No finger
   tracks** (the finger layer poses hands per held item, `03-weapons-and-sockets.md` §5).
2. **In place**: pelvis travel ≤ 0.15 m horizontally (except `*_charge_*`, `*_leap_*`, dashes, which keep their
   forward motion only as body lean, never as translation — the sim moves the champion). Pelvis yaw at any strike /
   release marker within ±30° of forward (the retargeter removes 75 % of hip heading as today).
3. **Start and end in the stance's idle pose** (one-shots) so blends are short (0.08 s in, 0.12–0.20 s out).
   Loops: first and last key identical.
4. **Weapon-true**: the motion is generated with the weapon described in the prompt and checked with the real item
   on its socket (motion strip, §9). The item never turns in the hand.
5. **Markers** (in the animation manifest, §7): `strike` (melee contact), `release` (spell / projectile leaves),
   `hit2` (second contact), `item_hide_l/r`, `item_show_l/r` (thrown weapons), `foot_l`, `foot_r` (locomotion),
   `launch` / `land` (leaps), `loop_from` (for start+loop clips), `ikL_on` / `ikL_off` (two-hand IK weight).
6. **Layers**: `full` (whole body), `upper` (spine_01 and above + arms; legs come from locomotion when moving, from
   the clip itself when standing still — today's full-body copy, `heroes.js:770`), `lower` (pelvis + legs),
   `additive` (made additive against its own first frame; plays on top of anything).
7. **Lengths** below are the target length **after trimming** at natural speed. Wind-up (start → strike) of a
   basic attack ≤ **0.32 s** one-handed, ≤ **0.40 s** two-handed at natural speed, so the timing contract (§6) needs
   ≤ 2.0× compression (≤ 1.6× preferred).

---

## 3. Stance sets (who uses what)

| Set | Stance | Specs | Main hand → off hand |
|---|---|---|---|
| `sns` | one-hand weapon + shield | Warrior Protection (orc), Paladin Protection (human) | orc axe / holy sword → round shield / tower shield |
| `th` | two-handed weapon | Warrior Arms (orc), Berserker Executioner (dwarf), Paladin Crusader (human) | great axe / headsman axe / sun hammer, left hand on `grip2` (IK) |
| `dw` | two one-handed axes | Berserker Fury (dwarf), Shaman Enhancement (orc) | war axe → war axe / storm axe → storm axe |
| `dg` | two daggers | Rogue Subtlety, Rogue Assassination (human) | fang → fang |
| `mc` | one-hand mace or scepter, free or item hand | Priest Discipline, Priest Shadow (human), Shaman Elemental (orc, relic) | scepter / storm mace → empty / relic |
| `wd` | wand + book | Mage Frost, Mage Fire (sun elf) | wand → tome |
| `st` | staff | Necromancer Summoner, Necromancer Curser (undead), Druid Restoration (bull-folk) | staff (one hand, optional `grip2`) |
| `bw` | bow | Hunter Beastmaster, Hunter Sharpshooter (jungle troll) | (string hand) → bow |
| `cm` | common, every humanoid | all | — |

Druid Feral's humanoid body is only seen on the class screen (the preview shows Cat form); it uses `dw_idle` with
the `claw` hand pose.

Race posture stays procedural on top (hunch: orc 0.14, troll 0.24×1.7, undead 0.16, bull-folk 0.12; troll knee
−0.22) but is re-tuned per new model (`02-champions.md`).

---

## 4. The clips

Columns: **Id** · **Layer** · **Len** (s) · **Markers** (s) · **Motion** — the core of the generation prompt (§8.2
wraps it) · **Used by**. Prompts never name a game or a character.

### 4.1 Common — locomotion (lower body, shared by every humanoid)

All locomotion loops are phase-synced (left foot down at phase 0, right at 0.5) so they can blend in 8 directions.
`stride` = metres travelled per cycle on a 1.95 m champion; playback rate = speed / (stride × height / 1.95).

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `cm_walk` | lower | 1.10 | foot_l 0, foot_r 0.55; stride 1.6 | relaxed combat walk, knees soft | speed < 0.45 (slows, roots ending) |
| `cm_run` | lower | 0.70 | foot_l 0, foot_r 0.35; stride 4.2 | athletic run, heavy footfalls, slight forward lean | forward |
| `cm_run_back` | lower | 0.80 | stride 2.8 | backpedal run, short steps, leaning forward | moving > 120° from facing |
| `cm_strafe_l` / `cm_strafe_r` | lower | 0.75 | stride 3.0 | side-step run with cross-over steps, hips square to the front | 60–120° from facing; blended with run / run_back for diagonals |
| `cm_sprint` | lower | 0.60 | stride 4.8 | full sprint, long strides | speed > 1.12 (stamina sprint, speed buffs) |
| `cm_jump_start` | lower | 0.15 | launch 0.06 | crouch and explode upward | jump, falling off the bridge edge (skipped) |
| `cm_jump_air` | lower | 0.80 loop | — | legs tucked slightly, one knee higher | airborne < 0.8 s |
| `cm_fall` | lower | 0.60 loop | — | legs reaching for the ground, balancing | airborne ≥ 0.8 s |
| `cm_land` | lower | 0.25 | — | absorb the landing, knees bend, recover | landing |
| `cm_land_heavy` | full | 0.45 | — | heavy landing in a crouch, one hand near the ground | landing after a fall > 2.5 m (bridge 4.4 m) |
| `cm_turn_l` / `cm_turn_r` | lower | 0.45 | — | two shuffle steps turning 90° in place | standing, facing changes > 50° |

### 4.2 Common — reactions, crowd control, movement abilities, death

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `cm_hit_front` | upper | 0.35 | — | torso knocked back from a blow to the chest, head snaps back, recover | hit from the front, no action playing |
| `cm_hit_back` | upper | 0.35 | — | jolted forward from a blow in the back, shoulders hunch | hit from behind |
| `cm_hit_heavy` | full | 0.70 | — | staggered back one step, arms flung out, regain stance | crits, big hits (≥ 12 % max HP) |
| `cm_hit_add` | additive | 0.25 | — | short upper-body jolt (made additive) | any hit while an action plays (today swallowed) |
| `cm_stun_start` | full | 0.25 | — | dazed: head lolls, knees buckle slightly, weapon arms drop | stun begins |
| `cm_stun_loop` | full | 2.00 loop | — | dazed sway in place, head drooping and circling, arms hanging | stun (Skull Crack, Comet, Hammer of Light, Intimidation, Wild Pounce) |
| `cm_knockdown` | full | 0.45 | — | knocked off the feet, falls on the back | stuns that knock down: Meteor, Ground Breaker, Quake Totem |
| `cm_down_loop` | full | 1.20 loop | — | lying on the back, stirring | while knocked down |
| `cm_getup` | full | 0.60 | — | rolls to a knee and rises to stance | starts 0.6 s before the knockdown stun ends |
| `cm_disorient_loop` | full | 2.00 loop | — | blinded and terrified: one arm shielding the eyes, stumbling in place, flinching | Blinding Light, Psychic Scream |
| `cm_root_struggle` | lower | 1.20 loop | — | feet stuck, legs straining to pull free, hips rocking | rooted and pressing a move key |
| `cm_silence_add` | additive | 0.60 | — | head jerks back, shoulders hunch, a choked gasp | silenced |
| `cm_interrupt` | upper | 0.45 | — | recoil from a burst between the hands, hands flung apart | cast interrupted / fizzled |
| `cm_frozen` | — | — | — | **no clip**: the current pose freezes (time scale 0), ice shell VFX | Freezing Trap, Glacial Nova root, Frostbite's root |
| `cm_dash_fwd` | full | 0.30 | — | low forward lunge-dash, torso nearly horizontal, arms swept back, then rise | Gale Dash, Blazing Step, Wild Charge (played at sim dash length 0.22–0.30 s) |
| `cm_dash_back` | full | 0.35 | land 0.30 | backward leap: push off, legs tucked, land in a crouch facing forward | Disengage (backwards, 0.3 s) |
| `cm_blink_in` | full | 0.30 | — | appears crouched, rises into stance, cloth settles | Arcane Shift (end point), Grave Step (rises as if from the ground) |
| `cm_death_front` | full | 1.60 | — | killed from the front: knees buckle, falls backward, comes to rest | killing blow from the front |
| `cm_death_back` | full | 1.60 | — | killed from behind: pitches forward onto the face | killing blow from behind |
| `cm_death_heavy` | full | 2.00 | — | drops to both knees, weapon falls, collapses sideways | killing blow is a crit |
| `cm_defeat` | full | 2.50 then hold | — | sinks to one knee, head bowed | survivors of the losing team at round end (tier 2) |

`cm_frozen` needs no file. Total common: **34 entries, 33 clip files** (13 locomotion + 20 others).

### 4.3 `sns` — one-hand weapon + shield (Warrior Protection, Paladin Protection)

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `sns_idle` | full | 2.40 loop | — | combat stance: shield raised before the chest (forearm across, face forward), weapon held high behind the shield's edge, knees bent, slow breathing | idle |
| `sns_run_up` | upper | 0.70 loop | — | running with the shield held before the chest, weapon arm pumping, weapon pointing up-back | run, strafe, back |
| `sns_sprint_up` | upper | 0.60 loop | — | shield tucked to the chest, weapon arm swinging low | sprint |
| `sns_atk_1` | upper | 0.80 | strike 0.28 | overhand chop from above the right shoulder down to the left hip, shield stays in guard | basic attack (random, no repeat) |
| `sns_atk_2` | upper | 0.80 | strike 0.26 | forehand diagonal cut right-to-left at chest height | basic attack |
| `sns_atk_3` | upper | 0.80 | strike 0.26 | backhand horizontal cut left-to-right, shield swings aside | basic attack |
| `sns_rend` | upper | 0.85 | strike 0.28 | weapon raised high, hacked down and dragged back toward the body | Rending Blow (Warrior) |
| `sns_low` | full | 0.80 | strike 0.26 | drop low and sweep the weapon at the enemy's knees | Crippling Slash (Warrior) |
| `sns_bash` | full | 0.70 | strike 0.18 | step in and punch the shield face into the enemy, weapon pulled back | Shield Slam (Warrior), Shield Slam (Paladin) |
| `sns_brace` | full | 0.90 | release 0.30 | plant the feet, shield thrust forward, weapon braced behind it, stomp | Iron Bulwark |
| `sns_charge_start` | full | 0.15 | — | drop the shoulder behind the shield | Bull Rush (Warrior) |
| `sns_charge_loop` | full | 0.50 loop | — | sprinting charge behind the lowered shield | Bull Rush, while travelling |
| `sns_charge_hit` | full | 0.40 | strike 0.06 | shield shove into the target, skid to a stop | Bull Rush, on `dashEnd` |
| `sns_whirl` | full | 0.50 loop | strike 0.25 | spin 360° per cycle, weapon arm extended at waist height, shield tucked | Steel Tempest (4 s, ticks every 0.5 s) |
| `sns_point` | upper | 0.55 | release 0.12 | thrust the weapon's point at the enemy | Judgment (Paladin) |
| `sns_throw_shield` | upper | 0.65 | release 0.15, item_hide_l 0.15, item_show_l 0.60 | sling the shield flat like a discus with the left arm | Sentinel's Shield |
| `sns_plant` | full | 0.80 | strike 0.30 | raise the sword point-down and drive it into the ground, dropping to one knee | Consecration |
| `sns_buff` | upper | 0.70 | release 0.22 | shield raised high, weapon pressed to its back, head bowed | Holy Shield |
| `sns_shout` | full | 0.90 | release 0.25 | weapon thrust skyward, shield forward, roar | Guardian's Resolve |
| `sns_victory` | full | 3.00 | — | bang the weapon on the shield twice, raise it high, roar | victory |

**20 clips.**

### 4.4 `th` — two-handed weapon (Warrior Arms, Berserker Executioner, Paladin Crusader)

Left-hand IK on `grip2` is **on** in every clip except those marked "IK off".

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `th_idle` | full | 2.40 loop | — | heavy weapon held diagonally across the body, head high over the right shoulder, left hand low on the haft, wide stance | idle |
| `th_run_up` | upper | 0.70 loop | — | weapon carried diagonally across the chest at port arms | run |
| `th_sprint_up` | upper | 0.60 loop | — | weapon rested on the right shoulder, left arm pumping (IK off) | sprint |
| `th_atk_1` | upper | 1.00 | strike 0.34 | two-handed diagonal chop from over the right shoulder down to the left | basic attack |
| `th_atk_2` | upper | 1.00 | strike 0.32 | two-handed horizontal sweep right-to-left at waist height | basic attack |
| `th_atk_3` | upper | 1.00 | strike 0.36 | raised straight overhead and smashed vertically down | basic attack |
| `th_rend` | upper | 1.00 | strike 0.32 | overhead chop, then the blade ripped back upward | Rending Blow (Arms), Rending Axes (Executioner) |
| `th_low` | full | 0.90 | strike 0.30 | low sweep at the legs | Crippling Slash (Arms) |
| `th_execute` | full | 1.10 | strike 0.40 | huge overhead chop with a step in, the whole body behind it | Execute, Headtaker (Executioner), Holy Strike, Skullsplitter's release |
| `th_windup_start` | full | 0.30 | loop_from 0.30 | lift the weapon high overhead behind the head | Skullsplitter cast (1.0 s) |
| `th_windup_loop` | full | 0.80 loop | — | weapon held overhead, trembling with tension, glaring | Skullsplitter cast |
| `th_ground` | full | 1.00 | strike 0.38 | overhead slam into the ground ahead, debris | Ground Breaker |
| `th_parry` | upper | 0.90 | release 0.30 | spin the weapon before the body and set it vertical, deflecting | Die by the Sword |
| `th_brace` | full | 0.90 | release 0.30 | plant the weapon head-down, both hands on the pommel, chest swells (IK off) | Iron Hide |
| `th_charge_start` / `th_charge_loop` / `th_charge_hit` | full | 0.15 / 0.50 loop / 0.40 | hit: strike 0.06 | shoulder charge with the weapon held across the chest; ram | Bull Rush (Arms) |
| `th_leap_start` | full | 0.15 | launch 0.04 | crouch-spring, weapon swung up | Skull Leap (Executioner), Bladestorm's leap (Arms) |
| `th_leap_air` | full | 0.50 loop | — | airborne, weapon raised overhead with both hands, legs tucked | leap travel |
| `th_leap_land` | full | 0.55 | strike 0.06 | land smashing the weapon into the ground | on `dashEnd` |
| `th_whirl` | full | 0.50 loop | strike 0.25 | spin 360° per cycle with the weapon extended two-handed at waist height | Bladestorm (3 s) |
| `th_spin_once` | full | 0.90 | strike 0.45 | one full spin with the hammer extended, then recover | Radiant Storm |
| `th_point_l` | upper | 0.55 | release 0.12 | weapon rests on the right shoulder, left palm thrust at the enemy (IK off) | Judgment (Crusader) |
| `th_throw_l` | upper | 0.60 | release 0.15 | weapon on the shoulder, left arm hurls a light-hammer overhand (IK off) | Hammer of Light |
| `th_buff` | full | 0.90 | release 0.35 | weapon raised overhead in both hands, head thrown back, light pours down | Divine Shield, Divine Wrath |
| `th_victory` | full | 3.00 | — | weapon raised overhead in triumph, then planted head-down and leaned on | victory |

**26 clips.**

### 4.5 `dw` — two one-handed axes (Berserker Fury, Shaman Enhancement)

Basic attacks alternate strictly R → L → R … (their own counter, not touched by abilities).

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `dw_idle` | full | 2.20 loop | — | both axes held forward low, wide hunched stance, rocking, eager | idle (also Feral's humanoid with claw hands) |
| `dw_run_up` | upper | 0.70 loop | — | both arms pumping, axes pointing back | run |
| `dw_sprint_up` | upper | 0.60 loop | — | arms pumping hard, axes low | sprint |
| `dw_atk_r1` | upper | 0.75 | strike 0.25 | right axe overhand chop | basic attack, right |
| `dw_atk_l1` | upper | 0.75 | strike 0.23 | left axe forehand diagonal | basic attack, left |
| `dw_atk_r2` | upper | 0.75 | strike 0.25 | right axe horizontal backhand | basic attack, right |
| `dw_atk_l2` | upper | 0.75 | strike 0.23 | left axe rising slash from the hip | basic attack, left |
| `dw_cross` | upper | 0.85 | strike 0.30 | both axes raised and slashed down in an X | Rending Axes (Fury) |
| `dw_double` | upper | 0.95 | strike 0.26, hit2 0.48 | right axe chop, then left axe chop | Headtaker (Fury), Stormstrike (two hits) |
| `dw_lash` | upper | 0.75 | strike 0.24 | left axe whipped up in a rising slash | Lava Lash |
| `dw_throw` | upper | 0.75 | release 0.22, item_hide_r 0.22, item_show_r 0.70 | overhand throw of the right axe | Hurled Axe |
| `dw_leap_start` / `dw_leap_air` / `dw_leap_land` | full | 0.15 / 0.50 loop / 0.55 | launch 0.04; land strike 0.06 | spring; both axes raised overhead in the air; double chop on landing | Skull Leap (Fury) |
| `dw_roar` | full | 1.00 | release 0.30 | arms thrown wide, axes out, chest out, head back, roar | Undying Rage, Spirit Wolf (a howl) |
| `dw_clash` | upper | 0.80 | release 0.30 | clash both axes together above the head | Berserk |
| `dw_pre_start` / `dw_pre_loop` | upper | 0.25 / 1.00 loop | loop_from 0.25 | axes crossed before the chest, head bowed, gathering | Healing Surge cast (1.2 s) |
| `dw_rel_self` | upper | 0.50 | release 0.10 | arms spread, head up | Healing Surge release |
| `dw_plant` | full | 0.70 | strike 0.25 | drop to a knee and hammer both axe pommels into the ground | Earthbind Totem |
| `dw_victory` | full | 3.00 | — | axes raised, beat them together, roar | victory |

**21 clips.**

### 4.6 `dg` — two daggers (Rogue Subtlety, Rogue Assassination)

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `dg_idle` | full | 2.40 loop | — | low agile stance, light on the feet, daggers held forward at chest and hip height, slight bounce | idle (replaces the permanent crouch) |
| `dg_run_up` | upper | 0.70 loop | — | daggers held low, arms pumping close to the body | run |
| `dg_sprint_up` | upper | 0.60 loop | — | leaning sprint, arms swept back | sprint |
| `dg_atk_1` | upper | 0.60 | strike 0.20 | quick right stab to the gut | basic attack |
| `dg_atk_2` | upper | 0.60 | strike 0.20 | left hook slash across | basic attack |
| `dg_atk_3` | upper | 0.60 | strike 0.18 | right backhand slash | basic attack |
| `dg_stab` | upper | 0.50 | strike 0.16 | lunging right stab | Viper Strike |
| `dg_gut` | upper | 0.75 | strike 0.24 | both daggers driven in at stomach height and ripped outward | Gutting Edge |
| `dg_pommel` | upper | 0.60 | strike 0.20 | uppercut with the right dagger's pommel to the jaw | Skull Crack |
| `dg_envenom` | upper | 0.70 | strike 0.22 | both daggers stabbed forward together and twisted | Envenom |
| `dg_hamstring` | full | 0.60 | strike 0.20 | duck and slash low across the legs | Crippling Poison |
| `dg_mark` | upper | 0.55 | release 0.14 | flick the right dagger's tip at the target, pointing | Death Mark |
| `dg_toss` | upper | 0.55 | release 0.16 | underarm toss with the left hand (dagger still held) | Plague Cloud (vial spawns at `grip_l`) |
| `dg_stealth_enter` | full | 0.35 | release 0.20 | wrap the cloak around, sink low | Fade |
| `dg_stealth_idle` | full | 2.50 loop | — | crouched sneak stance, daggers reversed along the forearms | stealthed, standing |
| `dg_stealth_walk` | lower | 1.00 loop | stride 2.0 | sneaking crouch walk | stealthed, moving (upper = `dg_stealth_idle`) |
| `dg_ambush_in` | full | 0.50 | strike 0.10 | appear behind the target mid-stab, rising from a crouch | Shadow Leap (arrival) |
| `dg_victory` | full | 3.00 | — | flip both daggers, catch them, short bow | victory |

**18 clips.**

### 4.7 `mc` — mace or scepter + free / item hand (Priest Discipline & Shadow, Shaman Elemental)

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `mc_idle` | full | 2.60 loop | — | scepter held at the side angled up, left hand open at the waist (Elemental: relic held forward in the left hand) | idle |
| `mc_run_up` | upper | 0.70 loop | — | scepter held upright, left arm pumping | run |
| `mc_sprint_up` | upper | 0.60 loop | — | scepter low, both arms pumping | sprint |
| `mc_atk_1` | upper | 0.75 | release 0.28 | scepter raised and swung forward to point at the target | basic attack (Holy Spark, Mind Spike, Static Shock) |
| `mc_atk_2` | upper | 0.75 | release 0.26 | scepter thrust forward from the hip | basic attack |
| `mc_atk_3` | upper | 0.75 | release 0.26 | backhand flick of the scepter toward the target | basic attack |
| `mc_pre_start` / `mc_pre_loop` | upper | 0.25 / 1.20 loop | loop_from 0.25 | scepter held up beside the head, left palm forward gathering energy (Elemental: relic raised) | Sacred Bolt, Mind Blast, Lightning Lash |
| `mc_rel_dir` | upper | 0.50 | release 0.10 | left palm (or relic) thrust at the target, scepter follows | their release |
| `mc_pre_heal_start` / `mc_pre_heal_loop` | upper | 0.25 / 1.20 loop | loop_from 0.25 | scepter raised high, left hand reaching gently toward the ally, head tilted | Mend (1.6 s) |
| `mc_rel_ally` | upper | 0.50 | release 0.12 | open left palm swept toward the ally | Mend release, Divine Aegis |
| `mc_rel_quick` | upper | 0.40 | release 0.08 | quick flick of the left hand at the target | Shadow Word: Pain, Magma Burst |
| `mc_omni` | full | 0.80 | release 0.25 | scepter and left hand raised overhead, then flung wide | Blinding Light, Halo of Judgment |
| `mc_scream` | full | 0.80 | release 0.22 | hunch, then both arms thrust forward, head forward, scream | Psychic Scream |
| `mc_clench` | upper | 0.70 | release 0.30 | reach toward the target and clench the left fist, pulling back | Void Eruption |
| `mc_area` | full | 0.75 | strike 0.25 | raise both arms, then slam the left fist into the ground | Quake Totem |
| `mc_plant` | full | 0.75 | strike 0.28 | crouch and drive a totem into the ground with the left hand | Stoneskin Totem |
| `mc_summon` | full | 0.90 | release 0.40 | raise the relic overhead and call | Fire Spirit |
| `mc_wings` | upper | 0.45 | release 0.10 | arms swept back like wings, chest up (plays over running legs) | Seraph's Step |
| `mc_victory` | full | 3.00 | — | scepter raised in blessing, kneel (priest) / relic raised, roar (shaman — same clip, the roar is VFX + sound) | victory |

**21 clips.**

### 4.8 `wd` — wand + book (Mage Frost, Mage Fire)

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `wd_idle` | full | 2.60 loop | — | weight on one leg, wand held by the hip pointing forward-down, book open on the left palm | idle |
| `wd_run_up` | upper | 0.70 loop | — | book clutched to the chest, wand arm pumping | run |
| `wd_sprint_up` | upper | 0.60 loop | — | book clutched, leaning | sprint |
| `wd_atk_1` | upper | 0.70 | release 0.28 | wand cocked by the shoulder and flicked at the target | basic attack |
| `wd_atk_2` | upper | 0.70 | release 0.26 | backhand flick from across the body | basic attack |
| `wd_atk_3` | upper | 0.70 | release 0.24 | short thrust, wand pointing | basic attack |
| `wd_pre_start` / `wd_pre_loop` | upper | 0.25 / 1.20 loop | loop_from 0.25 | wand aimed at the target, book raised, energy drawn into the wand tip | Frost Lance, Fireball (also while running) |
| `wd_rel_dir` | upper | 0.50 | release 0.10 | thrust the wand forward | their release |
| `wd_pre_omni_start` / `wd_pre_omni_loop` | upper | 0.30 / 1.20 loop | loop_from 0.30 | wand raised overhead circling, book held high | Arcane Comet (2.0 s), Meteor (1.0 s, while running) |
| `wd_rel_heavy` | upper | 0.60 | release 0.12 | swing the wand down from overhead toward the target | Arcane Comet |
| `wd_rel_calldown` | upper | 0.60 | release 0.12 | from overhead, point the wand down at the ground far ahead | Meteor |
| `wd_rel_quick` | upper | 0.40 | release 0.08 | quick wand flick from the hip | Frostbite, Flame Burst |
| `wd_area` | full | 0.65 | strike 0.20 | both arms swept down and out, stamp | Glacial Nova, Flame Ring |
| `wd_buff` | upper | 0.70 | release 0.22 | book raised, wand circling above the head | Mana Ward |
| `wd_victory` | full | 3.00 | — | twirl the wand, snap the book shut, bow | victory |

**17 clips.**

### 4.9 `st` — staff (Necromancer Summoner & Curser, Druid Restoration)

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `st_idle` | full | 2.60 loop | — | staff held upright beside the right foot at head height, left hand loose (necromancer: clawed) | idle |
| `st_run_up` | upper | 0.70 loop | — | staff held diagonally forward, left arm pumping | run |
| `st_sprint_up` | upper | 0.60 loop | — | staff trailing low | sprint |
| `st_atk_1` | upper | 0.75 | release 0.28 | staff drawn back and thrust head-first at the target | basic attack |
| `st_atk_2` | upper | 0.75 | release 0.28 | staff head swept forward in an arc | basic attack |
| `st_atk_3` | upper | 0.75 | release 0.30 | staff raised overhead and brought down to point | basic attack |
| `st_pre_start` / `st_pre_loop` | upper | 0.25 / 1.20 loop | loop_from 0.25 | staff head aimed at the target, left hand clawing energy together | Soul Rot |
| `st_rel_dir` | upper | 0.50 | release 0.10 | thrust the staff head forward | Soul Rot release |
| `st_pre_heal_start` / `st_pre_heal_loop` | upper | 0.25 / 1.20 loop | loop_from 0.25 | staff raised high, left palm toward the ally | Regrowth (1.4 s) |
| `st_rel_ally` | upper | 0.50 | release 0.12 | left palm swept toward the ally | Regrowth release, Rejuvenation |
| `st_rel_quick` | upper | 0.40 | release 0.08 | left-hand throw at the target | Bone Spear, Curse of Agony, Curse of Weakness |
| `st_curse` | upper | 0.70 | release 0.25 | left claw reaches out and twists slowly | Doom |
| `st_clench` | upper | 0.70 | release 0.30 | point the staff at the ghoul, clench the left fist | Corpse Explosion |
| `st_siphon` | upper | 0.80 | release 0.35 | both hands pull something toward the chest | Soul Siphon |
| `st_buff` | upper | 0.70 | release 0.22 | staff vertical before the face, eyes closed | Bone Shield |
| `st_summon` | full | 1.00 | release 0.45 | slam the staff's butt into the ground, left hand raised and pulled upward | Abomination; Tree of Life (just before the model swap) |
| `st_calldown` | upper | 0.60 | release 0.15 | raise the staff and point it down at the target | Moonfire |
| `st_ground` | full | 0.60 | strike 0.20 | strike the staff's butt on the ground | Entangling Roots |
| `st_victory` | full | 3.00 | — | staff raised, then planted with a flourish | victory |

**22 clips.**

### 4.10 `bw` — bow (Hunter Beastmaster, Hunter Sharpshooter)

The bow string follows `nock_r` while the right hand draws; an `arrow` item is shown on `nock_r` from the `nock`
marker until `release`, then becomes the projectile.

| Id | Layer | Len | Markers | Motion | Used by |
|---|---|---|---|---|---|
| `bw_idle` | full | 2.40 loop | — | bow held in the left hand, arrow nocked, string half drawn, hunched | idle |
| `bw_run_up` | upper | 0.70 loop | — | bow held low in the left hand, right arm pumping (arrow hidden) | run |
| `bw_sprint_up` | upper | 0.60 loop | — | bow low, leaning | sprint |
| `bw_shot` | upper | 0.90 | release 0.12, nock 0.45, full_draw 0.80 | loose at full draw, reach to the quiver, nock, draw again | basic attack, Serpent Sting, Concussive Shot |
| `bw_shot_2` | upper | 0.90 | release 0.12, nock 0.40, full_draw 0.80 | loose, quick re-nock from the hip, draw | basic attack variant |
| `bw_aim_start` | upper | 0.35 | loop_from 0.35 | raise the bow and draw to an anchor at the jaw | Aimed Shot (2.0 s cast) |
| `bw_aim_loop` | upper | 1.00 loop | — | holding full draw dead still, slow breath | Aimed Shot |
| `bw_aim_rel` | upper | 0.50 | release 0.05 | release from the anchor, follow-through | Aimed Shot release |
| `bw_power` | full | 0.80 | release 0.20 | lean back into a power shot, recoil a step | Piercing Volley |
| `bw_toss` | upper | 0.55 | release 0.16 | underarm toss with the right hand | Freezing Trap |
| `bw_command` | upper | 0.70 | release 0.20 | point at the target with the bow arm, shout | Kill Command, Intimidation |
| `bw_bond` | upper | 0.70 | release 0.25 | right hand on the chest, then reaching toward the pet | Bestial Bond |
| `bw_roar` | full | 0.90 | release 0.25 | arms wide, bow raised high, roar | Bestial Wrath |
| `bw_victory` | full | 3.00 | — | bow raised high, arrow fired into the sky | victory |

**14 clips.**

### 4.11 Totals

| Set | Clips | Set | Clips |
|---|---|---|---|
| `cm` | 33 files | `dg` | 18 |
| `sns` | 20 | `mc` | 21 |
| `th` | 26 | `wd` | 17 |
| `dw` | 21 | `st` | 22 |
| | | `bw` | 14 |
| **Total** | **192 humanoid clips** | | |
| + Dread Knight (`09` §5) | 12 | | |

Every one of the 106 abilities and 21 basic attacks now has its own motion (the per-ability table is in
`06-spells-and-vfx.md`, column "Clip").

---

## 5. Blending and procedural layers (run order each frame)

1. **Locomotion (lower)**: 8-direction blend of `cm_run` / `cm_run_back` / `cm_strafe_l/r` (+ `cm_walk` below
   speed 0.45, `cm_sprint` above 1.12) by the movement angle relative to facing; phase-synced.
   Speed comes from the sim velocity, not the render displacement, so blinks/dashes (renderer snaps > 6 m) don't
   spike it.
2. **Stance (upper)**: `<set>_idle` upper when still, `<set>_run_up` / `_sprint_up` when moving.
3. **Action (upper or full)**: the one-shot or cast clip; full-body clips own the legs only while standing still
   (or always for dashes, charges, leaps, knockdowns, deaths).
4. **Additive**: `cm_hit_add`, `cm_silence_add`.
5. **Look-at**: spine_05 / neck / head turn toward the current target: yaw ≤ 40° (split 30 / 30 / 40 %),
   pitch ≤ 25° (aim at targets on the bridge). Off during dashes, CC and death.
6. **Race posture**: hunch and knee bend (existing, re-tuned per model).
7. **IK**: left hand → `grip2` (two-handers), shield wrist lock, bow string → `nock_r`.
8. **Finger layer**: per held item (03 §5).

---

## 6. Timing contracts (sim ↔ animation)

| Event | Sim | Animation | Rule |
|---|---|---|---|
| Melee basic attack | blow lands `hitAt = clamp(0.06 + speed·0.065, 0.13, 0.24)` after the click (0.157 rogue … 0.203 executioner) | `strike` marker lands exactly at `hitAt` | wind-up played at `strike / hitAt` (≤ 2.0×), rest at natural speed; **never skip** the start |
| Ranged basic attack | bolt spawns at the click | `release` at **0.14 s** (as today) | wind-up compressed the same way. Option R2 (below) removes the compression |
| Instant ability | damage at the press | `strike` / `release` marker | **R1**: the sim delays the effect of instant melee abilities by `hitAt` (same formula as the basic attack) so the clip's strike lands on the damage. Without R1 the ability clip must strike ≤ 0.08 s after the start |
| Cast | `caststart` → `cast.t` counts down → execute | `<set>_pre_start` → `<set>_pre_loop` until execute → release clip (release ≤ 0.12 s) | `castProgress` drives VFX intensity (hand glow, circle) and a 0–1 additive "strain" (shoulders up 3°, hands tremble) |
| Cast interrupted / failed | `castfail` / interrupt | `cm_interrupt` | stops the pre-loop |
| Dash | `dashDir`, 0.22–0.30 s | `cm_dash_fwd` / `cm_dash_back` at rate 0.30 / dur | one play per dash (today AB_ANIM **and** onDash both play it) |
| Charge | homing, up to 1.0 s, `dashEnd` on arrival | `*_charge_start` → `*_charge_loop` → `*_charge_hit` on `dashEnd` | the renderer must consume `dashEnd` |
| Leap | arc, up to 1.6 s, `dashEnd` | `*_leap_start` → `*_leap_air` → `*_leap_land` on `dashEnd` | landing strike 0.06 s after `dashEnd` (the landing VFX already fires there) |
| Blink / teleport | position jumps | `cm_blink_in` / `dg_ambush_in` at the new place; VFX burst at the old place | no roll |
| Tempest | ticks every 0.5 s (first at 0.20–0.25 s) | `sns_whirl` / `th_whirl` loop 0.5 s, phase so a `strike` falls on each tick | ticks don't cause hit-stop on the spinner |
| Stun with knockdown | stun buff + "knockdown" flag on Meteor, Ground Breaker, Quake | `cm_knockdown` → `cm_down_loop` → `cm_getup` (starts 0.6 s before the stun ends) | flag needed in the buff data |
| Death | `alive = false` | `cm_death_front / back / heavy` from the killing blow's direction and crit flag | every other action stops; `deadT` set |
| Hit | `dmg` event | front/back/heavy when idle, `cm_hit_add` during actions | DoT / HoT / zone ticks: no body reaction |
| Pet attack | damage at the attack start | `strike` at +0.07 s (as today) | R3 (optional): delay pet damage by the clip's strike time |

**R1, R2, R3 are sim changes** (`js/sim/sim.js`). They shift when damage lands by ~0.15 s, so the balance matrix
must be re-run after them (`docs/BALANCE.md`, auto-tune). Recommended: **R1 yes**, R2 and R3 only if the feel
test asks for it.

---

## 7. Animation manifest

`assets/models/anims/manifest.json` replaces `ATTACK_ANIMS`, `ACTIONS`, `IMPACT` and `AB_ANIM`:

```json
{
  "clips": {
    "th_atk_1": { "file": "th.json", "src": "th_atk_1", "trim": [0.42, 1.42], "layer": "upper",
                  "loop": false, "markers": { "strike": 0.34 }, "ikL": 1, "speed": 1.0 }
  },
  "sets": { "warrior:arms": "th", "berserker:executioner": "th", "paladin:crusader": "th" },
  "attacks": { "th": ["th_atk_1", "th_atk_2", "th_atk_3"], "dw": [["dw_atk_r1", "dw_atk_r2"], ["dw_atk_l1", "dw_atk_l2"]] },
  "abilities": { "execute": "th_execute", "skullsplitter": { "cast": ["th_windup_start", "th_windup_loop"], "release": "th_execute" } },
  "fallback": { "th_rend": "th_atk_1", "*_victory": "cm_defeat" }
}
```

- One JSON per set (`cm.json`, `sns.json` …) made by `tools/anim-extract.mjs` (existing) from each Tripo export:
  ~0.6–1 MB each before compression; load only the sets in the match (≤ 4 sets + `cm` in a 2v2).
- `fallback`: like WoW, a missing clip falls back to a related one, so the game runs at every stage of production.

---

## 8. Producing the clips (Tripo AI animation)

### 8.1 Animation master

One rigged body used for **every** humanoid clip: a medium-build heroic human, 1.95 m, T-pose, generated with
**medium shoulder armour** (so motions keep the arms away from big pauldrons), empty hands, Mixamo skeleton (as the
K12 guard used for `attacks.json`). Generated + retopo + rig once (~100 credits). Keep the K12 guard as a second
master to compare.

### 8.2 Prompt template

```
A heroic warrior [WEAPON + GRIP: e.g. "holding a heavy two-handed axe, right hand high on the haft near the head,
left hand low near the end"], [START: "starting in a wide combat stance with the axe held diagonally across the
body"]. [MOTION from the tables]. [END: "returns to the starting stance" | "seamless loop"]. Stays in place,
feet planted [or: "one step forward and back"], powerful and fast, realistic weight.
```

Rules learned from `attacks.json` (docs/ATTACK_ANIMATIONS.md): say which hand holds what, say where the weapon
travels ("from over the right shoulder down to the left hip"), ask for one motion per clip, keep "in place". Names
are cut to 64 characters — start every prompt with a unique tag (`[th_atk_1]`) so the export maps by regex.

### 8.3 Per clip

1. Generate on the master (20 credits). Click the card, wait until it is loaded (✓), so it can be exported.
2. Batch export per set (GLB, skeleton + all motions), `tools/anim-extract.mjs --map <set>.map.json`.
3. Measure markers: weapon-tip speed peak with the real item on a real champion (`measureImpact` in
   `attack-anims.js`), confirmed frame by frame in the viewer; write them into the manifest.
4. Motion strip QA (§9). A failing clip is re-generated with a sharper prompt (budget 20 % re-rolls).

---

## 9. QA per clip

- **Strip**: 8 frames from start through the marker to the end, side + front view, on the lightest (Rogue) and
  heaviest (Bull-folk / Orc with pauldrons) bodies, real items attached, tip path drawn.
- Pass if: the weapon tip leads with the edge (+X) at `strike`, or points at the target within 20° at `release`;
  no hand passes through the body or a pauldron; feet don't slide > 5 cm in `full` clips; loops have no pop; the
  pose at the end matches the stance idle within 10° per bone.
- In-game: a 2v2 bot match per set, with the ability bar cycled (viewer harness), no console errors.

---

## 10. Code fixes that ship with the new set (found in the inventory)

1. `deadT` is never set (`heroes.js:500, 673`) → hit reactions overlay the death.
2. `side` toggles on every `play()` (`heroes.js:634`) → keep a per-set attack counter; L/R weapon-tip selection for
   VFX from the clip's hand, not `side`.
3. Abilities with both an AB_ANIM dash/charge kind and a `dash` event play twice in one frame.
4. `dashEnd` (`sim.js:992`) is ignored → needed for charge/leap landings.
5. `W.onHitFlinch` (`world.js:465`) and `ACTIONS.flinch` are dead code; `slash.rogue`, `bash.rogue`,
   `finisher['paladin:protection']` are unreachable.
6. Druid form models update before the hit-stop scaling (`heroes.js:723` vs `728`) and receive actions meant for
   the hidden humanoid → forms get their own state machine (`04-pets-summons-forms.md`).
7. The preview's attack button plays melee clips with `RANGED_LEAD`; preview durations differ from the game's.
8. Speed for locomotion from sim velocity (no spikes after teleports); strafe from the movement angle (no yaw hack).
