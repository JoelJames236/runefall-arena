# Runefall Arena — game feel

What was wrong with how combat felt, what was changed, and where the knobs are.

## Problems found (traced in the code, measured where possible)

| # | Problem | Cause |
| --- | --- | --- |
| 1 | Everything moved in small hops | The simulation steps at a fixed 60 Hz, but the view drew the raw sim state. At 144 fps your champion stood still on 58 % of the frames and jumped on the rest; at 60 fps uneven frame times gave 0 or 2 steps per frame. |
| 2 | Melee hits looked out of sync | Damage, number and hit sound fired the instant a swing started; the weapon visibly arrived 0.08–0.34 s later (one-handers were worst: 0.31–0.34 s). Ability strikes had the same 0.1–0.25 s gap. |
| 3 | Casts "did nothing" | A cast pressed while still running started, broke on the next tick and still cost the 1 s global cooldown. Bots lost ~50 % of their casts to this. |
| 4 | Inputs dropped between abilities | Presses were only queued in the last 0.4 s of the global cooldown — never during a cast. Pressing the next spell just before a cast finished gave "Already casting". |
| 5 | Attack clicks got eaten | A click a step out of range was cancelled outright. In 2v2, a click with a second enemy near the crosshair switched target instead of attacking (and blocked the held attack). Holding the button after your target died did nothing. |
| 6 | Hits had little weight | No reaction on the victim beyond a flinch, no confirmation for the attacker; Paladin, Enhancement and Feral melee swings had no impact sound or blood at all (hard-coded class list). |
| 7 | Projectiles left the chest | Spell and arrow projectiles appeared at the caster's centre, not at the wand / staff / bow. |
| 8 | Mirror matches shared a material | Two champions of the same spec shared one material: a stealth fade on one faded both. |
| 9 | Hitch when the gates open | Champion shaders compiled on the first frame they were drawn (one frame of 20+ ms). |
| 10 | Cast could break by being shoved | "Moving" was measured by displacement, so any push counted as moving. |

## What changed

**Smoothness** (`js/main.js`)
- The view is drawn *between* the last two sim states (`capturePrev`, `currentView`, blended by `S.acc / STEP`).
  Measured at 144 fps while running: every frame now moves the same 0.047 units (standard deviation 0) instead of
  alternating 0 / 0.113. Teleports (blinks, round resets) are not blended.
- Your own champion turns with the mouse faster (smoothing 16 → 28 per second).

**Basic attacks** (`js/sim/sim.js`: `startAttack`, `updateAuto`, `landSwing`, `meleeHitT`)
- A melee swing starts on the click; its damage lands `meleeHitT` later (0.13–0.24 s, heavier weapons longer). The
  swing animation is started part-way in (or paced) so its impact frame falls exactly on that moment
  (`IMPACT` table + `play(kind, dur, hitAt)` in `js/render/heroes.js`). A started swing always lands.
- The click buffer survives being out of range / not facing: the swing goes off the moment it can within 0.4 s; only a
  click that never became a swing reports why.
- Melee facing arc 166° → 200° (`FACE_ARC`).
- Holding the attack button with no living target picks up the best enemy in front.
- Click-targeting prefers your current target when two enemies are near the crosshair (`World.pickEnemy`).

**Spells** (`tryAbility`, queue handling in `updateFighter`)
- A cast pressed while running is held up to 0.45 s (`MOVE_QUEUE`) and starts the moment you stop.
- Spell queue covers the end of a cast as well as the global cooldown (`QUEUE_WINDOW` = 0.5 s).
- "Moving" means moving on your own input; being pushed no longer breaks a cast.
- Instant ability strikes connect ~0.07 s after the press (`STRIKE_LEAD`) instead of after their full wind-up.
- Projectiles leave the weapon tip / casting hand and merge into their flight path (`VFX.syncProjectiles`).

**Feedback**
- Victim: warm flash on the body (`Character.flash`), flinch as before.
- Attacker: 50–85 ms hit-stop on weapon blows (`Character.hitStop`), a tick on the crosshair for every blow of yours
  (`HUD.hitMarker`, bigger for crits and heavy hits), light camera shake for your melee / heavy / critical hits.
- Melee impact sound, blood and slash arc for every melee swing (driven by the `melee` flag on the damage event).

**Technical**
- Champion shaders are compiled during the countdown (`renderer.compileAsync` in `World.setFighters`).
- Each generated champion has its own material instance (textures shared).

## Tuning knobs

| Constant | File | Meaning |
| --- | --- | --- |
| `meleeHitT(A)` | `js/sim/sim.js` | swing start → blow, per weapon speed |
| `ATTACK_BUFFER` | `js/sim/sim.js` | how long a click waits for the swing to become possible |
| `FACE_ARC` | `js/sim/sim.js` | half-angle of the melee arc |
| `QUEUE_WINDOW`, `MOVE_QUEUE` | `js/sim/sim.js` | spell queue before GCD / cast end; wait-to-stop for casts |
| `IMPACT`, `STRIKE_LEAD` | `js/render/heroes.js` | impact time of each attack clip; lead of instant strikes |
| hit-stop / flash strengths | `World.onHit` in `js/render/world.js` | weight of a hit |

## Second pass: eight follow-ups

| # | Change | Where |
| --- | --- | --- |
| 1 | **Melee leeway**: while attacker *and* target are both moving, melee swings and strikes reach `MELEE_LEEWAY` (0.8 yd) further. 1.5 yd was tried first and cost kiting ranged specs 10–17 win-% points. | `meleeBonus` in `js/sim/sim.js`, used by `check`, `autoBlock` and the HUD range display |
| 2 | **Team vitality**: in 2v2 every champion has `TEAM_VITALITY` (×1.5) health. Measured median time to the first kill in 2,400 bot games: 11 s → 16 s; median round 44 s. | `Sim.vitality`, `startRound` |
| 3 | **Dead time**: Assassination regenerates 17 energy/s (16 base) instead of starving between Envenoms; Executioner and Enhancement shrug off 35% of every slow (`passive.slowResist`, applied in `speedMult`) so kiting doesn't keep them out of range all fight. | `js/data/classes.js`, `speedMult` |
| 4 | **Guest prediction**: an online guest's press shows at once — GCD sweep, cooldown, cast bar and casting pose, animation and sound of instants — and the host's snapshots take over when they show it. A press the host refused (`err` event) or held (spell queue, wait-to-stop) disappears within `PRED_HOLD` (450 ms); a host event for something already shown doesn't play twice. Only presses the guest can check (GCD free, not casting, cooldown, resources, range, facing, line of sight, stuns / silence / roots) are predicted; the rest wait for the host as before. | `guestPredict`, `applyPred`, `onSnapshot` in `js/main.js` |
| 5 | **Bot filler**: when a bot's priority list has nothing to do, it uses the strongest ready short-cooldown attack instead of idling (never a signature, spender, crowd control or big cooldown, and never a damage-over-time that is still running on the target). | `AI.filler` in `js/sim/ai.js` |
| 6 | **Arcane Comet shatters on cover**: a projectile with `block: true` that hits a pillar on its way is destroyed (`fizzle` event with `blocked`: "Dodged!" for the target, "Blocked" for the caster). Only the Frost signature uses it; Aimed Shot is the Sharpshooter's main filler, and blocking it cost the spec 10 points. | `spawnProjectile`, `updateProjectiles` |
| 7 | **Key bindings**: Settings → Ability Keys, two keys per slot, any key or the middle / back / forward mouse button (`Mouse1`, `Mouse3`, `Mouse4`). A key can only do one thing (binding it moves it); movement, Tab, Esc and F1 / F2 can't be bound. Saved with the settings; the action bar and champion screen show the bound key. | `DEFAULT_BINDS`, `Input.setBinds`, `renderBinds` |
| 8 | **Healer comfort and readability**: mouseover healing (ally under the crosshair / cursor gets your ally spells; frame and nameplate glow; validated on the host so it can't redirect a hostile ability), enemy big-cooldown callouts (30 s+ or signature), and a "not facing" marker (↻ on melee slots, orange crosshair). | `World.pickAlly`, `HUD.callout`, `HUD.update` |

Also: bots can be set to 🎲 Random in the duel (new opponent panel), 2v2 vs bots and the party lobby (new lobby bots
start random; class and spec are rolled at every match start, avoiding a class already on that team).

## Third pass: aimed basic attacks

Basic attacks used to be tab-target: a click swung at the selected target, a started melee swing always landed and
ranged autos homed in. Now they are aimed.

- **The dot in the middle of the screen is the aim.** Each frame the client casts a ray from the camera through the
  crosshair (`World.aimRay`) and sends it with the input (`aim`, guests as `a` in their `in` message; the host
  ignores rays that don't start near the player). Every click / held swing goes off whether or not anything is
  under the dot.
- **One hitbox for everyone** (`HITBOX` in `js/sim/sim.js`): a vertical capsule, radius 0.55, 0.1–1.95 above the feet,
  independent of the model (dwarf or bull-folk, the sim never looks at the mesh). `aimPick` / `hitboxDist` do the
  ray / segment tests.
- **Melee**: at the moment the blow lands (`meleeHitT`) the aim ray is tested; it hits the first enemy hitbox
  under it that is within 4.5 yd (+ leeway) and inside the 200° frontal arc, widened by `MELEE_AIM_WIDTH` (0.25) for
  the sweep of the weapon. Nothing there: a `miss` event ("Miss" for the attacker) and the swing is spent.
- **Ranged**: a straight bolt from the weapon towards the point under the dot (the first hitbox on the ray, else
  where the ray reaches the weapon's range or the ground) — `shootAuto` / `stepStraight`. It hits the first enemy
  hitbox it passes through and breaks on pillars, the bridge and the ground. Abilities are unchanged (they still
  use the target and home in).
- **Feedback**: the dot turns red (`#crosshair.aimon`) and the basic-attack slot lights up while an enemy the attack
  can reach is under it. Clicking an enemy also makes it your target; the first enemy you hit becomes your target
  when you have none (`claimTarget`). The body no longer snaps towards the selected target when it attacks.
- **Bots** aim with the same rules (`AI.aimAt`): eyes → chest, ranged shots led by the target's movement, an aim
  error that drifts (Squire 0.9 / Knight 0.45 / Champion 0.2 yd), and they only swing when a hit is possible
  (`autoBlock`). Champion bots land 70–100 % of their basic attacks (melee ~95 %, ranged less against movement).
- Balance after the change (hard bots): 1v1 40–59 %, 2v2 38–62 % — no numbers had to change.
- **Pets and summons are hit on their own**: ghoul, abomination, gorilla and spirit wolf share one smaller hitbox
  (`MINION_HITBOX`, radius 0.45, up to 1.5 — with the full champion capsule the spirit wolf blocked so many blows aimed
  at its shaman that Enhancement gained 6 win-% points) and are
  part of `Sim.units()`; `Sim.hitMinion` applies the attacker's crits / damage bonuses and rage. A summon standing
  between you and its master takes the blow. Clicking still only targets champions.
- **One rhythm for all basic attacks**: swing timers now lie between 1.5 and 2.2 s (they were 1.2–3.0 s; the heavy
  two-handers at 2.5–3.0 s felt sluggish and a miss cost them the most), with damage per hit rescaled so damage per
  second is unchanged: Claws / Twin Slashes / Envenomed Slashes 1.2–1.3 → 1.5 s, Dawn Hammer 2.5 → 2.0 s, Greatsword
  2.6 → 2.0 s, Great Axe 3.0 → 2.2 s, Quick Shot 1.4 → 1.6 s, Heavy Arrow 2.2 → 2.0 s, Fire Bolt 1.6 → 1.8 s.
- **Mouse capture**: a refused pointer-lock request (Chrome refuses a re-lock right after Esc, or a request without a
  click) used to switch the game to the no-capture controls for the rest of the session — visible cursor, camera only
  while a button is held, and since aimed attacks every swing went to the middle of the screen, not to the cursor.
  Now only a page that can never lock (`WrongDocumentError`, e.g. an embedded view) uses those controls, and there the
  cursor aims (the dot follows it, the system cursor is hidden over the arena, the right button turns the camera).
  Anything else is retried on the next click.

## Not done / next steps

- Online guests still see *other* players ~100 ms in the past. Their own presses are predicted (see above), but
  damage numbers, projectiles and buffs still arrive with the host's answer. Prediction was tested with a simulated
  host in one page, not over a real connection.
- Projectiles other than Arcane Comet home on their target and pass through pillars visually (line of sight is
  checked when the cast ends).
- Pets and summons still deal their damage at the start of their attack animation.
- Melee ability damage is still instant (the animation was moved to it, not the other way round).
- No per-ability sound for most of the newer specs' strikes beyond the shared melee / spell impacts.
