/**
 * Tiny i18n helper for the random-tools site. Two locales: English
 * (`en`, default) and German (`de`). Stored in localStorage under
 * `random-tools:lang`; falls back to the browser language on first
 * visit.
 *
 * Three surfaces:
 *
 *   1. Pure functions (`t`, `tx`, `getLang`) — usable from .astro
 *      pages and any non-Svelte JS. Reads `currentLang` at call time.
 *
 *   2. Reactive store (`lang`) — a Svelte 5 writable store so Svelte
 *      components can do `$lang` to subscribe to changes. We use
 *      `svelte/store` (not `$state`) because `.ts` files imported by
 *      Astro cannot use the Svelte 5 runes runtime.
 *
 *   3. Setter (`setLang`) — writes the module-level var, persists to
 *      localStorage, mirrors into the store, and updates the
 *      `<html data-lang>` attribute for SSR coherence.
 *
 * Usage in a Svelte component:
 *
 *   import { t, lang, setLang } from "~/scripts/i18n";
 *   $: greeting = $lang.current === "de" ? "Hallo" : "Hi";
 *   <button onclick={() => setLang("de")}>DE</button>
 *
 * Usage in an Astro page:
 *
 *   import { t } from "~/scripts/i18n";
 *   <p>{t("home.subtitle")}</p>
 */

import { writable } from "svelte/store";

export type Lang = "en" | "de";
const STORAGE_KEY = "random-tools:lang";

function detectInitial(): Lang {
  // Read from <html data-lang> if Base.astro's inline boot script
  // already ran (so SSR / first client paint agree on the same
  // string). Falls back to the browser language otherwise.
  if (typeof document !== "undefined") {
    const a = document.documentElement.dataset.lang;
    if (a === "de" || a === "en") return a;
  }
  if (typeof navigator === "undefined") return "en";
  const l = (navigator.language || "en").toLowerCase();
  return l.startsWith("de") ? "de" : "en";
}

function loadStored(): Lang | null {
  if (typeof localStorage === "undefined") return null;
  const v = localStorage.getItem(STORAGE_KEY);
  return v === "de" || v === "en" ? v : null;
}

// Plain mutable — readable from .astro / non-Svelte callers via
// getLang() or via the t() helper. The store mirrors this on every
// setLang() so Svelte components re-render.
let currentLang: Lang = loadStored() ?? detectInitial();

/** Reactive store. Svelte components read it via `$lang` and get
 *  reactive updates whenever setLang() is called. */
export const lang = writable<Lang>(currentLang);

export function setLang(next: Lang): void {
  if (next === currentLang) return;
  currentLang = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* localStorage may be blocked; the in-memory value still works. */
  }
  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("data-lang", next);
  }
  lang.set(next);
  // Page-level chrome (h1, subtitles on .astro pages, Base.astro title)
  // is server-rendered. To update those without restructuring into a
  // Svelte island, do a soft reload. Svelte components in `client:load`
  // islands (RoomRandomizer, BucketDraw, LanguageToggle, ThemeToggle)
  // re-read `currentLang` from localStorage in Base's inline boot script
  // and pick the right language for first paint — so the reload is
  // visually just a flicker on the placeholder text.
  if (typeof window !== "undefined") {
    window.location.reload();
  }
}

/** Plain non-reactive getter — for one-shot reads in .astro files
 *  where the SSR snapshot is baked into the HTML. */
export function getLang(): Lang {
  return currentLang;
}

/**
 * Translation table. English is the fallback; German overrides only
 * where a translation exists. Missing keys fall back to English so the
 * site stays usable while translations are in progress.
 */
const STRINGS: Record<string, { en: string; de?: string }> = {
  "nav.theme":         { en: "Theme",                  de: "Helligkeit" },
  "nav.theme.light":   { en: "Use light theme",        de: "Helles Thema" },
  "nav.theme.dark":    { en: "Use dark theme",         de: "Dunkles Thema" },

  "home.subtitle":          { en: "Two tiny tools. No accounts. No tracking. Works offline once loaded.",
                                de: "Zwei kleine Werkzeuge. Keine Accounts. Kein Tracking. Funktioniert offline nach dem Laden." },
  "home.open":              { en: "Open",                                    de: "Öffnen" },
  "home.rooms.title":         { en: "Room randomizer",                       de: "Raum-Zufallsgenerator" },
  "home.rooms.subtitle":      { en: "Add people and rooms, then tap Shuffle to assign.",
                                de: "Personen und Räume hinzufügen, dann auf Mischen tippen." },
  "home.draw.title":          { en: "Bucket draw",                           de: "Listen-Ziehung" },
  "home.draw.subtitle":       { en: "Add options to your bucket, then tap Draw to pick one.",
                                de: "Optionen in den Eimer, dann auf Ziehen tippen." },
  "home.draw.empty":          { en: "Add some options to your bucket, or prefill Bundesliga, then tap Draw.",
                                de: "Optionen hinzufügen oder Bundesliga vorladen, dann auf Ziehen tippen." },
  "home.footer":              { en: "Built with Astro + Svelte. State stays in your browser.",
                                de: "Gebaut mit Astro + Svelte. Dein Zustand bleibt im Browser." },

  "rooms.title":              { en: "Room randomizer",                       de: "Raum-Zufallsgenerator" },
  "rooms.subtitle":           { en: "Add people and rooms, then tap Shuffle to assign.",
                                de: "Personen und Räume hinzufügen, dann auf Mischen tippen." },
  "rooms.people.header":      { en: "People",                                de: "Personen" },
  "rooms.people.hint":        { en: "(type to rename)",                      de: "zum Umbenennen tippen" },
  "rooms.people.add":         { en: "Add person",                            de: "Person hinzufügen" },
  "rooms.people.add.aria":    { en: "Add person",                            de: "Person hinzufügen" },
  "rooms.people.remove":      { en: "Remove person",                         de: "Person entfernen" },
  "rooms.people.placeholder": { en: "Person 1",                              de: "Person 1" },
  "rooms.people.pinned":      { en: "Pinned person",                         de: "Zugewiesene Person" },
  "rooms.rooms.header":       { en: "Rooms",                                 de: "Räume" },
  "rooms.rooms.hint":         { en: "(type to rename)",                      de: "zum Umbenennen tippen" },
  "rooms.rooms.add":          { en: "Add room",                              de: "Raum hinzufügen" },
  "rooms.rooms.add.aria":     { en: "Add room",                              de: "Raum hinzufügen" },
  "rooms.rooms.remove":       { en: "Remove room",                           de: "Raum entfernen" },
  "rooms.rooms.placeholder":  { en: "Room 1",                                de: "Raum 1" },
  "rooms.rooms.pinned":       { en: "Pinned room",                           de: "Zugewiesener Raum" },
  "rooms.rooms.capacity":     { en: "Capacity",                              de: "Kapazität" },
  "rooms.rooms.capacity.decrease": { en: "Decrease capacity",                de: "Kapazität verringern" },
  "rooms.rooms.capacity.increase": { en: "Increase capacity",                de: "Kapazität erhöhen" },
  "rooms.rooms.capacity.for": { en: "Capacity for {name}",                   de: "Kapazität für {name}" },
  "rooms.rooms.fill":         { en: "Fill for {name}",                       de: "Belegung für {name}" },
  "rooms.rooms.capacity.status": { en: "Capacity status",                    de: "Kapazitätsstatus" },
  "rooms.rooms.filled":        { en: "Filled",                                de: "Belegt" },
  "rooms.pins.header":        { en: "Pre-assigned pins",                     de: "Vorbelegte Zuweisungen" },
  "rooms.pins.section":       { en: "Pre-assigned pins",                     de: "Vorbelegte Zuweisungen" },
  "rooms.pins.add":           { en: "Add pin",                               de: "Zuweisung hinzufügen" },
  "rooms.pins.add.aria":      { en: "Add pin",                               de: "Zuweisung hinzufügen" },
  "rooms.pins.remove":        { en: "Remove pin",                            de: "Zuweisung entfernen" },
  "rooms.pins.clear":         { en: "Clear pins",                            de: "Zuweisungen löschen" },
  "rooms.pins.person.placeholder": { en: "— pick person —",                  de: "— Person wählen —" },
  "rooms.pins.room.placeholder":   { en: "— pick room —",                    de: "— Raum wählen —" },

  "rooms.actions.shuffle":    { en: "Shuffle",                               de: "Mischen" },
  "rooms.actions.clear":      { en: "Clear",                                 de: "Leeren" },
  "rooms.actions.copy":       { en: "Copy shareable link",                   de: "Link kopieren" },
  "rooms.actions.copied":     { en: "Copied!",                               de: "Kopiert!" },
  "rooms.actions.copyFailed": { en: "Copy failed",                           de: "Kopieren fehlgeschlagen" },

  "rooms.capacity.ok":        { en: "{p} people · {s} spots · capacity matches",
                                de: "{p} Personen · {s} Plätze · Kapazität passt" },
  "rooms.capacity.under":     { en: "{p} people · {s} spots · {f} free",
                                de: "{p} Personen · {s} Plätze · {f} frei" },
  "rooms.capacity.over":      { en: "{p} people · {s} spots · {u} will be unassigned",
                                de: "{p} Personen · {s} Plätze · {u} ohne Zuordnung" },

  "rooms.results.section":    { en: "Assignment results",                    de: "Zuteilungsergebnis" },
  "rooms.results.title":      { en: "Results",                               de: "Ergebnis" },
  "rooms.results.list":       { en: "List view",                             de: "Listenansicht" },
  "rooms.results.grid":       { en: "Grid view",                             de: "Kartenansicht" },
  "rooms.results.empty":      { en: "No one assigned yet.",                  de: "Noch niemand zugewiesen." },
  "rooms.results.unassigned": { en: "Unassigned",                            de: "Ohne Zuordnung" },
  "rooms.results.copy":       { en: "Copy results",                          de: "Ergebnis kopieren" },
  "rooms.results.copied":     { en: "Copied!",                               de: "Kopiert!" },
  "rooms.results.copyFailed": { en: "Copy failed",                           de: "Kopieren fehlgeschlagen" },
  "rooms.results.whatsapp":   { en: "Share via WhatsApp",                    de: "Per WhatsApp teilen" },
  "rooms.results.whatsapp.sent": { en: "Sent!",                              de: "Gesendet!" },
  "rooms.results.count":      { en: "{a} assigned",
                                de: "{a} zugeordnet" },
  "rooms.results.unassigned.count": { en: "{u} unassigned",
                                       de: "{u} ohne Zuordnung" },
  "rooms.results.card.empty": { en: "No one assigned.",                       de: "Niemand zugewiesen." },
  "rooms.results.pinned":     { en: "pinned",                                de: "fixiert" },
  "rooms.results.pinned.aria":{ en: "room pinned",                           de: "Raum fixiert" },

  "lang.de":                 { en: "German",                                de: "Deutsch" },
  "lang.en":                 { en: "English",                               de: "Englisch" },

  // Bucket draw
  "draw.bucket.header":           { en: "Bucket",                              de: "Eimer" },
  "draw.bucket.prefill":          { en: "Prefill Bundesliga",                  de: "Bundesliga vorladen" },
  "draw.bucket.prefill.aria":     { en: "Prefill bucket with the current 1. Bundesliga clubs",
                                      de: "Eimer mit den aktuellen 1. Bundesliga-Vereinen befüllen" },
  "draw.bucket.clear":            { en: "Clear",                                de: "Leeren" },
  "draw.bucket.clear.aria":       { en: "Clear bucket and history",            de: "Eimer und Historie leeren" },
  "draw.bucket.cleared":          { en: "Cleared!",                             de: "Geleert!" },
  "draw.bucket.options.aria":     { en: "Bucket options",                       de: "Eimer-Optionen" },
  "draw.bucket.chip.placeholder": { en: "+ Add option…",                        de: "+ Option hinzufügen …" },
  "draw.bucket.chip.placeholder.aria": { en: "Add bucket option",               de: "Option zum Eimer hinzufügen" },
  "draw.bucket.empty":           { en: "No options yet — type below or prefill",  de: "Noch keine Optionen — unten eingeben oder vorladen" },
  "draw.chip.remove.aria":       { en: "Remove {name}",                            de: "{name} entfernen" },
  "draw.modal.aria":             { en: "Drawn result",                             de: "Gezogenes Ergebnis" },

  "draw.mode.with":               { en: "With replacement",                     de: "Mit Zurücklegen" },
  "draw.mode.without":            { en: "Without replacement",                  de: "Ohne Zurücklegen" },
  "draw.mode.with.aria":          { en: "Mode: With replacement (click to switch to Without replacement)",
                                      de: "Modus: Mit Zurücklegen (klicken zum Wechseln auf Ohne Zurücklegen)" },
  "draw.mode.without.aria":       { en: "Mode: Without replacement (click to switch to With replacement)",
                                      de: "Modus: Ohne Zurücklegen (klicken zum Wechseln auf Mit Zurücklegen)" },
  "draw.mode.with.aria.on":       { en: "With replacement — on",                de: "Mit Zurücklegen — an" },
  "draw.mode.without.aria.on":    { en: "Without replacement — on",             de: "Ohne Zurücklegen — an" },

  "draw.actions.draw":            { en: "Draw",                                 de: "Ziehen" },
  "draw.actions.share":           { en: "Share link",                           de: "Link teilen" },
  "draw.actions.share.aria":      { en: "Copy shareable link",                  de: "Teilbaren Link kopieren" },
  "draw.actions.share.copied":    { en: "Copied!",                              de: "Kopiert!" },
  "draw.actions.share.failed":    { en: "Copy failed",                          de: "Kopieren fehlgeschlagen" },

  "draw.modal.done":              { en: "Done",                                 de: "Fertig" },
  "draw.modal.drawing.sr":        { en: "Drawing… opening the loot box.",        de: "Ziehen … öffne die Überraschungsbox." },
  "draw.modal.opening":           { en: "Opening the box…",                       de: "Box wird geöffnet …" },

  "draw.history.title":           { en: "Recent draws",                          de: "Letzte Ziehungen" },
  "draw.history.clear":           { en: "Clear history",                         de: "Historie löschen" },
  "draw.history.section.aria":    { en: "Draw history",                          de: "Ziehungshistorie" },
};

/**
 * Look up a translation for the current language, falling back to English.
 * Reads `currentLang` at call time so any caller sees the active
 * language. NOTE: not itself reactive — Svelte components that read
 * `t()` in a template will re-render when they subscribe to `$lang`
 * (which mirrors currentLang), so the next `t()` call returns the new
 * language. This works because Svelte re-runs the whole template on
 * store updates.
 */
export function t(key: keyof typeof STRINGS | string): string {
  const entry = STRINGS[key];
  if (!entry) return String(key);
  return currentLang === "de" && entry.de ? entry.de : entry.en;
}

/**
 * Variant of `t()` that substitutes `{name}` placeholders with values
 * from the supplied object. Unknown placeholders are left untouched.
 */
export function tx(
  key: keyof typeof STRINGS | string,
  vars: Record<string, string | number> = {},
): string {
  return t(key).replace(/\{(\w+)\}/g, (match, name) => {
    const v = vars[name];
    return v === undefined ? match : String(v);
  });
}
