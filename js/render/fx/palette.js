// School palette (docs/remodel/06 §3): every effect takes the colours of its ability's SCHOOL, not its class.
// Colours as sRGB hex: core (hot centre, white-ish), glow (the school colour), dark (smoke / falloff).
// Pure data — no three.js — so tools can import it too.

export const SCHOOLS = {
  frost:      { core: 0xeafaff, glow: 0x8fd8ff, dark: 0x2a6aa8 },
  fire:       { core: 0xfff2c0, glow: 0xff7a2a, dark: 0x8a1a08 },
  arcane:     { core: 0xf4e8ff, glow: 0xb98cff, dark: 0x4a2a8a },
  holy:       { core: 0xfffbe8, glow: 0xffd86a, dark: 0xa87a1a },
  shadow:     { core: 0xe8d0ff, glow: 0x9a50ff, dark: 0x1a0830 },
  necrotic:   { core: 0xeaffd8, glow: 0x7aff6a, dark: 0x1a3a12 },
  curse:      { core: 0xf0d8ff, glow: 0xb070ff, dark: 0x2a1040 },
  storm:      { core: 0xffffff, glow: 0x6ae0ff, dark: 0x1a4a8a },
  earth:      { core: 0xffe2b0, glow: 0xd09040, dark: 0x4a3018 },
  nature:     { core: 0xf4ffd8, glow: 0x8ae86a, dark: 0x2a5a18 },
  moon:       { core: 0xf0f0ff, glow: 0xc8b0ff, dark: 0x3a3070 },
  poison:     { core: 0xe8ffb0, glow: 0x9be36a, dark: 0x2a4a10 },
  shadowstep: { core: 0xd8c8ff, glow: 0x7a3aff, dark: 0x0a0418 },
  blood:      { core: 0xffd0b0, glow: 0xff3a1a, dark: 0x5a0808 },
  physical:   { core: 0xffffff, glow: 0xfff0d8, dark: 0x6a6a70 },
  beast:      { core: 0xfff0c0, glow: 0xe8a040, dark: 0x5a3a10 },
};

// readability rule (06 §2): an enemy's ground effect always shows its edge in hostile red-orange
export const HOSTILE = 0xff5a3a;
// weapon trail of a champion without a school look (code-built weapons): neutral silver-white
export const NEUTRAL_TRAIL = { core: 0xf4f6ff, glow: 0xc8d0e0, dark: 0x50586a };

// the sim's coarse schools (classes.js `school`) -> palette school; class / spec specific looks override this
export const SIM_SCHOOL = { phys: 'physical', holy: 'holy', frost: 'frost', fire: 'fire', arcane: 'arcane', shadow: 'shadow', nature: 'nature' };

// weapon-trail school per champion (06 §5: "gold trail", "poison-green trail", "red-steel trails" ...)
export const TRAIL_SCHOOL = {
  'paladin:protection': 'holy', 'paladin:crusader': 'holy', paladin: 'holy',
  'rogue:assassination': 'poison', rogue: 'physical',
  warrior: 'physical', berserker: 'blood',
  'shaman:enhancement': 'storm',
  'dreadknight:frost': 'frost', 'dreadknight:blood': 'blood',
  druid: 'beast',
};

export const school = id => SCHOOLS[id] || SCHOOLS[SIM_SCHOOL[id]] || SCHOOLS.physical;
export const schoolId = id => (SCHOOLS[id] ? id : SIM_SCHOOL[id] || 'physical');
