<script lang="ts">
  import { onMount } from 'svelte';
  import { assignRooms, formatAssignmentForShare, type Pin, type Room } from '~/lib/random';

  type Assigned = { person: string; room: string };
  type Result = { assigned: Assigned[]; unassigned: string[] } | null;
  type Person = { name: string };

  const PEOPLE_KEY = 'random-tools:people';
  const ROOMS_KEY = 'random-tools:rooms';
  const PINS_KEY = 'random-tools:pins';

  const STEPPER_MAX = 50;

  let mounted = $state(false);
  // People live as an array of cards (slice 11). The persisted shape is still
  // a newline-separated string of names (no capacity syntax) — see
  // `serializePeople` / `parsePeople`. localStorage + URL hash keep that
  // exact format so existing users (slice 6..10) don't lose data.
  let people = $state<Person[]>([]);
  // Rooms live as an array of cards now (slice 10). The textarea format
  // (`Name` or `Name: capacity`, one per line) is still what gets persisted
  // to localStorage and shared via URL hash — see `serializeRooms` / `parseRooms`.
  let rooms = $state<Room[]>([]);
  let result = $state<Result>(null);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');

  // Pins: keyed by person name, value is room name (empty = no pin).
  // Kept as the "user intent" — pruning happens at display time so the
  // user doesn't lose pins while still typing in a person card.
  let pins = $state<Record<string, string>>({});

  // "Final" people fed to assignRooms / Pre-assigned: each card gets a
  // unique non-empty name (placeholder fill, then uniqueness dedupe).
  const finalPeople = $derived.by((): string[] => {
    const taken = new Set<string>();
    const out: string[] = [];
    for (let i = 0; i < people.length; i++) {
      const baseName = (people[i].name ?? '').trim() || `Person ${i + 1}`;
      let name = baseName;
      if (taken.has(name)) {
        let n = 2;
        while (taken.has(`${baseName} (${n})`)) n++;
        name = `${baseName} (${n})`;
      }
      taken.add(name);
      out.push(name);
    }
    return out;
  });

  // "Final" rooms fed to assignRooms: each card gets a unique non-empty name
  // (placeholder fill, then uniqueness dedupe). Capacities clamp 1..STEPPER_MAX.
  const finalRooms = $derived.by((): Room[] => {
    const taken = new Set<string>();
    const out: Room[] = [];
    for (let i = 0; i < rooms.length; i++) {
      const r = rooms[i];
      const baseName = (r.name ?? '').trim() || `Room ${i + 1}`;
      let name = baseName;
      if (taken.has(name)) {
        let n = 2;
        while (taken.has(`${baseName} (${n})`)) n++;
        name = `${baseName} (${n})`;
      }
      taken.add(name);
      const cap = Math.max(1, Math.min(STEPPER_MAX, Math.floor(r.capacity ?? 1)));
      out.push({ name, capacity: cap });
    }
    return out;
  });

  // Set of currently-valid pins (referencing both a known person and a known
  // room). Note: pins track the entity's *display* name, which equals the
  // final{People,Rooms} name unless the field was empty (then it falls back
  // to "Person N" / "Room N"). Rename follow-through happens at edit time —
  // see `renamePerson` / `updateRoomName`.
  const validPins = $derived.by((): Pin[] => {
    const peopleSet = new Set(finalPeople);
    const roomNames = new Set(finalRooms.map((r) => r.name));
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

  // --- Persisted rooms ↔ textarea-format helpers -----------------------
  // The textarea format is "Name" or "Name: capacity", one per line. We keep
  // writing to localStorage in that exact shape so existing users don't lose
  // data (slice 6 / slice 7 customers).
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

  function serializeRooms(rs: readonly Room[]): string {
    return rs
      .map((r) => {
        const cap = Math.max(1, Math.min(STEPPER_MAX, Math.floor(r.capacity ?? 1)));
        // Only append capacity when the user explicitly set one (default 1
        // stays implicit to keep the textarea tidy).
        return cap === 1 ? r.name : `${r.name}: ${cap}`;
      })
      .join('\n');
  }

  // --- Persisted people ↔ newline-string helpers ----------------------
  // People were a textarea in slices 0..10. Each card's `name` is just one
  // string (no capacity). We keep the on-disk shape as `\n`-joined names so
  // anyone who already has a value in localStorage / shared via URL hash
  // still gets their list back.
  function parsePeople(input: string): Person[] {
    const out: Person[] = [];
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      out.push({ name: line });
    }
    return out;
  }

  function serializePeople(ps: readonly Person[]): string {
    return ps.map((p) => p.name).join('\n');
  }

  // Find the next available "Person N" number for auto-add.
  function nextPersonNumber(): number {
    const re = /^Person (\d+)$/;
    let max = 0;
    for (const p of people) {
      const m = (p.name ?? '').trim().match(re);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max + 1;
  }

  // Find the next available "Room N" number for auto-add.
  function nextRoomNumber(): number {
    const re = /^Room (\d+)$/;
    let max = 0;
    for (const r of rooms) {
      const m = (r.name ?? '').trim().match(re);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > max) max = n;
      }
    }
    return max + 1;
  }

  function addPerson(): void {
    if (people.length >= STEPPER_MAX) return;
    const name = `Person ${nextPersonNumber()}`;
    people = [...people, { name }];
  }

  function removePersonAt(index: number): void {
    if (index < 0 || index >= people.length) return;
    const removed = people[index];
    const removedName = (removed.name ?? '').trim() || `Person ${index + 1}`;
    const next = people.slice();
    next.splice(index, 1);
    people = next;
    // Drop any pin anchored to this person. We use the *placeholder* name
    // because that's what the pin stored while the field was empty.
    let changed = false;
    const nextPins: Record<string, string> = {};
    for (const [person, room] of Object.entries(pins)) {
      if (person === removedName) {
        changed = true;
        continue;
      }
      nextPins[person] = room;
    }
    if (changed) pins = nextPins;
  }

  function updatePersonName(index: number, newName: string): void {
    if (index < 0 || index >= people.length) return;
    const oldPerson = people[index];
    const oldName = (oldPerson.name ?? '').trim() || `Person ${index + 1}`;
    const trimmed = newName.trim();
    const newDisplay = trimmed === '' ? `Person ${index + 1}` : trimmed;
    if (oldName === newDisplay) {
      // Only the (possibly empty) raw value changed — write through.
      const next = people.slice();
      next[index] = { ...oldPerson, name: trimmed };
      people = next;
      return;
    }
    // Rename follow-through: rewrite every pin keyed by the old name.
    let pinsChanged = false;
    const nextPins: Record<string, string> = {};
    for (const [person, room] of Object.entries(pins)) {
      if (person === oldName) {
        nextPins[newDisplay] = room;
        pinsChanged = true;
      } else {
        nextPins[person] = room;
      }
    }
    const next = people.slice();
    next[index] = { ...oldPerson, name: trimmed };
    people = next;
    if (pinsChanged) pins = nextPins;
  }

  function addRoom(): void {
    if (rooms.length >= STEPPER_MAX) return;
    const name = `Room ${nextRoomNumber()}`;
    rooms = [...rooms, { name, capacity: 1 }];
  }

  function removeRoomAt(index: number): void {
    if (index < 0 || index >= rooms.length) return;
    const removed = rooms[index];
    const removedName = (removed.name ?? '').trim() || `Room ${index + 1}`;
    const newRooms = rooms.slice();
    newRooms.splice(index, 1);
    rooms = newRooms;
    // Prune any pin that pointed at the removed room. We use the *placeholder*
    // name because that's what the pin stored while the field was empty.
    let changed = false;
    const next: Record<string, string> = {};
    for (const [person, room] of Object.entries(pins)) {
      if (room === removedName) {
        changed = true;
        continue;
      }
      next[person] = room;
    }
    if (changed) pins = next;
  }

  function updateRoomName(index: number, newName: string): void {
    if (index < 0 || index >= rooms.length) return;
    const oldRoom = rooms[index];
    const oldName = (oldRoom.name ?? '').trim() || `Room ${index + 1}`;
    const trimmed = newName.trim();
    const newDisplay = trimmed === '' ? `Room ${index + 1}` : trimmed;
    if (oldName === newDisplay) {
      // Only the (possibly empty) raw value changed — write through.
      const next = rooms.slice();
      next[index] = { ...oldRoom, name: trimmed };
      rooms = next;
      return;
    }
    // Rename follow-through: rewrite every pin that pointed at the old name.
    let pinsChanged = false;
    const nextPins: Record<string, string> = {};
    for (const [person, room] of Object.entries(pins)) {
      if (room === oldName) {
        nextPins[person] = newDisplay;
        pinsChanged = true;
      } else {
        nextPins[person] = room;
      }
    }
    const next = rooms.slice();
    next[index] = { ...oldRoom, name: trimmed };
    rooms = next;
    if (pinsChanged) pins = nextPins;
  }

  function bumpCapacity(index: number, delta: number): void {
    if (index < 0 || index >= rooms.length) return;
    const cur = rooms[index];
    const next = Math.max(1, Math.min(STEPPER_MAX, (cur.capacity ?? 1) + delta));
    if (next === cur.capacity) return;
    const out = rooms.slice();
    out[index] = { ...cur, capacity: next };
    rooms = out;
  }

  function shuffle(): void {
    result = assignRooms(finalPeople, finalRooms, validPins);
  }

  function clearAll(): void {
    people = [];
    rooms = [];
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
   *
   * v3 (slice 10): `rooms` is still a textarea-format string for backward
   * compat with anything that reads the hash (bookmarks, sharing).
   *
   * v4 (slice 11): `people` is still a `\n`-joined names string for backward
   * compat with anything that reads the hash (bookmarks, sharing).
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
    const encoded = encodePayload({
      people: serializePeople(people),
      rooms: serializeRooms(rooms),
      pins,
    });
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

  function shareWhatsApp(): void {
    if (typeof window === 'undefined') return;
    if (!result || result.assigned.length === 0) return;
    const message = formatAssignmentForShare(result);
    const url = `https://wa.me/?text=${encodeURIComponent(message)}`;
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) {
      // Popup blocked — fall back to a synthetic anchor click.
      const a = document.createElement('a');
      a.href = url;
      a.rel = 'noopener noreferrer';
      a.target = '_blank';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    }
  }

  const whatsappDisabled = $derived(!result || result.assigned.length === 0);

  onMount(() => {
    mounted = true;

    // 1. URL hash wins over localStorage.
    const hash = window.location.hash;
    const match = hash.match(/^#data=(.+)$/);
    if (match) {
      const decoded = decodePayload(match[1]);
      if (decoded) {
        people = parsePeople(decoded.people);
        rooms = parseRooms(decoded.rooms);
        pins = decoded.pins;
        return;
      }
    }

    // 2. Fall back to localStorage.
    try {
      const p = window.localStorage.getItem(PEOPLE_KEY);
      const r = window.localStorage.getItem(ROOMS_KEY);
      const pinRaw = window.localStorage.getItem(PINS_KEY);
      if (p !== null) people = parsePeople(p);
      if (r !== null) rooms = parseRooms(r);
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

  // Persist on every change. v1: simple, no debounce.
  // The rooms array is serialized back to the textarea format so the on-disk
  // shape matches what older slices wrote (slice 6 / slice 7). Same goes for
  // people — kept as `\n`-joined names.
  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(PEOPLE_KEY, serializePeople(people));
      window.localStorage.setItem(ROOMS_KEY, serializeRooms(rooms));
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
    <div class="block">
      <div class="text-fg mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-2 text-sm font-medium">
        <span class="min-w-0">
          People
          <span class="text-muted font-normal">(click a card to rename)</span>
        </span>
        <span class="text-muted font-mono text-xs tabular-nums" aria-live="polite">
          {people.length} / {STEPPER_MAX}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {#each people as person, i (i)}
          {@const placeholder = `Person ${i + 1}`}
          <div
            class="border-border bg-bg-elevated relative rounded-lg border p-4"
            data-testid="person-card"
          >
            <button
              type="button"
              onclick={() => removePersonAt(i)}
              aria-label={`Remove person ${(person.name ?? '').trim() || placeholder}`}
              class="text-fg-muted hover:text-fg absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
            >
              ×
            </button>

            <input
              type="text"
              value={person.name ?? ''}
              oninput={(e) => updatePersonName(i, (e.currentTarget as HTMLInputElement).value)}
              {placeholder}
              aria-label={`Person ${i + 1} name`}
              class="text-fg placeholder:text-fg-disabled font-mono w-full bg-transparent border-0 pb-1 pr-7 text-base focus:border-b focus:border-accent focus:outline-none"
              style="font-size: 16px"
            />
          </div>
        {/each}

        <button
          type="button"
          onclick={addPerson}
          disabled={people.length >= STEPPER_MAX}
          aria-label="Add person"
          class="border-border text-fg-muted hover:text-fg hover:border-accent inline-flex min-h-[5rem] items-center justify-center rounded-lg border border-dashed bg-transparent px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add person
        </button>
      </div>
    </div>

    <div class="block">
      <div class="text-fg mb-2 flex flex-wrap items-center justify-between gap-x-2 gap-y-2 text-sm font-medium">
        <span class="min-w-0">
          Rooms
          <span class="text-muted font-normal">(click a card to rename)</span>
        </span>
        <span class="text-muted font-mono text-xs tabular-nums" aria-live="polite">
          {rooms.length} / {STEPPER_MAX}
        </span>
      </div>

      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each rooms as room, i (i)}
          {@const placeholder = `Room ${i + 1}`}
          <div
            class="border-border bg-bg-elevated relative rounded-lg border p-4"
            data-testid="room-card"
          >
            <button
              type="button"
              onclick={() => removeRoomAt(i)}
              aria-label={`Remove room ${(room.name ?? '').trim() || placeholder}`}
              class="text-fg-muted hover:text-fg absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
            >
              ×
            </button>

            <input
              type="text"
              value={room.name ?? ''}
              oninput={(e) => updateRoomName(i, (e.currentTarget as HTMLInputElement).value)}
              {placeholder}
              aria-label={`Room ${i + 1} name`}
              class="text-fg placeholder:text-fg-disabled font-mono w-full bg-transparent border-0 pb-1 pr-7 text-base focus:border-b focus:border-accent focus:outline-none"
              style="font-size: 16px"
            />

            <div class="mt-3 flex items-center justify-between gap-2">
              <span class="text-fg-muted text-xs font-medium uppercase tracking-wide">
                Capacity
              </span>
              <span class="inline-flex items-center gap-1" role="group" aria-label={`Capacity for ${(room.name ?? '').trim() || placeholder}`}>
                <button
                  type="button"
                  onclick={() => bumpCapacity(i, -1)}
                  disabled={(room.capacity ?? 1) <= 1}
                  aria-label="Decrease capacity"
                  class="text-fg-muted hover:text-fg hover:bg-bg-hover inline-flex h-8 w-8 items-center justify-center rounded-full text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  −
                </button>
                <span
                  aria-live="polite"
                  aria-atomic="true"
                  class="text-fg font-mono inline-flex h-8 min-w-[2rem] items-center justify-center px-2 text-sm tabular-nums"
                >
                  {room.capacity ?? 1}
                </span>
                <button
                  type="button"
                  onclick={() => bumpCapacity(i, +1)}
                  disabled={(room.capacity ?? 1) >= STEPPER_MAX}
                  aria-label="Increase capacity"
                  class="text-fg-muted hover:text-fg hover:bg-bg-hover inline-flex h-8 w-8 items-center justify-center rounded-full text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  +
                </button>
              </span>
            </div>
          </div>
        {/each}

        <button
          type="button"
          onclick={addRoom}
          disabled={rooms.length >= STEPPER_MAX}
          aria-label="Add room"
          class="border-border text-fg-muted hover:text-fg hover:border-accent inline-flex min-h-[6rem] items-center justify-center rounded-lg border border-dashed bg-transparent px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          + Add room
        </button>
      </div>
    </div>
  </div>

  {#if finalPeople.length > 0}
    <section aria-label="Pre-assigned pins" class="border-border rounded-xl border p-4 sm:p-6">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-accent-2 text-sm font-semibold uppercase tracking-wide">
          <span aria-hidden="true">$ </span>Pre-assigned
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

      {#if finalRooms.length === 0}
        <p class="text-muted mt-3 text-sm">
          Add at least one room to pin them.
        </p>
      {:else}
        <ul class="mt-3 space-y-2">
          {#each finalPeople as person (person)}
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
                {#each finalRooms as room (room.name)}
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
    <button
      type="button"
      onclick={shareWhatsApp}
      disabled={whatsappDisabled}
      title="Send via WhatsApp"
      class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
      aria-label="Send results via WhatsApp"
    >
      WhatsApp
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