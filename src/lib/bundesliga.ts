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
  "Werder Bremen",
  "FC Augsburg",
  "1. FC Union Berlin",
  "Borussia Mönchengladbach",
  "1. FC Köln",
  "1. FSV Mainz 05",
  "Hamburger SV",
  "FC Schalke 04",
  "SV Elversberg",
  "SC Paderborn",
] as const;

/** Convenience: the clubs joined with newlines, ready to drop into the textarea. */
export const BUNDESLIGA_OPTIONS: string = BUNDESLIGA_2026_27.join("\n");