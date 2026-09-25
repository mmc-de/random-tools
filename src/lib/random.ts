/**
 * Pure random-assignment utilities.
 *
 * No DOM, no localStorage, no globals — so these can be exercised by tests,
 * run during SSR, or reused by other tools (e.g. bucket-draw in Slice 3).
 */

export type Room = {
  name: string;
  capacity?: number;
};

export type Assigned = {
  person: string;
  room: string;
};

/**
 * Manual pre-assignment: force `person` into `room` before the random fill.
 * The algorithm is forgiving — invalid pins are skipped, not fatal.
 */
export type Pin = {
  person: string;
  room: string;
};

export type AssignmentResult = {
  assigned: Assigned[];
  unassigned: string[];
};

/**
 * Cryptographically unbiased random integer in [0, max).
 *
 * Uses `crypto.getRandomValues` to draw one 32-bit word and reduces modulo
 * `max`. Bias is < 2^32 / (max * 2^32), negligible for the room counts
 * we expect (single-digit to low-double-digit). For larger max values where
 * modulo bias matters, callers can call repeatedly and discard.
 */
function uniformInt(max: number): number {
  if (max <= 0) return 0;
  // 4 bytes give ~4 billion outcomes; for our max ranges (< 1000) bias is < 1e-7.
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

/**
 * Fisher-Yates shuffle. Returns a NEW array; the input is not mutated.
 *
 * Each `i` from n-1 down to 1 picks `uniformInt(i + 1)` as the swap index —
 * uniform over all permutations.
 */
export function shuffle<T>(items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = uniformInt(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}

/**
 * Assign each person to at most one room. Capacity defaults to 1.
 *
 * Algorithm: validate `pins` (forgiving — unknown person/room, duplicate,
 * over-capacity are skipped). Subtract pinned counts from each room's
 * remaining capacity. Greedy-fill the remaining people into remaining
 * capacity (shuffle the people first so output order is random). Any
 * people that don't fit land in `unassigned`.
 *
 * Pinned assignments are placed first in `assigned` (input order), then
 * the greedy-fill results follow (random order).
 */
export function assignRooms(
  people: readonly string[],
  rooms: readonly Room[],
  pins?: readonly Pin[],
): AssignmentResult {
  const normRooms = rooms
    .map((r) => ({ name: r.name, capacity: Math.max(0, r.capacity ?? 1) }))
    .filter((r) => r.capacity > 0);

  const peopleList = people.slice();

  if (normRooms.length === 0 || peopleList.length === 0) {
    return { assigned: [], unassigned: peopleList };
  }

  const peopleSet = new Set(peopleList);
  const roomByName = new Map(normRooms.map((r) => [r.name, r]));

  // Validate pins (forgiving).
  const validPins: { person: string; room: string }[] = [];
  const seenPerson = new Set<string>();
  const usedSlots = new Map<string, number>(); // room name -> pinned count

  if (pins) {
    for (const pin of pins) {
      if (!peopleSet.has(pin.person)) continue; // unknown person
      if (!roomByName.has(pin.room)) continue; // unknown room
      if (seenPerson.has(pin.person)) continue; // duplicate pin for same person
      const cap = roomByName.get(pin.room)!.capacity;
      const used = usedSlots.get(pin.room) ?? 0;
      if (used >= cap) continue; // would exceed capacity
      seenPerson.add(pin.person);
      usedSlots.set(pin.room, used + 1);
      validPins.push({ person: pin.person, room: pin.room });
    }
  }

  // Build remaining-capacity view and unpinned-people view.
  const remainingPeople = peopleList.filter((p) => !seenPerson.has(p));

  const remainingRooms = normRooms
    .map((r) => {
      const used = usedSlots.get(r.name) ?? 0;
      return { name: r.name, capacity: r.capacity - used };
    })
    .filter((r) => r.capacity > 0);

  if (remainingPeople.length === 0) {
    // Everyone is pinned — no random fill needed.
    return {
      assigned: validPins.map((p) => ({ person: p.person, room: p.room })),
      unassigned: [],
    };
  }

  // Skip rejection sampling once pins have constrained capacity: the
  // distribution is no longer uniform and greedy already produces a
  // capacity-respecting assignment.
  const fill = greedyFill(remainingPeople, remainingRooms);

  // Merge: pinned first (in input order), then filled (random order).
  return {
    assigned: [
      ...validPins.map((p) => ({ person: p.person, room: p.room })),
      ...fill.assigned,
    ],
    unassigned: fill.unassigned,
  };
}

function greedyFill(
  people: readonly string[],
  rooms: readonly { name: string; capacity: number }[],
): AssignmentResult {
  // Shuffle people so the output order is random.
  const remainingPeople = shuffle(people);
  // Mutate a working copy of capacities.
  const capLeft = rooms.map((r) => r.capacity);
  const assigned: Assigned[] = [];
  const unassigned: string[] = [];

  for (const person of remainingPeople) {
    // Build list of rooms with remaining capacity.
    const openIndices: number[] = [];
    for (let i = 0; i < rooms.length; i++) {
      if (capLeft[i] > 0) openIndices.push(i);
    }
    if (openIndices.length === 0) {
      unassigned.push(person);
      continue;
    }
    const pick = openIndices[uniformInt(openIndices.length)];
    capLeft[pick]--;
    assigned.push({ person, room: rooms[pick].name });
  }

  return { assigned, unassigned };
}

/**
 * Format an AssignmentResult as a markdown-ish message for sharing via
 * WhatsApp / Signal / Telegram / etc.
 *
 * Output shape:
 *   *🏠 Room assignments*
 *
 *   - *Alice* → *Room 101*
 *   - *Bob* → *Room 102*
 *
 *   _Unassigned: Dave_
 *
 *   🔗 *generated by* random-tools · https://example.com/room-randomizer/
 *
 * The unassigned line is omitted entirely when there are none. The
 * trailing URL line is appended only when a non-empty `url` is passed —
 * callers that don't want the link (tests, alternative share surfaces)
 * can simply omit it. The function is pure and safe to call during SSR.
 *
 * NOTE: the full URL must appear in the message for it to be tappable
 * in WhatsApp — messenger apps don't markdown-autolink bare labels,
 * and WhatsApp's preview/tap behaviour is triggered by the literal URL
 * string. The optional `urlLabel` is rendered next to it so readers see
 * a short human-readable hint, but the full URL still ships.
 */
export function formatAssignmentForShare(
  result: AssignmentResult,
  options?: {
    /** Full tool URL (used as the clickable link). */
    url?: string;
    /** Short human-readable label shown next to the URL. */
    urlLabel?: string;
  },
): string {
  const lines: string[] = ['*🏠 Room assignments*', ''];

  // WhatsApp's *bold* syntax is two asterisks. We bold the person name and
  // the room name, separated by a plain `→` arrow. The dash is the canonical
  // markdown list marker that most messengers (WhatsApp, Signal, Telegram)
  // render as a bullet.
  for (const a of result.assigned) {
    lines.push(`- *${a.person}* → *${a.room}*`);
  }

  if (result.unassigned.length > 0) {
    lines.push('', `_Unassigned: ${result.unassigned.join(', ')}_`);
  }

  const url = options?.url?.trim();
  if (url) {
    const label = options?.urlLabel?.trim();
    lines.push('');
    if (label) {
      lines.push(`🔗 *generated by* ${label} · ${url}`);
    } else {
      lines.push(`🔗 *generated by* ${url}`);
    }
  }

  return lines.join('\n');
}
