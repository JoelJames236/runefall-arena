// Class & ability definitions. Every ability's gameplay lives in `exec`, which runs
// on the authoritative simulation (host or single-player). Visual/audio effects are
// driven by the events the simulation emits, keyed by ability id.
//
// Ability flags:
//   target: needs a hostile target       ally: cast on a friendly target (self if none)
//   melee: needs to face the target      gcd: triggers / respects the global cooldown
//   cast: cast time in seconds (moving cancels)

export const CLASS_ORDER = ['mage', 'rogue', 'warrior', 'berserker', 'priest', 'shaman'];

const MELEE = 4.2;

export const CLASSES = {
  mage: {
    id: 'mage', name: 'Mage', role: 'Ranged Elemental Caster', emblem: '✦', color: '#7fb8ff', accent: '#b98cff',
    desc: 'A master of frost and arcane power. Devastating at range and able to lock enemies in place, but fragile when caught. Positioning and timing are everything.',
    weapon: 'Gnarled wooden staff cradling an arcane crystal', armor: 'Hooded indigo leathers',
    hp: 1000, defense: 0.0, speed: 7.0, resType: 'mana', res: 1000, regen: 16,
    auto: { name: 'Arcane Bolt', dmg: 28, speed: 1.8, range: 30, ranged: true, school: 'arcane', proj: 'arcane_bolt', projSpeed: 42, glyph: '✧', color: '#b98cff',
      desc: 'Basic attack: fire a small bolt of arcane energy from your staff (28 damage, 30 yd, every 1.8 sec). Usable while moving.' },
    rating: { health: 2, damage: 5, mobility: 3, defense: 1 },
    abilities: [
      { id: 'frost_lance', name: 'Frost Lance', glyph: '❄', color: '#8fd8ff', school: 'frost', cost: 50, cd: 0, gcd: true, cast: 1.3, range: 30, target: true,
        desc: 'Hurl a lance of ice dealing 120 frost damage and slowing the target by 50% for 4 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'frost_lance', 34, () => { sim.damage(c, t, 120, { school: 'frost', ab: 'frost_lance' }); sim.addBuff(t, 'slow', 4, { value: 0.5, src: c.id, name: 'Chilled', icon: '❄' }); }); } },
      { id: 'flame_burst', name: 'Flame Burst', glyph: '🔥', color: '#ff8a3a', school: 'fire', cost: 70, cd: 6, gcd: true, cast: 0, range: 30, target: true,
        desc: 'Instantly ignite the target for 100 fire damage plus 45 burn damage over 3 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'flame_burst', 55, () => { sim.damage(c, t, 100, { school: 'fire', ab: 'flame_burst' }); sim.addDot(c, t, 'Ignite', 45, 3, 'fire', '🔥'); }); } },
      { id: 'glacial_nova', name: 'Glacial Nova', glyph: '✳', color: '#bfefff', school: 'frost', cost: 90, cd: 20, gcd: true, cast: 0, range: 0, target: false,
        desc: 'Blast frost outward, dealing 30 damage and freezing all enemies within 8 yards in place for 3 sec.',
        exec(sim, c) { sim.event({ e: 'fx', fx: 'glacial_nova', id: c.id, x: c.x, z: c.z });
          for (const f of sim.enemiesOf(c)) if (sim.dist(c, f) <= 8) { sim.damage(c, f, 30, { school: 'frost', ab: 'glacial_nova' }); sim.addBuff(f, 'root', 3, { src: c.id, cc: 'root', name: 'Frozen', icon: '✳' }); } } },
      { id: 'arcane_shift', name: 'Arcane Shift', glyph: '➶', color: '#c69bff', school: 'arcane', cost: 40, cd: 14, gcd: false, cast: 0, range: 0, target: false, allowRooted: true,
        desc: 'Teleport 13 yards in your movement direction, breaking free of roots and slows.',
        exec(sim, c, t, o) { sim.cleanse(c, ['root', 'slow']); const d = o.dir || sim.forward(c); sim.blink(c, d.x, d.z, 13, 'arcane_shift'); } },
      { id: 'mana_ward', name: 'Mana Ward', glyph: '◈', color: '#7ab0ff', school: 'arcane', cost: 100, cd: 25, gcd: true, cast: 0, range: 0, target: false,
        desc: 'Surround yourself with a ward that absorbs 380 damage for 10 sec.',
        exec(sim, c) { sim.addBuff(c, 'absorb', 10, { value: sim.shieldAmt(380), src: c.id, name: 'Mana Ward', icon: '◈', fx: 'mana_ward' }); } },
      { id: 'arcane_comet', name: 'Arcane Comet', glyph: '☄', color: '#d17bff', school: 'arcane', cost: 160, cd: 30, gcd: true, cast: 2.0, range: 34, target: true, signature: true,
        desc: 'SIGNATURE — Call down a colossal arcane comet that deals 290 damage and stuns the target for 1.5 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'arcane_comet', 22, () => { sim.damage(c, t, 290, { school: 'arcane', ab: 'arcane_comet', big: true }); sim.addBuff(t, 'stun', 1.5, { src: c.id, cc: 'cc', name: 'Starstruck', icon: '☄' }); }); } },
    ],
  },

  rogue: {
    id: 'rogue', name: 'Rogue', role: 'Shadow Assassin', emblem: '🗡', color: '#9be36a', accent: '#5a2a7a',
    desc: 'A lethal shadow that builds combo points with quick strikes and unleashes them in brutal finishers. Unmatched mobility and stealth, but little room for error. Strikes from behind hurt the most.',
    weapon: 'Twin venom-edged daggers', armor: 'Black hooded leathers',
    hp: 1050, defense: 0.08, speed: 7.8, resType: 'energy', res: 100, regen: 16,
    auto: { name: 'Twin Slashes', dmg: 30, speed: 1.3, range: 4.5, ranged: false, school: 'phys', glyph: '⚔', color: '#9be36a',
      desc: 'Basic attack: alternating dagger slashes (30 damage every 1.3 sec). Melee range, must face the target.' },
    rating: { health: 2, damage: 5, mobility: 5, defense: 2 },
    abilities: [
      { id: 'viper_strike', name: 'Viper Strike', glyph: '🐍', color: '#9be36a', school: 'phys', cost: 30, cd: 0, gcd: true, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'A venomous stab dealing 96 damage. Awards 1 combo point.',
        exec(sim, c, t) { sim.damage(c, t, 96, { school: 'phys', ab: 'viper_strike' }); c.cp = Math.min(5, c.cp + 1); } },
      { id: 'gutting_edge', name: 'Gutting Edge', glyph: '⚔', color: '#ffcf4a', school: 'phys', cost: 35, cd: 0, gcd: true, cast: 0, range: MELEE, target: true, melee: true, needsCp: true,
        desc: 'Finisher. Consume combo points to deal 60 damage plus 65 per point (385 at 5 points).',
        exec(sim, c, t) { const n = c.cp; c.cp = 0; sim.damage(c, t, 60 + 65 * n, { school: 'phys', ab: 'gutting_edge', big: n >= 4 }); } },
      { id: 'skull_crack', name: 'Skull Crack', glyph: '✸', color: '#ffd27a', school: 'phys', cost: 25, cd: 20, gcd: true, cast: 0, range: MELEE, target: true, melee: true, needsCp: true,
        desc: 'Finisher. Stun the target for 1 sec plus 0.5 sec per combo point. Interrupts spellcasting.',
        exec(sim, c, t) { const n = c.cp; c.cp = 0; sim.damage(c, t, 15, { school: 'phys', ab: 'skull_crack' }); sim.interrupt(t, c); sim.addBuff(t, 'stun', 1 + 0.5 * n, { src: c.id, cc: 'cc', name: 'Skull Crack', icon: '✸' }); } },
      { id: 'shadow_leap', name: 'Shadow Leap', glyph: '☾', color: '#a36bff', school: 'shadow', cost: 0, cd: 18, gcd: false, cast: 0, range: 20, target: true,
        desc: 'Step through the shadows to appear behind your target, gaining 40% movement speed for 2 sec.',
        exec(sim, c, t) { sim.shadowLeap(c, t); sim.addBuff(c, 'speed', 2, { value: 0.4, src: c.id, name: 'Shadow Haste', icon: '☾' }); } },
      { id: 'fade', name: 'Fade', glyph: '◐', color: '#6b5a8f', school: 'shadow', cost: 0, cd: 35, gcd: false, cast: 0, range: 0, target: false, allowRooted: true, keepStealth: true,
        desc: 'Vanish into shadow for 4 sec, removing slows, roots and damage-over-time effects. Your next attack within 6 sec deals 40% more damage.',
        exec(sim, c) { sim.cleanse(c, ['slow', 'root', 'dot']); sim.addBuff(c, 'stealth', 4, { src: c.id, name: 'Faded', icon: '◐' }); sim.addBuff(c, 'ambush', 6, { src: c.id, name: 'Ambush', icon: '⚡' }); sim.dropTarget(c); } },
      { id: 'death_mark', name: 'Death Mark', glyph: '☠', color: '#ff4a6a', school: 'shadow', cost: 20, cd: 40, gcd: true, cast: 0, range: 8, target: true, signature: true,
        desc: 'SIGNATURE — Mark the target for 6 sec and gain 3 combo points. When the mark ends it detonates for 120 damage plus 30% of all damage you dealt to them meanwhile.',
        exec(sim, c, t) { c.cp = Math.min(5, c.cp + 3); sim.addBuff(t, 'mark', 6, { src: c.id, name: 'Death Mark', icon: '☠', data: { stored: 0 } }); } },
    ],
  },

  warrior: {
    id: 'warrior', name: 'Warrior', role: 'Armored Juggernaut', emblem: '⛨', color: '#e0604a', accent: '#c9c9d4',
    desc: 'A towering wall of steel who wins in close quarters. Generates rage from dealing and taking damage, and closes the gap with charges and crippling blows. Passive — Shieldwall (team play): you take 15% less damage, allies within 15 yards of you take 10% less, and you gain rage when a nearby ally is hit.',
    weapon: 'Steel longsword and iron-rimmed round shield', armor: 'Weathered leather and iron pauldron',
    hp: 1380, defense: 0.15, speed: 6.8, resType: 'rage', res: 100, resStart: 20, regen: 1,
    auto: { name: 'Sword Swing', dmg: 43, speed: 2.0, range: 4.5, ranged: false, school: 'phys', glyph: '🗡', color: '#e0604a',
      desc: 'Basic attack: heavy alternating sword swings (43 damage every 2.0 sec). Melee range, generates rage.' },
    rating: { health: 5, damage: 3, mobility: 2, defense: 5 },
    passive: { name: 'Shieldwall', self: 0.15, ally: 0.1, radius: 15, rageShare: 0.03, dmg: 0 }, // team play only
    abilities: [
      { id: 'rending_blow', name: 'Rending Blow', glyph: '⚔', color: '#ff6a4a', school: 'phys', cost: 25, cd: 5, gcd: true, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'A savage strike dealing 110 damage and reducing healing received by 50% for 8 sec.',
        exec(sim, c, t) { sim.damage(c, t, 110, { school: 'phys', ab: 'rending_blow' }); sim.addBuff(t, 'healred', 8, { value: 0.5, src: c.id, name: 'Rended', icon: '✚' }); } },
      { id: 'crippling_slash', name: 'Crippling Slash', glyph: '⛓', color: '#c9a36a', school: 'phys', cost: 10, cd: 0, gcd: true, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'Slash the legs for 30 damage, slowing movement by 40% for 5 sec.',
        exec(sim, c, t) { sim.damage(c, t, 30, { school: 'phys', ab: 'crippling_slash' }); sim.addBuff(t, 'slow', 5, { value: 0.4, src: c.id, name: 'Crippled', icon: '⛓' }); } },
      { id: 'bull_rush', name: 'Bull Rush', glyph: '➤', color: '#ffb04a', school: 'phys', cost: 0, cd: 12, gcd: false, cast: 0, range: 25, minRange: 5, target: true,
        desc: 'Charge an enemy 5–25 yards away, rooting them for 1.2 sec on impact and generating 20 rage.',
        exec(sim, c, t) { sim.charge(c, t, () => { sim.addBuff(t, 'root', 1.2, { src: c.id, cc: 'root', name: 'Pinned', icon: '➤' }); c.res = Math.min(c.maxRes, c.res + 20); sim.event({ e: 'fx', fx: 'bull_rush_hit', id: c.id, x: t.x, z: t.z }); }); } },
      { id: 'iron_bulwark', name: 'Iron Bulwark', glyph: '⛨', color: '#d8d8e8', school: 'phys', cost: 0, cd: 40, gcd: false, cast: 0, range: 0, target: false, allowCC: true,
        desc: 'Raise your shield, reducing all damage taken by 40% for 6 sec. Usable while stunned.',
        exec(sim, c) { sim.addBuff(c, 'dr', 6, { value: 0.4, src: c.id, name: 'Iron Bulwark', icon: '⛨', fx: 'iron_bulwark' }); } },
      { id: 'shield_slam', name: 'Shield Slam', glyph: '⊘', color: '#9ec0ff', school: 'phys', cost: 15, cd: 15, gcd: false, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'Bash the target for 40 damage, interrupting spellcasting and silencing them for 2.5 sec.',
        exec(sim, c, t) { sim.damage(c, t, 40, { school: 'phys', ab: 'shield_slam' }); sim.interrupt(t, c); sim.addBuff(t, 'silence', 2.5, { src: c.id, cc: 'silence', name: 'Silenced', icon: '⊘' }); } },
      { id: 'steel_tempest', name: 'Steel Tempest', glyph: '✺', color: '#ffe0a0', school: 'phys', cost: 40, cd: 40, gcd: true, cast: 0, range: 0, target: false, signature: true,
        desc: 'SIGNATURE — Become a whirlwind of steel for 4 sec, immune to crowd control and striking all enemies within 6 yards for 38 damage every 0.5 sec.',
        exec(sim, c) { sim.cleanse(c, ['slow', 'root']); sim.addBuff(c, 'tempest', 4, { src: c.id, name: 'Steel Tempest', icon: '✺', data: { tick: 0.25 } }); } },
    ],
  },

  berserker: {
    id: 'berserker', name: 'Berserker', role: 'Bloodraged Dual-Axe Brute', emblem: '🪓', color: '#d83a2a', accent: '#ffb070',
    desc: 'A colossal, half-naked brute who grows deadlier the closer he is to death. Passive — Bloodrage: deals up to 50% more damage as his health drops (in team play he also takes up to 25% less damage). Leaps onto casters, chains bleeds and executes, and trades his own blood for fury.',
    weapon: 'Two bronze war axes, one in each fist', armor: 'Bare chest, war-torn trousers and boots — muscle is armor',
    hp: 1180, defense: 0.04, speed: 7.2, resType: 'rage', res: 100, resStart: 12, regen: 1.2,
    auto: { name: 'Twin Axe Hacks', dmg: 34, speed: 1.6, range: 4.5, ranged: false, school: 'phys', glyph: '🪓', color: '#d83a2a',
      desc: 'Basic attack: alternating hacks with both axes (34 damage every 1.6 sec). Melee range, generates rage. Bloodrage applies.' },
    rating: { health: 4, damage: 5, mobility: 3, defense: 2 },
    passive: { name: 'Bloodrage', maxBonus: 0.5 },
    abilities: [
      { id: 'rending_axes', name: 'Rending Axes', glyph: '🩸', color: '#e03030', school: 'phys', cost: 20, cd: 0, gcd: true, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'Carve the target with both axes for 58 damage and make them bleed for 36 more over 4 sec.',
        exec(sim, c, t) { sim.damage(c, t, 58, { school: 'phys', ab: 'rending_axes' }); sim.addDot(c, t, 'Bleeding', 36, 4, 'phys', '🩸'); } },
      { id: 'headtaker', name: 'Headtaker', glyph: '💀', color: '#ff6a4a', school: 'phys', cost: 30, cd: 7, gcd: true, cast: 0, range: MELEE, target: true, melee: true,
        desc: 'A brutal overhead chop for 85 damage — doubled against targets below 35% health.',
        exec(sim, c, t) { const low = t.hp / t.maxHp < 0.35; sim.damage(c, t, low ? 170 : 85, { school: 'phys', ab: 'headtaker', big: low }); } },
      { id: 'axe_throw', name: 'Hurled Axe', glyph: '↯', color: '#c8b090', school: 'phys', cost: 15, cd: 16, gcd: true, cast: 0, range: 25, target: true,
        desc: 'Hurl one axe at an enemy up to 25 yards away: 50 damage and they are pinned in place for 2 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'axe_throw', 32, () => { sim.damage(c, t, 50, { school: 'phys', ab: 'axe_throw' }); sim.addBuff(t, 'root', 2, { src: c.id, cc: 'root', name: 'Pinned', icon: '↯' }); }); } },
      { id: 'skull_leap', name: 'Skull-Splitter Leap', glyph: '⤴', color: '#ffb070', school: 'phys', cost: 0, cd: 20, gcd: false, cast: 0, range: 30, minRange: 6, target: true,
        desc: 'Leap through the air onto an enemy 6–30 yards away. On landing, deal 40 damage to enemies within 5 yards and slow them by 40% for 3 sec.',
        exec(sim, c, t) { sim.charge(c, t, () => {
          sim.event({ e: 'fx', fx: 'skull_leap_land', id: c.id, x: c.x, z: c.z });
          for (const e of sim.enemiesOf(c)) if (sim.dist(c, e) <= 5) { sim.damage(c, e, 40, { school: 'phys', ab: 'skull_leap' }); sim.addBuff(e, 'slow', 3, { value: 0.4, src: c.id, name: 'Shaken', icon: '⤴' }); }
          c.res = Math.min(c.maxRes, c.res + 15);
        }, { fx: 'skull_leap', arc: 4.5, speed: 30 }); } },
      { id: 'undying_rage', name: 'Undying Rage', glyph: '♥', color: '#b01020', school: 'phys', cost: 0, cd: 45, gcd: false, cast: 0, range: 0, target: false, allowCC: true,
        desc: 'For 6 sec take 20% less damage and heal for 20% of all damage you deal. Usable while stunned.',
        exec(sim, c) { sim.addBuff(c, 'dr', 6, { value: 0.2, src: c.id, name: 'Undying Rage', icon: '♥', fx: 'undying' }); sim.addBuff(c, 'lifesteal', 6, { value: 0.2, src: c.id, name: 'Undying Rage', icon: '♥' }); } },
      { id: 'berserk', name: 'Berserk', glyph: '☄', color: '#ff2a1a', school: 'phys', cost: 0, cd: 50, gcd: false, cast: 0, range: 0, target: false, signature: true,
        desc: 'SIGNATURE — Sacrifice 15% of your current health to go berserk for 8 sec: +25% damage, basic attacks 30% faster, and immunity to slows and roots. The lost blood fuels Bloodrage.',
        exec(sim, c) { c.hp = Math.max(1, Math.round(c.hp * 0.85)); sim.cleanse(c, ['slow', 'root']); sim.addBuff(c, 'berserk', 8, { value: 0.25, src: c.id, name: 'Berserk', icon: '☄', fx: 'berserk' }); } },
    ],
  },

  priest: {
    id: 'priest', name: 'Priest', role: 'Holy Battle-Cleric', emblem: '✚', color: '#ffe9a8', accent: '#ffffff',
    desc: 'A radiant cleric who outlasts foes with healing, shields and blinding light. Lower damage, but relentless sustain — and the best partner in 2v2, able to heal and shield an ally.',
    weapon: 'Gilded flanged mace with a radiant core', armor: 'Pale vestments, crowned by a halo of light',
    hp: 1150, defense: 0.05, speed: 7.0, resType: 'mana', res: 1100, regen: 18,
    auto: { name: 'Holy Spark', dmg: 24, speed: 1.8, range: 30, ranged: true, school: 'holy', proj: 'holy_spark', projSpeed: 40, glyph: '✦', color: '#ffe680',
      desc: 'Basic attack: flick a spark of holy light from your mace (24 damage, 30 yd, every 1.8 sec). Usable while moving.' },
    rating: { health: 3, damage: 2, mobility: 3, defense: 4 },
    abilities: [
      { id: 'sacred_bolt', name: 'Sacred Bolt', glyph: '✧', color: '#ffe680', school: 'holy', cost: 45, cd: 0, gcd: true, cast: 1.3, range: 30, target: true,
        desc: 'Smite the target for 85 holy damage and sear them for 45 more over 6 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'sacred_bolt', 36, () => { sim.damage(c, t, 85, { school: 'holy', ab: 'sacred_bolt' }); sim.addDot(c, t, 'Holy Burn', 45, 6, 'holy', '✧'); }); } },
      { id: 'mend', name: 'Mend', glyph: '✚', color: '#8aff9a', school: 'holy', cost: 120, cd: 0, gcd: true, cast: 1.6, range: 30, ally: true,
        desc: 'Channel holy light to heal a friendly target for 175 (yourself if you have no friendly target; F1 = self, F2 = ally).',
        exec(sim, c, t) { sim.heal(c, t, 175, 'mend'); } },
      { id: 'divine_aegis', name: 'Divine Aegis', glyph: '◯', color: '#fff2b0', school: 'holy', cost: 90, cd: 16, gcd: true, cast: 0, range: 30, ally: true,
        desc: 'Shield a friendly target with light, absorbing 220 damage for 8 sec.',
        exec(sim, c, t) { sim.addBuff(t, 'absorb', 8, { value: sim.shieldAmt(220), src: c.id, name: 'Divine Aegis', icon: '◯', fx: 'divine_aegis' }); } },
      { id: 'seraph_step', name: "Seraph's Step", glyph: '❦', color: '#d8f4ff', school: 'holy', cost: 50, cd: 18, gcd: false, cast: 0, range: 0, target: false, allowRooted: true,
        desc: 'Sprout wings of light, removing roots and slows and gaining 60% movement speed for 3 sec.',
        exec(sim, c) { sim.cleanse(c, ['root', 'slow']); sim.addBuff(c, 'speed', 3, { value: 0.6, src: c.id, name: "Seraph's Step", icon: '❦', fx: 'seraph_step' }); } },
      { id: 'blinding_light', name: 'Blinding Light', glyph: '☀', color: '#fff6c0', school: 'holy', cost: 80, cd: 28, gcd: true, cast: 0, range: 0, target: false,
        desc: 'Erupt with blinding radiance. Enemies within 9 yards are disoriented for 3.5 sec (broken by direct damage) and their casts are interrupted.',
        exec(sim, c) { sim.event({ e: 'fx', fx: 'blinding_light', id: c.id, x: c.x, z: c.z });
          for (const f of sim.enemiesOf(c)) if (sim.dist(c, f) <= 9) { sim.interrupt(f, c); sim.addBuff(f, 'disorient', 3.5, { src: c.id, cc: 'cc', name: 'Blinded', icon: '☀' }); } } },
      { id: 'halo_judgment', name: 'Halo of Judgment', glyph: '❂', color: '#ffd24a', school: 'holy', cost: 150, cd: 35, gcd: true, cast: 0, range: 28, target: true, signature: true,
        desc: 'SIGNATURE — Unleash a blazing halo: deals 180 holy damage to the target, heals you for 150 (allies within 25 yards for 70) and purges all harmful effects from you.',
        exec(sim, c, t) { sim.event({ e: 'fx', fx: 'halo_judgment', id: c.id, x: c.x, z: c.z, tid: t.id });
          sim.cleanse(c, ['slow', 'root', 'dot', 'healred', 'silence', 'mark']);
          sim.damage(c, t, 180, { school: 'holy', ab: 'halo_judgment', big: true }); sim.heal(c, c, 150, 'halo_judgment');
          for (const a of sim.alliesOf(c)) if (sim.dist(c, a) <= 25) sim.heal(c, a, 70, 'halo_judgment'); } },
    ],
  },

  shaman: {
    id: 'shaman', name: 'Shaman', role: 'Elemental Warcaller', emblem: '⚡', color: '#4ad8ff', accent: '#ff7a2a',
    desc: 'A versatile caller of storm, fire and earth. Plants totems to control the battlefield and protect the team, while lightning and magma wear the enemy down.',
    weapon: 'Bronze war axe and a fist of spirit fire', armor: 'Earthen tunic, bare arms, braided hair and beard',
    hp: 1250, defense: 0.12, speed: 7.0, resType: 'mana', res: 1100, regen: 17,
    auto: { name: 'Static Shock', dmg: 28, speed: 1.8, range: 30, ranged: true, school: 'nature', proj: 'static_bolt', projSpeed: 48, glyph: 'ϟ', color: '#7ae0ff',
      desc: 'Basic attack: jab your totem staff to loose a crackling static bolt (28 damage, 30 yd, every 1.8 sec). Usable while moving.' },
    rating: { health: 3, damage: 4, mobility: 3, defense: 3 },
    abilities: [
      { id: 'lightning_lash', name: 'Lightning Lash', glyph: '⚡', color: '#7ae0ff', school: 'nature', cost: 50, cd: 0, gcd: true, cast: 1.3, range: 30, target: true,
        desc: 'Strike the target with a bolt of lightning for 96 nature damage.',
        exec(sim, c, t) { sim.event({ e: 'fx', fx: 'lightning_lash', id: c.id, tid: t.id }); sim.damage(c, t, 96, { school: 'nature', ab: 'lightning_lash' }); } },
      { id: 'magma_burst', name: 'Magma Burst', glyph: '♨', color: '#ff7a2a', school: 'fire', cost: 70, cd: 7, gcd: true, cast: 0, range: 30, target: true,
        desc: 'Launch molten rock that deals 78 fire damage and burns for 60 more over 6 sec.',
        exec(sim, c, t) { sim.spawnProjectile(c, t, 'magma_burst', 40, () => { sim.damage(c, t, 78, { school: 'fire', ab: 'magma_burst' }); sim.addDot(c, t, 'Magma Burn', 60, 6, 'fire', '♨'); }); } },
      { id: 'quake_totem', name: 'Quake Totem', glyph: '⛰', color: '#c9a070', school: 'nature', cost: 80, cd: 26, gcd: true, cast: 0, range: 0, target: false,
        desc: 'Slam down a totem that erupts after 1.2 sec, stunning all enemies within 8 yards for 1.75 sec.',
        exec(sim, c) { sim.spawnZone({ type: 'quake', owner: c.id, x: c.x, z: c.z, r: 8, dur: 1.2 }); } },
      { id: 'gale_dash', name: 'Gale Dash', glyph: '≋', color: '#c8fff0', school: 'nature', cost: 40, cd: 14, gcd: false, cast: 0, range: 0, target: false, allowRooted: true,
        desc: 'Ride the wind 12 yards in your movement direction, breaking roots and slows.',
        exec(sim, c, t, o) { sim.cleanse(c, ['root', 'slow']); const d = o.dir || sim.forward(c); sim.dashDir(c, d.x, d.z, 12, 0.25, 'gale_dash'); } },
      { id: 'stoneskin_totem', name: 'Stoneskin Totem', glyph: '⬢', color: '#b0d080', school: 'nature', cost: 100, cd: 30, gcd: true, cast: 0, range: 0, target: false,
        desc: 'Plant a totem for 8 sec. You and allies within 10 yards take 20% less damage and regenerate 20 health per second; enemies inside are slowed by 30%.',
        exec(sim, c) { sim.spawnZone({ type: 'stoneskin', owner: c.id, x: c.x, z: c.z, r: 10, dur: 8 }); } },
      { id: 'fire_spirit', name: 'Fire Spirit', glyph: '♆', color: '#ffb03a', school: 'fire', cost: 150, cd: 45, gcd: true, cast: 0, range: 0, target: false, signature: true,
        desc: 'SIGNATURE — Summon a blazing elemental spirit for 10 sec that hurls firebolts at your target every 1.2 sec for 40 damage.',
        exec(sim, c) { sim.addBuff(c, 'spirit', 10, { src: c.id, name: 'Fire Spirit', icon: '♆', data: { tick: 0.6 } }); } },
    ],
  },
};

// ---------------------------------------------------------------- specs (talents)
// Every class has two specs, chosen before the match and locked for it. Spec 0 is the class's
// original kit. A spec can override stats, basic attack, passive, texts and abilities by slot
// (abilities: { slotIndex: ability }); everything else comes from the class. `soon` = shown on the
// class screen but not playable yet. See docs/CLASSES_AND_SPECS.md.
export const SPECS = {
  mage: [
    { id: 'frost', name: 'Frost', icon: '❄', color: '#8fd8ff', tag: 'Hard-hitting caster · roots, blink, comet' },
    { id: 'fire', name: 'Fire', icon: '🔥', color: '#ff7a2a', tag: 'Mobile burst · casts on the move', soon: true },
  ],
  rogue: [
    { id: 'subtlety', name: 'Subtlety', icon: '🗡', color: '#a36bff', tag: 'Stealth, shadow leap, big finishers' },
    { id: 'assassination', name: 'Assassination', icon: '🐍', color: '#6aff4a', tag: 'Poisons and stacking DoTs', soon: true },
  ],
  warrior: [
    { id: 'protection', name: 'Protection', icon: '🛡', color: '#9ec0ff', tag: 'Sword & shield · protects the partner' },
    { id: 'arms', name: 'Arms', icon: '⚔', color: '#e0604a', tag: 'Greatsword · bleeds and executes', soon: true },
  ],
  berserker: [
    { id: 'fury', name: 'Fury', icon: '🪓', color: '#ff7a3a', tag: 'Two axes · fast flurries, lifesteal' },
    {
      id: 'executioner', name: 'Executioner', icon: '💀', color: '#c8b8a0', tag: 'One great axe · slow swings, huge crits',
      role: 'Bloodraged Great-Axe Executioner',
      desc: 'Trades speed for sheer weight: one colossal two-handed axe, slow swings and devastating critical hits. Passive — Bloodrage: up to 50% more damage as his health drops (in team play also up to 25% less damage taken). Heavy Hands: +12% critical strike chance, and critical hits deal +80% damage instead of +50%.',
      weapon: 'One colossal two-handed executioner\'s axe', armor: 'Fur mantle, skull pauldron and war-kilt',
      speed: 7.0, defense: 0.06,
      rating: { health: 4, damage: 5, mobility: 2, defense: 3 },
      passive: { name: 'Heavy Hands', critBonus: 0.12, critMult: 1.8 },
      auto: { name: 'Great Axe Cleave', dmg: 60, speed: 3.0, range: 4.5, ranged: false, school: 'phys', glyph: '🪓', color: '#c8b8a0',
        desc: 'Basic attack: a slow, crushing two-handed chop (60 damage every 3.0 sec). Melee range, generates rage. Heavy Hands crits hit +80%.' },
      abilities: {
        1: { id: 'skullsplitter', name: 'Skullsplitter', glyph: '🪓', color: '#ffb070', school: 'phys', cost: 30, cd: 15, gcd: true, cast: 1.2, range: MELEE, target: true, melee: true,
          desc: 'Wind up for 1.2 sec (stand still), then bring the great axe down for 140 damage.',
          exec(sim, c, t) { sim.damage(c, t, 140, { school: 'phys', ab: 'skullsplitter', big: true }); } },
        2: { id: 'ground_breaker', name: 'Ground Breaker', glyph: '⛰', color: '#d8b070', school: 'phys', cost: 20, cd: 18, gcd: true, cast: 0, range: 0, target: false,
          desc: 'Slam the axe into the ground: enemies within 7 yards in front of you take 50 damage, are knocked down (stunned) for 0.8 sec and slowed by 50% for 3 sec after.',
          exec(sim, c) {
            sim.event({ e: 'fx', fx: 'ground_breaker', id: c.id, x: c.x, z: c.z, yaw: c.yaw });
            for (const e of sim.enemiesOf(c)) if (sim.dist(c, e) <= 7 && Math.abs(angleDiffD(c.yaw, Math.atan2(e.x - c.x, e.z - c.z))) <= 1.05) {
              sim.damage(c, e, 50, { school: 'phys', ab: 'ground_breaker' }); sim.interrupt(e, c);
              sim.addBuff(e, 'stun', 0.8, { src: c.id, cc: 'cc', name: 'Knocked Down', icon: '⛰' }); sim.addBuff(e, 'slow', 3.8, { value: 0.5, src: c.id, name: 'Shaken Ground', icon: '⛰' });
            }
          } },
        4: { id: 'iron_hide', name: 'Iron Hide', glyph: '⛨', color: '#c0b8b0', school: 'phys', cost: 0, cd: 35, gcd: false, cast: 0, range: 0, target: false, allowCC: true,
          desc: 'Harden your skin: take 20% less damage for 6 sec. Usable while stunned.',
          exec(sim, c) { sim.addBuff(c, 'dr', 6, { value: 0.2, src: c.id, name: 'Iron Hide', icon: '⛨', fx: 'iron_bulwark' }); } },
        5: { id: 'headtaker', name: 'Headtaker', glyph: '💀', color: '#ff6a4a', school: 'phys', cost: 30, cd: 24, gcd: true, cast: 0, range: MELEE, target: true, melee: true, signature: true,
          desc: 'SIGNATURE — An executioner\'s blow for 90 damage. Against targets below 35% health it deals 130 damage and always crits.',
          exec(sim, c, t) { const low = t.hp / t.maxHp < 0.35; sim.damage(c, t, low ? 130 : 90, { school: 'phys', ab: 'headtaker', big: true, forceCrit: low }); } },
      },
      look: 'executioner',
    },
  ],
  priest: [
    { id: 'discipline', name: 'Discipline', icon: '✦', color: '#ffe9a8', tag: 'Shields, heals and utility' },
    { id: 'shadow', name: 'Shadow', icon: '🌑', color: '#a060ff', tag: 'Damage over time, fear, drain', soon: true },
  ],
  shaman: [
    { id: 'elemental', name: 'Elemental', icon: '⚡', color: '#7ae0ff', tag: 'Lightning, magma and totems' },
    { id: 'enhancement', name: 'Enhancement', icon: '🐺', color: '#c8fff0', tag: 'Two weapons in melee · spirit wolf', soon: true },
  ],
};
function angleDiffD(a, b) { let d = (b - a) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; }

export const specsOf = cls => SPECS[cls] || [];
export const defaultSpec = cls => specsOf(cls)[0]?.id;
// a playable spec id for this class (falls back to the class's first spec)
export const validSpec = (cls, spec) => specsOf(cls).some(s => s.id === spec && !s.soon) ? spec : defaultSpec(cls);
export const specInfo = (cls, spec) => specsOf(cls).find(s => s.id === validSpec(cls, spec));

// The effective kit of a class + spec: class data with the spec's overrides merged in (cached).
const KITS = new Map();
export function kit(cls, spec) {
  const sid = validSpec(cls, spec), key = cls + ':' + sid;
  let k = KITS.get(key);
  if (k) return k;
  const C = CLASSES[cls], S = specsOf(cls).find(s => s.id === sid) || {};
  k = { ...C, spec: sid, specName: S.name, specIcon: S.icon, specColor: S.color, look: S.look || null };
  for (const f of ['role', 'desc', 'weapon', 'armor', 'hp', 'defense', 'speed', 'res', 'resStart', 'regen', 'rating', 'auto']) if (S[f] !== undefined) k[f] = S[f];
  if (S.passive) k.passive = { ...C.passive, ...S.passive };
  if (S.abilities) k.abilities = C.abilities.map((a, i) => S.abilities[i] || a);
  KITS.set(key, k);
  return k;
}
// effective kit of a fighter (anything with cls + spec)
export const kitOf = f => kit(f.cls, f.spec);

export const BUFF_ICONS = {
  stun: { icon: '✸', color: '#ffd27a', debuff: true }, root: { icon: '✳', color: '#bfefff', debuff: true },
  silence: { icon: '⊘', color: '#9ec0ff', debuff: true }, disorient: { icon: '☀', color: '#fff6c0', debuff: true },
  slow: { icon: '⛓', color: '#8fd8ff', debuff: true }, healred: { icon: '✚', color: '#ff6a4a', debuff: true },
  dot: { icon: '🔥', color: '#ff8a3a', debuff: true }, mark: { icon: '☠', color: '#ff4a6a', debuff: true },
  absorb: { icon: '◈', color: '#7ab0ff' }, dr: { icon: '⛨', color: '#d8d8e8' }, speed: { icon: '❦', color: '#d8f4ff' },
  stealth: { icon: '◐', color: '#6b5a8f' }, ambush: { icon: '⚡', color: '#ffcf4a' }, tempest: { icon: '✺', color: '#ffe0a0' },
  spirit: { icon: '♆', color: '#ffb03a' }, stoneskin: { icon: '⬢', color: '#b0d080' }, ccimmune: { icon: '✦', color: '#fff' },
  berserk: { icon: '☄', color: '#ff2a1a' }, lifesteal: { icon: '♥', color: '#b01020' },
};

// Bot names. Enemy bots in 2v2 are always Zigi and Jöggu.
export const BOT_NAMES = { enemy: ['Zigi', 'Jöggu'], ally: ['Aldor'], duel: [] };
