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

## Not done / next steps

- Online guests still see other players ~100 ms in the past and their own abilities after a round trip; the
  improvements above run on the host and in offline play, and guests get the same events and animations.
- Projectiles home on their target and pass through pillars visually (line of sight is checked when the cast ends).
- Pets and summons still deal their damage at the start of their attack animation.
- Melee ability damage is still instant (the animation was moved to it, not the other way round).
- No per-ability sound for most of the newer specs' strikes beyond the shared melee / spell impacts.
