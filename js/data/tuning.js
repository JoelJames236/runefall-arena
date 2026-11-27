// Arena tuning: one power factor per spec and format, applied to all damage and healing the spec deals.
//
// Ability numbers alone can't balance both formats: a kit that wins duels (self-healing, kiting, burst on one
// target) is not the kit that wins team fights (team defense, cleave, peels), so a spec tuned to 50 % in 1v1 can
// sit at 37 % or 65 % in 2v2. These factors close that gap. They were found by the balance lab (balance.html →
// "auto-tune"): run the format with hard bots, move every spec's factor against its distance from 50 %, repeat
// until the win rates stop moving. `duel` applies in 1v1, `team` whenever both teams have two or more champions,
// `bg5` on the 5v5 flag battleground (it starts as a copy of `team`: a battleground is many small team fights).
// A missing entry means 1 (untouched). docs/BALANCE.md has the win rates these produce.
export const TUNING = {
  duel: {
    'mage:frost': 0.959, 'mage:fire': 0.986, 'rogue:subtlety': 1.004, 'rogue:assassination': 1.016,
    'warrior:protection': 1, 'warrior:arms': 0.997, 'berserker:fury': 0.999, 'berserker:executioner': 1.006,
    'paladin:crusader': 1.029, 'paladin:protection': 1.005, 'priest:discipline': 1.021, 'priest:shadow': 1.031,
    'shaman:elemental': 0.974, 'shaman:enhancement': 0.987, 'hunter:beastmaster': 0.99, 'hunter:sharpshooter': 1.018,
    'necromancer:summoner': 0.977, 'necromancer:curser': 0.954, 'druid:feral': 1.023, 'druid:restoration': 1.015,
    'dreadknight:frost': 1, 'dreadknight:blood': 1,
  },
  team: {
    'mage:frost': 1.145, 'mage:fire': 1.125, 'rogue:subtlety': 0.918, 'rogue:assassination': 0.927,
    'warrior:protection': 0.894, 'warrior:arms': 1.026, 'berserker:fury': 0.989, 'berserker:executioner': 0.946,
    'paladin:crusader': 0.971, 'paladin:protection': 0.979, 'priest:discipline': 1.017, 'priest:shadow': 0.95,
    'shaman:elemental': 1.09, 'shaman:enhancement': 0.937, 'hunter:beastmaster': 1.076, 'hunter:sharpshooter': 1.11,
    'necromancer:summoner': 1.018, 'necromancer:curser': 0.997, 'druid:feral': 0.903, 'druid:restoration': 1.01,
    'dreadknight:frost': 0.96, 'dreadknight:blood': 1.15, // balance-tested in the lab (docs/remodel/09-dread-knight.md §8)
  },
};
TUNING.bg5 = { ...TUNING.team };
export const tuningOf =(fmt, cls, spec) => TUNING[fmt]?.[cls + ':' + spec] ?? 1;
