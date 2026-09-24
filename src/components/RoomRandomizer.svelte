<script lang="ts">
  import { onMount } from 'svelte';
  import { assignRooms, type Room } from '~/lib/random';

  type Assigned = { person: string; room: string };
  type Result = { assigned: Assigned[]; unassigned: string[] } | null;

  const PEOPLE_KEY = 'random-tools:people';
  const ROOMS_KEY = 'random-tools:rooms';

  let mounted = $state(false);
  let peopleText = $state('');
  let roomsText = $state('');
  let result = $state<Result>(null);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');

  // Parsed views (kept reactive so the Shuffle button reflects current input).
  const people = $derived(
    peopleText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const rooms = $derived(
    parseRooms(roomsText),
  );

  function parseRooms(input: string): Room[] {
    const out: Room[] = [];
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const colon = line.lastIndexOf(':');
      if (colon !== -1) {
        const left = line.slice(0, colon).trim();
        const right = line.slice(colon + 1).trim();
        const n = Number(right);
        if (left && Number.isFinite(n) && n > 0 && /^\d+$/.test(right)) {
          out.push({ name: left, capacity: Math.floor(n) });
          continue;
        }
      }
      out.push({ name: line });
    }
    return out;
  }

  function shuffle(): void {
    result = assignRooms(people, rooms);
  }

  function clearAll(): void {
    peopleText = '';
    roomsText = '';
    result = null;
    shareState = 'idle';
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(PEOPLE_KEY);
        window.localStorage.removeItem(ROOMS_KEY);
        // Drop any share hash so a refresh starts clean.
        if (window.location.hash) {
          history.replaceState(null, '', window.location.pathname);
        }
      } catch {
        // localStorage may be blocked; ignore.
      }
    }
  }

  /**
   * URL-hash payload. Uses base64url over UTF-8 so non-ASCII names
   * (umlauts, accents, emoji) round-trip safely.
   */
  function encodePayload(payload: { people: string; rooms: string }): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(encoded: string): { people: string; rooms: string } | null {
    try {
      const padded = encoded.replace(/-/g, '+').replace(/_/g, '/');
      const bin = atob(padded + '==='.slice((padded.length + 3) % 4));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const json = new TextDecoder().decode(bytes);
      const parsed = JSON.parse(json) as unknown;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'people' in parsed &&
        'rooms' in parsed &&
        typeof (parsed as { people: unknown }).people === 'string' &&
        typeof (parsed as { rooms: unknown }).rooms === 'string'
      ) {
        const p = parsed as { people: string; rooms: string };
        return { people: p.people, rooms: p.rooms };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function share(): Promise<void> {
    if (typeof window === 'undefined') return;
    const encoded = encodePayload({ people: peopleText, rooms: roomsText });
    const url = `${window.location.origin}${window.location.pathname}#data=${encoded}`;
    try {
      window.history.replaceState(null, '', url);
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(url);
      } else {
        // Fallback for non-secure contexts (e.g. http://127.0.0.1).
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      shareState = 'copied';
    } catch {
      shareState = 'error';
    }
  }

  onMount(() => {
    mounted = true;

    // 1. URL hash wins over localStorage.
    const hash = window.location.hash;
    const match = hash.match(/^#data=(.+)$/);
    if (match) {
      const decoded = decodePayload(match[1]);
      if (decoded) {
        peopleText = decoded.people;
        roomsText = decoded.rooms;
        return;
      }
    }

    // 2. Fall back to localStorage.
    try {
      const p = window.localStorage.getItem(PEOPLE_KEY);
      const r = window.localStorage.getItem(ROOMS_KEY);
      if (p !== null) peopleText = p;
      if (r !== null) roomsText = r;
    } catch {
      // localStorage may be blocked (private mode, etc.). Skip silently.
    }
  });

  // Persist on every keystroke. v1: simple, no debounce.
  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(PEOPLE_KEY, peopleText);
      window.localStorage.setItem(ROOMS_KEY, roomsText);
    } catch {
      // Ignore quota / blocked storage.
    }
  });

  function onShareKey(e: KeyboardEvent): void {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      void share();
    }
  }
</script>

<svelte:window on:keydown={onShareKey} />

<div class="space-y-6">
  <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
    <label class="block">
      <span class="text-fg mb-2 block text-sm font-medium">People</span>
      <textarea
        bind:value={peopleText}
        rows="8"
        placeholder="Alice&#10;Bob&#10;Carol"
        class="text-base border-border bg-bg text-fg placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:border-accent focus:outline-none"
        style="font-size: 16px"
        aria-label="List of people, one per line"
      ></textarea>
    </label>

    <label class="block">
      <span class="text-fg mb-2 block text-sm font-medium">
        Rooms
        <span class="text-muted font-normal">(Name or "Name: capacity")</span>
      </span>
      <textarea
        bind:value={roomsText}
        rows="8"
        placeholder="Room 101: 4&#10;Room 102&#10;Suite A: 2"
        class="text-base border-border bg-bg text-fg placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:border-accent focus:outline-none"
        style="font-size: 16px"
        aria-label="List of rooms, one per line, with optional capacity"
      ></textarea>
    </label>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={shuffle}
      class="bg-accent text-accent-fg hover:opacity-90 inline-flex min-h-[44px] items-center rounded-lg px-4 py-2.5 font-medium"
    >
      Shuffle
    </button>
    <button
      type="button"
      onclick={clearAll}
      class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2.5 font-medium"
    >
      Clear
    </button>
    <button
      type="button"
      onclick={share}
      class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2.5 font-medium"
      aria-label="Copy shareable link"
    >
      {#if shareState === 'copied'}
        Copied!
      {:else if shareState === 'error'}
        Copy failed
      {:else}
        Share link
      {/if}
    </button>
    <span class="text-muted text-xs" aria-live="polite">
      {#if result}
        {result.assigned.length} assigned{#if result.unassigned.length > 0}, {result.unassigned.length} unassigned{/if}
      {/if}
    </span>
  </div>

  {#if result}
    <section aria-label="Assignment results" class="border-border rounded-xl border p-4 sm:p-6">
      <h2 class="text-fg text-lg font-semibold">Results</h2>

      {#if result.assigned.length > 0}
        <ul class="mt-3 space-y-1">
          {#each result.assigned as a (a.person + '|' + a.room)}
            <li class="text-fg text-base">
              <span class="font-medium">{a.person}</span>
              <span class="text-muted px-1">→</span>
              <span>{a.room}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted mt-3 text-sm">No one assigned yet.</p>
      {/if}

      {#if result.unassigned.length > 0}
        <div class="mt-5">
          <h3 class="text-muted text-sm font-semibold uppercase tracking-wide">
            Unassigned
          </h3>
          <ul class="text-muted mt-2 space-y-1 text-base">
            {#each result.unassigned as person (person)}
              <li>{person}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}
</div>
