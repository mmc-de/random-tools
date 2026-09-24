/**
 * Canonical 1. Bundesliga club list — 2026/27 season.
 *
 * Used as a one-click prefill for the bucket-draw tool. 18 clubs, one per
 * line, in no particular order (just the set the user asked for).
 */
export const BUNDESLIGA_2026_27 = [
  "FC Bayern München",
  "Bayer 04 Leverkusen",
  "Borussia Dortmund",
  "RB Leipzig",
  "VfB Stuttgart",
  "Eintracht Frankfurt",
  "SC Freiburg",
  "TSG Hoffenheim",
  "1. FC Heidenheim",
  "Werder Bremen",
  "FC Augsburg",
  "VfL Wolfsburg",
  "1. FSV Mainz 05",
  "1. FC Union Berlin",
  "Borussia Mönchengladbach",
  "1. FC Köln",
  "FC St. Pauli",
  "Hamburger SV",
] as const;

/** Convenience: the clubs joined with newlines, ready to drop into the textarea. */
export const BUNDESLIGA_OPTIONS: string = BUNDESLIGA_2026_27.join("\n");