<script lang="ts">
  import { onMount } from 'svelte';
  import { assignRooms, type Pin, type Room } from '~/lib/random';

  type Assigned = { person: string; room: string };
  type Result = { assigned: Assigned[]; unassigned: string[] } | null;

  const PEOPLE_KEY = 'random-tools:people';
  const ROOMS_KEY = 'random-tools:rooms';
  const PINS_KEY = 'random-tools:pins';

  let mounted = $state(false);
  let peopleText = $state('');
  let roomsText = $state('');
  let result = $state<Result>(null);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');

  // Pins: keyed by person name, value is room name (empty = no pin).
  // Kept as the "user intent" — pruning happens at display time so the
  // user doesn't lose pins while still typing in the textareas.
  let pins = $state<Record<string, string>>({});

  // Parsed views (kept reactive so the Shuffle button reflects current input).
  const people = $derived(
    peopleText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  );

  const rooms = $derived(parseRooms(roomsText));

  // Set of currently-valid pins (referencing both a known person and a known room).
  const validPins = $derived.by((): Pin[] => {
    const peopleSet = new Set(people);
    const roomNames = new Set(rooms.map((r) => r.name));
    const out: Pin[] = [];
    for (const [person, room] of Object.entries(pins)) {
      if (!room) continue;
      if (!peopleSet.has(person)) continue;
      if (!roomNames.has(room)) continue;
      out.push({ person, room });
    }
    return out;
  });

  // Set of pinned person names — used for the 🔒 visual cue in results.
  const pinnedNames = $derived(new Set(validPins.map((p) => p.person)));

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
    result = assignRooms(people, rooms, validPins);
  }

  function clearAll(): void {
    peopleText = '';
    roomsText = '';
    pins = {};
    result = null;
    shareState = 'idle';
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(PEOPLE_KEY);
        window.localStorage.removeItem(ROOMS_KEY);
        window.localStorage.removeItem(PINS_KEY);
        // Drop any share hash so a refresh starts clean.
        if (window.location.hash) {
          history.replaceState(null, '', window.location.pathname);
        }
      } catch {
        // localStorage may be blocked; ignore.
      }
    }
  }

  function clearPins(): void {
    pins = {};
  }

  /**
   * URL-hash payload. Uses base64url over UTF-8 so non-ASCII names
   * (umlauts, accents, emoji) round-trip safely.
   *
   * v2 schema adds an optional `pins` field (Record<person, room>).
   * Old payloads without `pins` still decode fine.
   */
  function encodePayload(payload: {
    people: string;
    rooms: string;
    pins: Record<string, string>;
  }): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(
    encoded: string,
  ): { people: string; rooms: string; pins: Record<string, string> } | null {
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
        const p = parsed as { people: string; rooms: string; pins?: unknown };
        const outPins: Record<string, string> = {};
        if (p.pins && typeof p.pins === 'object' && !Array.isArray(p.pins)) {
          for (const [k, v] of Object.entries(p.pins as Record<string, unknown>)) {
            if (typeof v === 'string') outPins[k] = v;
          }
        }
        return { people: p.people, rooms: p.rooms, pins: outPins };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function share(): Promise<void> {
    if (typeof window === 'undefined') return;
    const encoded = encodePayload({ people: peopleText, rooms: roomsText, pins });
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
        pins = decoded.pins;
        return;
      }
    }

    // 2. Fall back to localStorage.
    try {
      const p = window.localStorage.getItem(PEOPLE_KEY);
      const r = window.localStorage.getItem(ROOMS_KEY);
      const pinRaw = window.localStorage.getItem(PINS_KEY);
      if (p !== null) peopleText = p;
      if (r !== null) roomsText = r;
      if (pinRaw !== null) {
        const parsed = JSON.parse(pinRaw) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const out: Record<string, string> = {};
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') out[k] = v;
          }
          pins = out;
        }
      }
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
      window.localStorage.setItem(PINS_KEY, JSON.stringify(pins));
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

  function setPin(person: string, room: string): void {
    if (room === '') {
      // Unassign pin.
      const { [person]: _drop, ...rest } = pins;
      void _drop;
      pins = rest;
    } else {
      pins = { ...pins, [person]: room };
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

  {#if people.length > 0}
    <section aria-label="Pre-assigned pins" class="border-border rounded-xl border p-4 sm:p-6">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-muted text-sm font-semibold uppercase tracking-wide">
          Pre-assigned
        </h2>
        {#if validPins.length > 0}
          <button
            type="button"
            onclick={clearPins}
            class="text-muted hover:text-fg text-xs"
            aria-label="Clear all pins"
          >
            Clear pins
          </button>
        {/if}
      </div>

      {#if rooms.length === 0}
        <p class="text-muted mt-3 text-sm">
          Add at least one room to pin them.
        </p>
      {:else}
        <ul class="mt-3 space-y-2">
          {#each people as person (person)}
            <li class="flex items-center justify-between gap-3">
              <span class="text-fg truncate text-base">{person}</span>
              <select
                value={pins[person] ?? ''}
                onchange={(e) => setPin(person, (e.currentTarget as HTMLSelectElement).value)}
                class="border-border bg-bg text-fg min-w-[140px] rounded-lg border px-3 py-2.5 text-base"
                style="font-size: 16px"
                aria-label={`Pin ${person} to a room`}
              >
                <option value="">— unassigned —</option>
                {#each rooms as room (room.name)}
                  <option value={room.name}>{room.name}</option>
                {/each}
              </select>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}

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
              {#if pinnedNames.has(a.person)}
                <span class="text-muted ml-1 text-xs" aria-label="pinned">🔒</span>
              {/if}
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