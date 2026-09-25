<script lang="ts">
  import { onMount } from 'svelte';
  import { t as tBase, lang } from "~/scripts/i18n";

  // Svelte 5 reactivity bridge: every t(...) call in the template reads
  // langTick (a $derived of the lang store) so the component re-renders
  // when the user flips EN/DE.
  const langTick = $derived($lang);
  const t = (key: string): string => {
    void langTick;
    return tBase(key);
  };

  // Server-side renders in EN (the only lang the SSR has access to).
  // Once the client hydrates, this state flips to the user's stored
  // language, triggering the template to re-render. This avoids a
  // brief flash of empty content while the island mounts.
  let hydrated = $state(false);
  onMount(() => {
    hydrated = true;
  });

  type Tool = {
    href: string;
    titleKey: "home.rooms.title" | "home.draw.title";
    descKey: "home.rooms.subtitle" | "home.draw.subtitle";
  };

  const tools: Tool[] = [
    {
      href: "/random-tools/room-randomizer/",
      titleKey: "home.rooms.title",
      descKey: "home.rooms.subtitle",
    },
    {
      href: "/random-tools/draw/",
      titleKey: "home.draw.title",
      descKey: "home.draw.subtitle",
    },
  ];
</script>

{#if !hydrated}
  <!-- SSR fallback: render the EN content directly so there's no flash
       of empty space before the island hydrates. The client island
       takes over after mount and re-renders in the stored lang. -->
  <h1 class="text-3xl font-semibold tracking-tight">random-tools</h1>
  <p class="text-muted mt-2 text-base sm:text-lg">
    {tBase('home.subtitle')}
  </p>

  <div class="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
    {#each tools as tool (tool.href)}
      <a
        href={tool.href}
        class="group border-border rounded-xl border p-6 transition-colors hover:border-accent"
      >
        <h2 class="text-xl font-semibold">{tBase(tool.titleKey)}</h2>
        <p class="text-muted mt-1 text-sm">{tBase(tool.descKey)}</p>
        <span class="text-accent mt-4 inline-block text-sm font-medium">
          {tBase('home.open')} →
        </span>
      </a>
    {/each}
  </div>

  <footer class="text-muted mt-12 text-xs">
    <span aria-hidden="true">⚡ </span>{tBase('home.footer')}
  </footer>
{:else}
  <!-- Client-side reactive render. Re-runs whenever the lang store fires. -->
  <h1 class="text-3xl font-semibold tracking-tight">random-tools</h1>
  <p class="text-muted mt-2 text-base sm:text-lg">
    {t('home.subtitle')}
  </p>

  <div class="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
    {#each tools as tool (tool.href)}
      <a
        href={tool.href}
        class="group border-border rounded-xl border p-6 transition-colors hover:border-accent"
      >
        <h2 class="text-xl font-semibold">{t(tool.titleKey)}</h2>
        <p class="text-muted mt-1 text-sm">{t(tool.descKey)}</p>
        <span class="text-accent mt-4 inline-block text-sm font-medium">
          {t('home.open')} →
        </span>
      </a>
    {/each}
  </div>

  <footer class="text-muted mt-12 text-xs">
    <span aria-hidden="true">⚡ </span>{t('home.footer')}
  </footer>
{/if}
