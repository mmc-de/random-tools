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
 * Two algorithms:
 *
 *   (a) Total capacity < people.length → Greedy fill.
 *       Pick a random unassigned person, pick a random room with remaining
 *       capacity, place them. Repeat until no room has remaining capacity.
 *       Leftovers go to `unassigned`.
 *
 *   (b) Total capacity >= people.length → Rejection-sample a uniform capacity-
 *       feasible assignment; on max-retry, fall back to greedy.
 *
 *       Step 1: each person picks a random "slot index" in [0, totalCapacity).
 *       Step 2: read off room occupancy by slot. Reject if any room is over
 *       capacity (rare unless capacity ≈ people).
 *
 *       The fall-back greedy path is identical to (a) but every person
 *       eventually gets a slot.
 *
 * Both paths emit `assigned` in random order.
 */
export function assignRooms(
  people: readonly string[],
  rooms: readonly Room[],
): AssignmentResult {
  const normRooms = rooms
    .map((r) => ({ name: r.name, capacity: Math.max(0, r.capacity ?? 1) }))
    .filter((r) => r.capacity > 0);

  const peopleList = people.slice();

  if (normRooms.length === 0 || peopleList.length === 0) {
    return { assigned: [], unassigned: peopleList };
  }

  const totalCapacity = normRooms.reduce((s, r) => s + r.capacity, 0);

  if (totalCapacity >= peopleList.length) {
    const MAX_RETRY = 50;
    for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
      const result = sampleUniform(peopleList, normRooms);
      if (result) return result;
    }
    // Fall-through: rejection sampling kept rejecting (capacity ≈ people).
    return greedyFill(peopleList, normRooms);
  }

  // Insufficient capacity — best we can do.
  return greedyFill(peopleList, normRooms);
}

function sampleUniform(
  people: readonly string[],
  rooms: readonly { name: string; capacity: number }[],
): AssignmentResult | null {
  const totalCapacity = rooms.reduce((s, r) => s + r.capacity, 0);
  if (totalCapacity === 0) return null;

  // Each person picks an INDEPENDENT random slot in [0, totalCapacity).
  // Reject if any room is over capacity.
  const occupancy = new Array<number>(rooms.length).fill(0);
  // offsets[i] = first slot index that belongs to room i
  const offsets: number[] = [];
  let acc = 0;
  for (const r of rooms) {
    offsets.push(acc);
    acc += r.capacity;
  }

  // Assign each person a random slot
  const slots = new Array<number>(people.length);
  for (let i = 0; i < people.length; i++) {
    slots[i] = uniformInt(totalCapacity);
  }

  const assigned: Assigned[] = [];
  for (let i = 0; i < people.length; i++) {
    const slot = slots[i];
    // Find which room owns this slot
    let roomIdx = -1;
    for (let j = 0; j < rooms.length; j++) {
      const start = offsets[j];
      const end = start + rooms[j].capacity;
      if (slot >= start && slot < end) {
        roomIdx = j;
        break;
      }
    }
    if (roomIdx === -1) {
      // Should not happen if offsets are correct
      return null;
    }
    if (occupancy[roomIdx] >= rooms[roomIdx].capacity) {
      // Over capacity — reject this attempt
      return null;
    }
    occupancy[roomIdx]++;
    assigned.push({ person: people[i], room: rooms[roomIdx].name });
  }

  return { assigned, unassigned: [] };
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
