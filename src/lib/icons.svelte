<!--
  Icon set (slice 12). Inline SVGs, paths copied from lucide (ISC) — see
  https://lucide.dev. No external library: we ship the SVG body directly
  so we don't add a dependency and so the icons inherit currentColor
  for free (every stroke / fill below resolves to currentColor or
  inherits it).

  Usage in any .svelte file:

    import Icon from "~/lib/icons.svelte";
    <Icon.Shuffle class="h-4 w-4" />

  All icons are 24x24 viewBox. The size is controlled by the `class`
  prop (h-4 / w-4 = 16px; h-5 / w-5 = 20px). They are aria-hidden by
  default — the surrounding button / label carries the accessible name.

  Why a single icon-name component: each variant is rendered inside the
  same component so we avoid a per-icon Svelte file. The trade-off is
  one big component, but the icon bodies are short and this keeps the
  surface area tiny.
-->
<script lang="ts">
  type IconName =
    | "shuffle"
    | "trash"
    | "link"
    | "whatsapp"
    | "sparkles"
    | "plus"
    | "check"
    | "football";

  type Props = {
    name: IconName;
    class?: string;
  };

  const { name, class: cls = "h-4 w-4" }: Props = $props();
</script>

{#if name === "shuffle"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <polyline points="16 3 21 3 21 8" />
    <line x1="4" y1="20" x2="21" y2="3" />
    <polyline points="21 16 21 21 16 21" />
    <line x1="15" y1="15" x2="21" y2="21" />
    <line x1="4" y1="4" x2="9" y2="9" />
  </svg>
{:else if name === "trash"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6M14 11v6" />
    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
  </svg>
{:else if name === "link"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
  </svg>
{:else if name === "whatsapp"}
  <!--
    Simplified WhatsApp glyph (recognisable chat-bubble-with-phone
    silhouette). Uses fill="currentColor" so the icon takes the
    surrounding button's text color — on the room-randomizer this
    means the WhatsApp glyph inherits the button's forest-aware text.
  -->
  <svg
    viewBox="0 0 24 24"
    fill="currentColor"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M17.6 6.32A7.85 7.85 0 0 0 12.04 4a7.94 7.94 0 0 0-6.88 11.9L4 20l4.2-1.1a7.93 7.93 0 0 0 3.84.98h.01c4.38 0 7.94-3.56 7.94-7.94a7.9 7.9 0 0 0-2.39-5.62zm-5.56 12.22h-.01a6.6 6.6 0 0 1-3.36-.92l-.24-.14-2.5.65.67-2.42-.16-.25a6.6 6.6 0 1 1 12.24-3.5 6.6 6.6 0 0 1-6.58 6.58zm3.62-4.94c-.2-.1-1.17-.58-1.35-.65-.18-.07-.31-.1-.45.1-.13.2-.51.65-.62.78-.12.13-.23.15-.42.05a5.42 5.42 0 0 1-1.6-.99 6 6 0 0 1-1.1-1.38c-.12-.2-.01-.3.09-.4l.27-.31c.09-.1.12-.18.18-.3.06-.12.03-.22-.02-.31l-.61-1.47c-.16-.39-.33-.34-.45-.34l-.39-.01a.75.75 0 0 0-.55.26 2.3 2.3 0 0 0-.72 1.71c0 1 .74 1.97.84 2.1.1.13 1.45 2.21 3.51 3.1.49.21.87.34 1.17.43.49.16.94.13 1.3.08.4-.06 1.17-.48 1.34-.94.16-.46.16-.85.12-.93-.05-.08-.18-.13-.38-.23z" />
  </svg>
{:else if name === "sparkles"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <path d="M12 3l1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3z" />
    <path d="M19 14l.7 2.1L22 17l-2.3.9L19 20l-.7-2.1L16 17l2.3-.9L19 14z" />
    <path d="M5 14l.7 2.1L8 17l-2.3.9L5 20l-.7-2.1L2 17l2.3-.9L5 14z" />
  </svg>
{:else if name === "plus"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <line x1="12" y1="5" x2="12" y2="19" />
    <line x1="5" y1="12" x2="19" y2="12" />
  </svg>
{:else if name === "check"}
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    class={cls}
    aria-hidden="true"
    focusable="false"
  >
    <polyline points="20 6 9 17 4 12" />
  </svg>
{:else if name === "football"}
  <!-- A small football / soccer ball glyph rendered as a unicode emoji so
       it picks up the system coloured emoji on every platform. Used on
       the Prefill Bundesliga button — emoji is appropriate here because
       the icon is decorative (the button label carries the meaning). -->
  <span class={cls} aria-hidden="true" style="display:inline-block;line-height:1">⚽</span>
{/if}