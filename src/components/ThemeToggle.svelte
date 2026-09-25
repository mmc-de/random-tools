<script lang="ts">
  import { onMount } from "svelte";
  import {
    applyTheme,
    getStoredTheme,
    getSystemTheme,
    setStoredTheme,
    type Theme,
  } from "~/scripts/theme";

  let current = $state<Theme>("dark");

  onMount(() => {
    // Inline boot script already painted <html data-theme="...">; mirror it.
    const attr = document.documentElement.getAttribute("data-theme");
    current = attr === "light" || attr === "dark" ? attr : getSystemTheme();
  });

  function pick(theme: Theme) {
    current = theme;
    setStoredTheme(theme);
    applyTheme(theme);
  }
</script>

<div
  class="theme-toggle inline-flex items-center gap-0.5 rounded-full border border-border bg-bg-elevated p-0.5 shadow-sm"
  role="group"
  aria-label="Theme"
>
  <button
    type="button"
    class="theme-toggle__btn"
    class:is-active={current === "light"}
    aria-label="Use light theme"
    aria-pressed={current === "light"}
    onclick={() => pick("light")}
  >
    <!--
      Monochrome sun (stroke-only). `currentColor` so the icon inherits the
      button's foreground — forest-green thumb-on when active, muted when
      inactive. Sized via the wrapping <span> wrapper so the SVG fills it.
    -->
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <line x1="12" y1="2"  x2="12" y2="5" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="2"  y1="12" x2="5"  y2="12" />
      <line x1="19" y1="12" x2="22" y2="12" />
      <line x1="4.5"  y1="4.5"  x2="6.6"  y2="6.6" />
      <line x1="17.4" y1="17.4" x2="19.5" y2="19.5" />
      <line x1="4.5"  y1="19.5" x2="6.6"  y2="17.4" />
      <line x1="17.4" y1="6.6"  x2="19.5" y2="4.5" />
    </svg>
  </button>
  <button
    type="button"
    class="theme-toggle__btn"
    class:is-active={current === "dark"}
    aria-label="Use dark theme"
    aria-pressed={current === "dark"}
    onclick={() => pick("dark")}
  >
    <!-- Monochrome crescent moon (stroke-only). -->
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  </button>
</div>

<style>
  .theme-toggle {
    /* Sit comfortably above the safe-area inset on notched phones. */
    font-size: 14px;
    line-height: 1;
    backdrop-filter: saturate(180%) blur(8px);
  }

  .theme-toggle__btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border-radius: 9999px;
    border: 0;
    background: transparent;
    color: var(--fg-muted);
    cursor: pointer;
    transition: background-color 160ms var(--ease-out), color 160ms var(--ease-out);
    padding: 0;
  }
  /* The inline SVGs inside the buttons. They inherit `currentColor` so
   * the stroke tracks the button's fg-muted / accent-fg states cleanly. */
  .theme-toggle__btn svg {
    width: 16px;
    height: 16px;
  }


  .theme-toggle__btn:hover {
    color: var(--fg);
  }

  .theme-toggle__btn.is-active {
    background-color: var(--accent);
    color: var(--color-accent-fg, #FAFAFA);
  }

  .theme-toggle__btn:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: 2px;
  }
</style>