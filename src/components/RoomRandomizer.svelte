<script lang="ts">
  import { onMount } from 'svelte';
  import { fly } from 'svelte/transition';
  import { assignRooms, formatAssignmentForShare, type Pin, type Room } from '~/lib/random';
  import Icon from '~/lib/icons.svelte';

  type Assigned = { person: string; room: string };
  type Result = { assigned: Assigned[]; unassigned: string[] } | null;
  type Person = { id: number; name: string };
  type RoomEntry = { id: number; name: string; capacity: number };

  const PEOPLE_KEY = 'random-tools:people';
  const ROOMS_KEY = 'random-tools:rooms';
  const PINS_KEY = 'random-tools:pins';

  const STEPPER_MAX = 50;

  // Canonical URL for this tool, baked in at build time from astro.config.mjs's
  // `site:` + `base:` settings. Used to drop a "Open the tool:" link into the
  // WhatsApp share text so recipients can land straight on the tool. Falls
  // back to the current origin at runtime (covers dev / unusual build configs
  // where import.meta.env.SITE might be undefined).
  //
  // Note: `BASE_URL` is always normalized to NO trailing slash (e.g. "/random-tools"),
  // so we hard-code the slash between base and the route path.
  const builtInToolUrl =
    typeof import.meta.env.SITE === 'string' && import.meta.env.SITE
      ? `${import.meta.env.SITE}${import.meta.env.BASE_URL || ''}/room-randomizer/`
      : '';
  const toolUrl = $derived(
    builtInToolUrl ||
      (typeof window !== 'undefined'
        ? `${window.location.origin}/random-tools/room-randomizer/`
        : ''),
  );

  let mounted = $state(false);
  // People live as an array of cards (slice 11). The persisted shape is still
  // a newline-separated string of names (no capacity syntax) — see
  // `serializePeople` / `parsePeople`. localStorage + URL hash keep that
  // exact format so existing users (slice 6..10) don't lose data.
  //
  // Slice 12: each card now has a stable numeric `id` so we can key the
  // {#each} by something that survives index shifts on remove. Otherwise
  // removing a middle card would re-key everything after it and re-fire
  // the fly-in transition on all those cards.
  let nextPersonId = $state(0);
  let people = $state<Person[]>([]);
  // Rooms live as an array of cards now (slice 10). The textarea format
  // (`Name` or `Name: capacity`, one per line) is still what gets persisted
  // to localStorage and shared via URL hash — see `serializeRooms` / `parseRooms`.
  let nextRoomId = $state(0);
  let rooms = $state<RoomEntry[]>([]);
  let result = $state<Result>(null);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');
  // Brief "Sent ✓" feedback after the WhatsApp share opens wa.me. We don't
  // know whether the user actually sends the message (wa.me opens in a new
  // tab), so this is purely a visual confirmation that the click landed.
  let whatsappState = $state<'idle' | 'sent'>('idle');
  let shimmering = $state(false);
  let reducedMotion = $state(false);

  // Pins: explicit list of {person, room} rows, one row per pin the user
  // added. Default is empty — the user opts in via "+ Add pin". Each row
  // starts with a stable numeric `id` so {#each} re-keys correctly on
  // add/remove (otherwise removing a middle row re-keys everything after
  // it and re-fires the fly-out transition on those rows).
  //
  // Slice 16: switched from Record<person, room> to Array<{person, room}>
  // so the UI can show "no pins" by default. We dedup by person silently
  // (the same person can only appear once; reassigning via the dropdown
  // updates the existing row). Validation against the current people /
  // rooms list happens in the `validPins` derived value below.
  let nextPinId = $state(0);
  let pins = $state<{ id: number; person: string; room: string }[]>([]);

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
  // room, with both fields filled). Empty / unknown entries are skipped at
  // shuffle time; invalid rows still appear in the UI but are inert.
  //
  // Pins track the entity's *display* name, which equals the final{People,
  // Rooms} name unless the field was empty (then it falls back to
  // "Person N" / "Room N"). Rename follow-through happens at edit time —
  // see `updatePersonName` / `updateRoomName` and the renumbering pass in
  // validPins itself for removed / dedup'd rows.
  const validPins = $derived.by((): Pin[] => {
    const peopleSet = new Set(finalPeople);
    const roomNames = new Set(finalRooms.map((r) => r.name));
    const out: Pin[] = [];
    for (const row of pins) {
      const person = (row.person ?? '').trim();
      const room = (row.room ?? '').trim();
      if (!person) continue;
      if (!room) continue;
      if (!peopleSet.has(person)) continue;
      if (!roomNames.has(room)) continue;
      out.push({ person, room });
    }
    return out;
  });

  // Set of pinned person names — used for the 🔒 visual cue in results.
  const pinnedNames = $derived(new Set(validPins.map((p) => p.person)));

  // Display order for the Results list: group by room (alphabetical,
  // case-insensitive). `assignRooms` returns placements in arrival order;
  // sorting is a UI concern, not a data one, so it lives here and the
  // underlying array stays untouched (deterministic fixtures, share hash,
  // WhatsApp text all keep their original placement order).
  const sortedAssigned = $derived(
    result
      ? [...result.assigned].sort((a, b) =>
          a.room.localeCompare(b.room, undefined, { sensitivity: 'base' }),
        )
      : [],
  );

  // Slice 15 (J): global capacity pill. Predictive — answers "is my setup
  // even going to fit?" before the user shuffles. Three states:
  //   OK    — people === spots (rare but handled)
  //   Under — spots > people (room to grow) — forest (primary accent)
  //   Over  — spots < people (some people will be unassigned) — amber
  //           (operator fingerprint, perfect use for accent-2 per brand)
  // Hidden entirely until the user has at least one person AND one room.
  const totalCapacity = $derived(
    finalRooms.reduce((s, r) => s + r.capacity, 0),
  );
  const capacityDelta = $derived(finalPeople.length - totalCapacity);
  const capacityLabel = $derived.by(() => {
    if (finalPeople.length === 0 || finalRooms.length === 0) return null;
    if (capacityDelta === 0) {
      return `${finalPeople.length} people · ${totalCapacity} spots · capacity matches`;
    }
    if (capacityDelta < 0) {
      return `${finalPeople.length} people · ${totalCapacity} spots · ${-capacityDelta} free`;
    }
    return `${finalPeople.length} people · ${totalCapacity} spots · ${capacityDelta} will be unassigned`;
  });

  // Slice 15 (J): per-room fill counts. Built from the result.assigned
  // array (post-shuffle truth), keyed by room name. Defensive: the map
  // is seeded with every current room at 0 so a room with zero placements
  // still renders an empty bar instead of disappearing from the card.
  const roomFill = $derived.by(() => {
    const map = new Map<string, number>();
    for (const r of finalRooms) map.set(r.name, 0);
    if (result) {
      for (const a of result.assigned) {
        map.set(a.room, (map.get(a.room) ?? 0) + 1);
      }
    }
    return map;
  });

  // --- Persisted rooms ↔ textarea-format helpers -----------------------
  // The textarea format is "Name" or "Name: capacity", one per line. We keep
  // writing to localStorage in that exact shape so existing users don't lose
  // data (slice 6 / slice 7 customers).
  function parseRooms(input: string): RoomEntry[] {
    const out: RoomEntry[] = [];
    let id = nextRoomId;
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      const colon = line.lastIndexOf(':');
      let entry: RoomEntry;
      if (colon !== -1) {
        const left = line.slice(0, colon).trim();
        const right = line.slice(colon + 1).trim();
        const n = Number(right);
        if (left && Number.isFinite(n) && n > 0 && /^\d+$/.test(right)) {
          entry = { id: id++, name: left, capacity: Math.floor(n) };
          out.push(entry);
          continue;
        }
      }
      entry = { id: id++, name: line, capacity: 1 };
      out.push(entry);
    }
    nextRoomId = id;
    return out;
  }

  function serializeRooms(rs: readonly RoomEntry[]): string {
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
    let id = nextPersonId;
    for (const raw of input.split('\n')) {
      const line = raw.trim();
      if (!line) continue;
      out.push({ id: id++, name: line });
    }
    nextPersonId = id;
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
    people = [...people, { id: nextPersonId++, name }];
  }

  function removePersonAt(id: number): void {
    const index = people.findIndex((p) => p.id === id);
    if (index < 0) return;
    const removed = people[index];
    const removedName = (removed.name ?? '').trim() || `Person ${index + 1}`;
    const next = people.filter((p) => p.id !== id);
    people = next;
    // Drop any pin anchored to this person. We use the *placeholder* name
    // because that's what the pin stored while the field was empty.
    const nextPins = pins.filter((p) => p.person !== removedName);
    if (nextPins.length !== pins.length) pins = nextPins;
  }

  function updatePersonName(id: number, newName: string): void {
    const index = people.findIndex((p) => p.id === id);
    if (index < 0) return;
    const oldPerson = people[index];
    const oldName = (oldPerson.name ?? '').trim() || `Person ${index + 1}`;
    const trimmed = newName.trim();
    const newDisplay = trimmed === '' ? `Person ${index + 1}` : trimmed;
    const next = people.slice();
    next[index] = { ...oldPerson, name: trimmed };
    people = next;
    if (oldName === newDisplay) return;
    // Rename follow-through: rewrite every pin keyed by the old name.
    let pinsChanged = false;
    const nextPins = pins.map((p) => {
      if (p.person === oldName) {
        pinsChanged = true;
        return { ...p, person: newDisplay };
      }
      return p;
    });
    if (pinsChanged) pins = nextPins;
  }

  function addRoom(): void {
    if (rooms.length >= STEPPER_MAX) return;
    const name = `Room ${nextRoomNumber()}`;
    rooms = [...rooms, { id: nextRoomId++, name, capacity: 1 }];
  }

  function removeRoomAt(id: number): void {
    const index = rooms.findIndex((r) => r.id === id);
    if (index < 0) return;
    const removed = rooms[index];
    const removedName = (removed.name ?? '').trim() || `Room ${index + 1}`;
    const newRooms = rooms.filter((r) => r.id !== id);
    rooms = newRooms;
    // Prune any pin that pointed at the removed room. We use the *placeholder*
    // name because that's what the pin stored while the field was empty.
    const nextPins = pins.filter((p) => p.room !== removedName);
    if (nextPins.length !== pins.length) pins = nextPins;
  }

  function updateRoomName(id: number, newName: string): void {
    const index = rooms.findIndex((r) => r.id === id);
    if (index < 0) return;
    const oldRoom = rooms[index];
    const oldName = (oldRoom.name ?? '').trim() || `Room ${index + 1}`;
    const trimmed = newName.trim();
    const newDisplay = trimmed === '' ? `Room ${index + 1}` : trimmed;
    const next = rooms.slice();
    next[index] = { ...oldRoom, name: trimmed };
    rooms = next;
    if (oldName === newDisplay) return;
    // Rename follow-through: rewrite every pin that pointed at the old name.
    let pinsChanged = false;
    const nextPins = pins.map((p) => {
      if (p.room === oldName) {
        pinsChanged = true;
        return { ...p, room: newDisplay };
      }
      return p;
    });
    if (pinsChanged) pins = nextPins;
  }

  function bumpCapacity(id: number, delta: number): void {
    const index = rooms.findIndex((r) => r.id === id);
    if (index < 0) return;
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
    pins = [];
    nextPinId = 0;
    result = null;
    shareState = 'idle';
    whatsappState = 'idle';
    shimmering = false;
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
    pins = [];
  }

  // Slice 16 (K): add / mutate / remove pin rows. Each row carries an
  // internal `id` so the {#each} block can re-key on add/remove without
  // re-firing transitions on neighbour rows.
  function addPin(): void {
    if (pins.length >= STEPPER_MAX) return;
    pins = [...pins, { id: nextPinId++, person: '', room: '' }];
  }

  function removePinAt(id: number): void {
    const before = pins.length;
    const next = pins.filter((p) => p.id !== id);
    if (next.length !== before) pins = next;
  }

  function updatePinPerson(id: number, person: string): void {
    // Silent dedup: if the new person is already pinned in another row,
    // update *that* row (so the user always sees exactly one entry per
    // pinned person) and drop the row that just became a duplicate.
    const trimmed = person.trim();
    const conflict = trimmed
      ? pins.find((p) => p.id !== id && p.person === trimmed)
      : null;
    if (conflict) {
      // Update the conflicting row's room to whatever was in the row
      // we're now merging into (i.e. swap their rooms). Simpler than
      // deciding who wins: the user's most recent pick wins, so move
      // the current row's room onto the conflict, then drop the current.
      const currentRoom = pins.find((p) => p.id === id)?.room ?? '';
      pins = pins
        .filter((p) => p.id !== id)
        .map((p) => (p.id === conflict.id ? { ...p, room: currentRoom } : p));
      return;
    }
    pins = pins.map((p) => (p.id === id ? { ...p, person: trimmed } : p));
  }

  function updatePinRoom(id: number, room: string): void {
    const trimmed = room.trim();
    pins = pins.map((p) => (p.id === id ? { ...p, room: trimmed } : p));
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
   *
   * v5 (slice 16): `pins` is now an array of `{person, room}` rows
   * (`Pin[]`). On decode, legacy object payloads (v2..v4) are still
   * accepted and normalized to the array form via Object.entries().
   */
  type PinRow = { id: number; person: string; room: string };
  function encodePayload(payload: {
    people: string;
    rooms: string;
    pins: PinRow[];
  }): string {
    // Strip the internal `id` from what's written — on the receiving
    // side we hand out fresh ids. Keeps the payload small and avoids
    // leaking ephemeral UI state into a shared link.
    const wirePins = payload.pins.map(({ person, room }) => ({ person, room }));
    const json = JSON.stringify({ ...payload, pins: wirePins });
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(
    encoded: string,
  ): { people: string; rooms: string; pins: PinRow[] } | null {
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
        const outPins: PinRow[] = [];
        if (Array.isArray(p.pins)) {
          for (const row of p.pins) {
            if (
              row &&
              typeof row === 'object' &&
              typeof (row as { person?: unknown }).person === 'string' &&
              typeof (row as { room?: unknown }).room === 'string'
            ) {
              outPins.push({
                id: nextPinId++,
                person: (row as { person: string }).person,
                room: (row as { room: string }).room,
              });
            }
          }
        } else if (p.pins && typeof p.pins === 'object') {
          // Legacy v2..v4 Record<person, room> — normalize to array rows.
          for (const [k, v] of Object.entries(p.pins as Record<string, unknown>)) {
            if (typeof v === 'string') {
              outPins.push({
                id: nextPinId++,
                person: k,
                room: v,
              });
            }
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
      // Auto-revert so the button can be used again without manual reset.
      window.setTimeout(() => {
        shareState = 'idle';
      }, 1500);
    } catch {
      shareState = 'error';
    }
  }

  function shareWhatsApp(): void {
    if (typeof window === 'undefined') return;
    if (!result || result.assigned.length === 0) return;
    const message = formatAssignmentForShare(result, toolUrl);
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
    whatsappState = 'sent';
    window.setTimeout(() => {
      whatsappState = 'idle';
    }, 1500);
  }

  const whatsappDisabled = $derived(!result || result.assigned.length === 0);

  // Result shimmer: play only on null → value transitions. The actual
  // shimmer animation lives in CSS and is applied via the `shimmering`
  // class on the results card. Once the animation ends we drop the class
  // so a subsequent re-render (typing in inputs, etc.) doesn't replay it.
  let prevResult = $state<Result>(null);
  $effect(() => {
    if (!mounted) return;
    const wasNull = prevResult === null;
    const isSet = result !== null;
    prevResult = result;
    if (wasNull && isSet) {
      shimmering = true;
      window.setTimeout(() => {
        shimmering = false;
      }, reducedMotion ? 0 : 700);
    }
  });

  onMount(() => {
    mounted = true;

    // Respect users who get sick from animated motion. Drives the
    // shimmer, the fly-in/out, and the hover-lift via media query in CSS.
    if (typeof window.matchMedia === 'function') {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedMotion = mq.matches;
    }

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
        const loaded: { id: number; person: string; room: string }[] = [];
        if (Array.isArray(parsed)) {
          for (const row of parsed) {
            if (
              row &&
              typeof row === 'object' &&
              typeof (row as { person?: unknown }).person === 'string' &&
              typeof (row as { room?: unknown }).room === 'string'
            ) {
              loaded.push({
                id: nextPinId++,
                person: (row as { person: string }).person,
                room: (row as { room: string }).room,
              });
            }
          }
        } else if (parsed && typeof parsed === 'object') {
          // Legacy v2..v4 Record<person, room> in localStorage.
          for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
            if (typeof v === 'string') {
              loaded.push({ id: nextPinId++, person: k, room: v });
            }
          }
        }
        pins = loaded;
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

  // Transition tunables. Cheap defaults — kept short so a rapid sequence of
  // adds/removes doesn't visually queue up.
  const FLY_MS = 200;
  const flyIn = reducedMotion
    ? () => ({ duration: 0 })
    : (): Parameters<typeof fly>[0] => ({ y: 8, duration: FLY_MS });

  const flyOut = reducedMotion
    ? () => ({ duration: 0 })
    : (): Parameters<typeof fly>[0] => ({ y: -4, duration: 150 });
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
        {#each people as person, i (person.id)}
          {@const placeholder = `Person ${i + 1}`}
          <div
            class="rt-card border-border bg-bg-elevated relative rounded-lg border p-4"
            data-testid="person-card"
            in:fly={flyIn()}
            out:fly={flyOut()}
          >
            <button
              type="button"
              onclick={() => removePersonAt(person.id)}
              aria-label={`Remove person ${(person.name ?? '').trim() || placeholder}`}
              class="text-fg-muted hover:text-fg rt-pressable absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
            >
              ×
            </button>

            <input
              type="text"
              value={person.name ?? ''}
              oninput={(e) => updatePersonName(person.id, (e.currentTarget as HTMLInputElement).value)}
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
          class="border-border text-fg-muted hover:text-fg hover:border-accent rt-pressable inline-flex min-h-[5rem] items-center justify-center gap-2 rounded-lg border border-dashed bg-transparent px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="plus" />
          <span>Add person</span>
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
        {#each rooms as room, i (room.id)}
          {@const placeholder = `Room ${i + 1}`}
          {@const cap = room.capacity ?? 1}
          {@const filled = result ? (roomFill.get((room.name ?? '').trim() || placeholder) ?? 0) : null}
          {@const fillPct = filled === null ? 0 : Math.min(100, Math.round((filled / Math.max(1, cap)) * 100))}
          {@const overfilled = filled !== null && filled > cap}
          <div
            class="rt-card border-border bg-bg-elevated relative rounded-lg border p-4"
            data-testid="room-card"
            in:fly={flyIn()}
            out:fly={flyOut()}
          >
            <button
              type="button"
              onclick={() => removeRoomAt(room.id)}
              aria-label={`Remove room ${(room.name ?? '').trim() || placeholder}`}
              class="text-fg-muted hover:text-fg rt-pressable absolute top-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-base leading-none"
            >
              ×
            </button>

            <input
              type="text"
              value={room.name ?? ''}
              oninput={(e) => updateRoomName(room.id, (e.currentTarget as HTMLInputElement).value)}
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
                  onclick={() => bumpCapacity(room.id, -1)}
                  disabled={(room.capacity ?? 1) <= 1}
                  aria-label="Decrease capacity"
                  class="text-fg-muted hover:text-fg hover:bg-bg-hover rt-pressable inline-flex h-8 w-8 items-center justify-center rounded-full text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
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
                  onclick={() => bumpCapacity(room.id, +1)}
                  disabled={(room.capacity ?? 1) >= STEPPER_MAX}
                  aria-label="Increase capacity"
                  class="text-fg-muted hover:text-fg hover:bg-bg-hover rt-pressable inline-flex h-8 w-8 items-center justify-center rounded-full text-base leading-none disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  +
                </button>
              </span>
            </div>

            {#if filled !== null}
              <div class="mt-3 space-y-1.5" data-testid="room-fill">
                <div class="text-fg-muted flex items-center justify-between text-xs">
                  <span class="font-medium uppercase tracking-wide">
                    Filled
                  </span>
                  <span class="font-mono tabular-nums">
                    {filled} / {cap}
                  </span>
                </div>
                <div
                  class="bg-bg-hover h-1.5 w-full overflow-hidden rounded-full"
                  role="progressbar"
                  aria-valuemin="0"
                  aria-valuemax={cap}
                  aria-valuenow={filled}
                  aria-label={`Fill for ${(room.name ?? '').trim() || placeholder}`}
                >
                  <div
                    class="rt-fill-bar h-full rounded-full"
                    class:bg-accent={!overfilled}
                    class:bg-accent-2={overfilled}
                    style:width={`${fillPct}%`}
                  ></div>
                </div>
              </div>
            {/if}
          </div>
        {/each}

        <button
          type="button"
          onclick={addRoom}
          disabled={rooms.length >= STEPPER_MAX}
          aria-label="Add room"
          class="border-border text-fg-muted hover:text-fg hover:border-accent rt-pressable inline-flex min-h-[6rem] items-center justify-center gap-2 rounded-lg border border-dashed bg-transparent px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Icon name="plus" />
          <span>Add room</span>
        </button>
      </div>
    </div>
  </div>

  {#if finalPeople.length > 0 && finalRooms.length > 0}
    <section aria-label="Pre-assigned pins" class="border-border rounded-xl border p-4 sm:p-6">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-accent-2 font-mono text-sm font-semibold uppercase tracking-wide">
          Pre-assigned pins
        </h2>
        {#if pins.length > 0}
          <button
            type="button"
            onclick={clearPins}
            class="text-muted hover:text-fg rt-pressable text-xs"
            aria-label="Clear all pins"
          >
            Clear pins
          </button>
        {/if}
      </div>

      <ul class="mt-3 space-y-2">
        {#each pins as row (row.id)}
          {@const usedNames = new Set(pins.filter((p) => p.id !== row.id).map((p) => p.person))}
          <li
            class="border-border bg-bg-elevated flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
            in:fly={flyIn()}
            out:fly={flyOut()}
          >
            <div class="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:flex sm:items-center sm:gap-3">
              <select
                value={row.person}
                onchange={(e) => updatePinPerson(row.id, (e.currentTarget as HTMLSelectElement).value)}
                class="border-border bg-bg text-fg min-w-[140px] rounded-lg border px-3 py-2 text-base"
                style="font-size: 16px"
                aria-label="Pinned person"
              >
                <option value="">— pick person —</option>
                {#each finalPeople as person (person)}
                  {#if !usedNames.has(person) || person === row.person}
                    <option value={person}>{person}</option>
                  {/if}
                {/each}
              </select>
              <span class="text-fg-muted hidden text-base sm:inline" aria-hidden="true">→</span>
              <select
                value={row.room}
                onchange={(e) => updatePinRoom(row.id, (e.currentTarget as HTMLSelectElement).value)}
                class="border-border bg-bg text-fg min-w-[140px] rounded-lg border px-3 py-2 text-base"
                style="font-size: 16px"
                aria-label="Pinned room"
              >
                <option value="">— pick room —</option>
                {#each finalRooms as room (room.name)}
                  <option value={room.name}>{room.name}</option>
                {/each}
              </select>
            </div>
            <button
              type="button"
              onclick={() => removePinAt(row.id)}
              aria-label="Remove pin"
              class="text-fg-muted hover:text-fg rt-pressable inline-flex h-9 w-9 items-center justify-center self-end rounded-full text-base leading-none sm:self-auto"
            >
              ×
            </button>
          </li>
        {/each}
      </ul>

      <button
        type="button"
        onclick={addPin}
        disabled={pins.length >= STEPPER_MAX}
        aria-label="Add pin"
        class="border-border text-fg-muted hover:text-fg hover:border-accent rt-pressable mt-3 inline-flex w-full min-h-[3rem] items-center justify-center gap-2 rounded-lg border border-dashed bg-transparent px-3 py-2 font-mono text-sm disabled:cursor-not-allowed disabled:opacity-40"
      >
        <Icon name="plus" />
        <span>Add pin</span>
      </button>
    </section>
  {:else if finalPeople.length > 0}
    <section aria-label="Pre-assigned pins" class="border-border rounded-xl border p-4 sm:p-6">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-accent-2 font-mono text-sm font-semibold uppercase tracking-wide">
          Pre-assigned pins
        </h2>
      </div>
      <p class="text-muted mt-3 text-sm">
        Add at least one room to pin people.
      </p>
    </section>
  {/if}

  {#if capacityLabel}
    {@const over = capacityDelta > 0}
    {@const ok = capacityDelta === 0}
    <div class="flex justify-center" aria-label="Capacity status">
      <span
        class="font-mono text-sm"
        class:bg-accent-tint={!over}
        class:text-accent={!over}
        class:bg-accent-2-soft={over}
        class:text-accent-2={over}
        class:ring-1={ok}
        class:ring-accent={ok}
        class:bg-transparent={ok}
        data-testid="capacity-badge"
        data-state={over ? 'over' : ok ? 'ok' : 'under'}
        role="status"
        aria-live="polite"
        style:padding="6px 12px"
        style:border-radius="9999px"
        style:display="inline-block"
      >
        {capacityLabel}
      </span>
    </div>
  {/if}

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={shuffle}
      class="bg-accent text-accent-fg hover:opacity-90 rt-pressable inline-flex min-h-[44px] items-center gap-2 rounded-lg px-4 py-2.5 font-medium"
    >
      <Icon name="shuffle" />
      <span>Shuffle</span>
    </button>
    <button
      type="button"
      onclick={clearAll}
      class="border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center gap-2 rounded-lg border bg-transparent px-4 py-2.5 font-medium"
    >
      <Icon name="trash" />
      <span>Clear</span>
    </button>
    <button
      type="button"
      onclick={share}
      class="border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center gap-2 rounded-lg border bg-transparent px-4 py-2.5 font-medium"
      aria-label="Copy shareable link"
      aria-live="polite"
    >
      {#if shareState === 'copied'}
        <Icon name="check" class="h-4 w-4 text-accent" />
        <span>Copied!</span>
      {:else if shareState === 'error'}
        <span>Copy failed</span>
      {:else}
        <Icon name="link" />
        <span>Share link</span>
      {/if}
    </button>
    <button
      type="button"
      onclick={shareWhatsApp}
      disabled={whatsappDisabled}
      title="Send via WhatsApp"
      class="border-border text-fg hover:border-accent rt-pressable inline-flex min-h-[44px] items-center gap-2 rounded-lg border bg-transparent px-4 py-2.5 font-medium disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-border"
      aria-label="Send results via WhatsApp"
    >
      {#if whatsappState === 'sent'}
        <Icon name="check" class="h-4 w-4 text-accent" />
        <span>Sent!</span>
      {:else}
        <Icon name="whatsapp" class="h-[18px] w-[18px]" />
        <span>WhatsApp</span>
      {/if}
    </button>
    <span class="text-muted text-xs" aria-live="polite">
      {#if result}
        {result.assigned.length} assigned{#if result.unassigned.length > 0}, {result.unassigned.length} unassigned{/if}
      {/if}
    </span>
  </div>

  {#if result}
    <section
      aria-label="Assignment results"
      class="border-border rt-shimmer rounded-xl border p-4 sm:p-6"
      class:shimmering
    >
      <h2 class="text-fg text-lg font-semibold">Results</h2>

      {#if result.assigned.length > 0}
        <ul class="mt-3 space-y-1">
          {#each sortedAssigned as a (a.person + '|' + a.room)}
            <li class="text-fg text-base">
              <span class="font-semibold">{a.person}</span>
              {#if pinnedNames.has(a.person)}
                <span class="text-fg-meta ml-1 text-xs" aria-label="pinned">🔒</span>
              {/if}
              <span class="text-fg-meta px-1" aria-hidden="true">→</span>
              <span class="font-semibold text-accent">{a.room}</span>
            </li>
          {/each}
        </ul>
      {:else}
        <p class="text-muted mt-3 text-sm">No one assigned yet.</p>
      {/if}

      {#if result.unassigned.length > 0}
        <div class="mt-5">
          <h3 class="text-fg-muted text-sm font-semibold uppercase tracking-wide">
            Unassigned
          </h3>
          <ul class="text-fg-muted mt-2 space-y-1 text-base">
            {#each result.unassigned as person (person)}
              <li>{person}</li>
            {/each}
          </ul>
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  /* ─── Card hover lift (subtle) ──────────────────────────────────
   * +2px lift + soft forest-tinted shadow. Capped at 150ms so the
   * motion feels like a tap, not a hover-and-think. The `:hover`
   * variant respects prefers-reduced-motion (see media query at the
   * bottom of the file). */
  .rt-card {
    transition:
      transform 150ms var(--ease-out),
      box-shadow 150ms var(--ease-out),
      border-color 150ms var(--ease-out);
    will-change: transform;
  }
  .rt-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 2px 8px color-mix(in oklch, var(--accent) 14%, transparent);
  }

  /* ─── Button press feedback ─────────────────────────────────────
   * Tailwind v4 has `active:scale-95`, but the same effect via plain
   * CSS keeps the markup simpler and lets us tune the duration
   * explicitly (100ms — fast enough to feel like a click, slow
   * enough that you can see it). Applies even under
   * prefers-reduced-motion: it's so subtle it's not a motion issue. */
  .rt-pressable {
    transition: transform 100ms var(--ease-out);
  }
  .rt-pressable:active {
    transform: scale(0.96);
  }
  .rt-pressable:disabled {
    /* Disable press feedback when the button isn't interactive. */
    transform: none;
  }

  /* ─── Result card shimmer (Mario's E) ───────────────────────────
   * Plays once per null → result transition. Class is dropped after
   * the animation ends so re-renders don't replay it. */
  .rt-shimmer {
    position: relative;
    overflow: hidden;
  }
  .rt-shimmer::after {
    content: "";
    position: absolute;
    inset: 0;
    background: linear-gradient(
      100deg,
      transparent 30%,
      color-mix(in oklch, var(--accent) 18%, transparent) 50%,
      transparent 70%
    );
    transform: translateX(-100%);
    pointer-events: none;
    opacity: 0;
  }
  .rt-shimmer.shimmering::after {
    opacity: 1;
    animation: rt-shimmer-sweep 600ms var(--ease-out);
  }

  @keyframes rt-shimmer-sweep {
    0% {
      transform: translateX(-100%);
      opacity: 0;
    }
    20% {
      opacity: 1;
    }
    100% {
      transform: translateX(100%);
      opacity: 0;
    }
  }

  /* ─── Per-room fill bar (slice 15) ──────────────────────────────
   * GPU-friendly width transition (compositor-promoted property) so
   * the bar animates smoothly after a shuffle without re-layout. */
  .rt-fill-bar {
    transition:
      width 250ms var(--ease-out),
      background-color 150ms var(--ease-out);
    will-change: width;
  }

  /* ─── Reduced motion ────────────────────────────────────────────
   * Strip the card lift, the shimmer sweep, and any non-essential
   * transform transitions. Button active:scale remains — it's below
   * the perceptual motion threshold. */
  @media (prefers-reduced-motion: reduce) {
    .rt-card {
      transition: border-color 150ms var(--ease-out);
    }
    .rt-card:hover {
      transform: none;
      box-shadow: none;
    }
    .rt-shimmer::after {
      display: none;
    }
    .rt-fill-bar {
      transition: none;
      will-change: auto;
    }
  }
</style>