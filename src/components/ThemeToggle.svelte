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
    <span aria-hidden="true">☀</span>
  </button>
  <button
    type="button"
    class="theme-toggle__btn"
    class:is-active={current === "dark"}
    aria-label="Use dark theme"
    aria-pressed={current === "dark"}
    onclick={() => pick("dark")}
  >
    <span aria-hidden="true">🌙</span>
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