<script lang="ts">
  import { lang, setLang, type Lang } from "~/scripts/i18n";

  /**
   * Language switcher that flips the site between English (default) and
   * German. The `lang` store is read via `$lang` so Svelte re-renders
   * the active button whenever setLang() is called from anywhere (this
   * component, another island, or a future shortcut).
   */
  function pick(next: Lang): void {
    setLang(next);
  }
</script>

<div
  class="lang-toggle inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-elevated p-0.5 shadow-sm"
  role="group"
  aria-label="Language"
>
  <button
    type="button"
    class="lang-toggle__btn"
    class:is-active={$lang === "en"}
    aria-label="English"
    aria-pressed={$lang === "en"}
    onclick={() => pick("en")}
  >
    EN
  </button>
  <button
    type="button"
    class="lang-toggle__btn"
    class:is-active={$lang === "de"}
    aria-label="Deutsch"
    aria-pressed={$lang === "de"}
    onclick={() => pick("de")}
  >
    DE
  </button>
</div>

<style>
  .lang-toggle {
    backdrop-filter: saturate(180%) blur(8px);
  }
  .lang-toggle__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    height: 32px;
    padding: 0 0.5rem;
    border-radius: 9999px;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    font-family: var(--font-mono);
    font-size: 0.7rem;
    font-weight: 600;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition:
      background-color 160ms var(--ease-out),
      color 160ms var(--ease-out);
  }
  .lang-toggle__btn:hover { color: var(--fg); }
  .lang-toggle__btn.is-active {
    background-color: var(--accent);
    color: var(--accent-fg, #fafafa);
  }
  .lang-toggle__btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>
