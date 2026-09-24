<script lang="ts">
  import { onMount } from 'svelte';
  import { draw, parseBucketInput, type DrawMode } from '~/lib/draw';
  import { BUNDESLIGA_OPTIONS } from '~/lib/bundesliga';

  const BUCKET_KEY = 'random-tools:bucket';
  const MODE_KEY = 'random-tools:mode';
  const HISTORY_KEY = 'random-tools:history';

  type HistoryEntry = { drawn: string; at: number };

  let mounted = $state(false);
  let bucketText = $state('');
  let mode = $state<DrawMode>('without');
  let currentDraw = $state<string | null>(null);
  let history = $state<HistoryEntry[]>([]);
  let shareState = $state<'idle' | 'copied' | 'error'>('idle');
  // Fade-in toggle: 0 → fade out (invisible) → flip to 1 → fade in.
  // We start at 1 so the first draw after mount appears without flashing.
  let fadeKey = $state(0);
  let opacity = $state(1);

  // The parsed bucket is what `draw()` operates on (deduped, trimmed).
  const bucket = $derived(parseBucketInput(bucketText));

  // "Remaining" only makes sense in without-replacement mode: original bucket
  // minus every entry in history. With-replacement mode always shows the
  // full bucket count.
  const remaining = $derived.by(() => {
    if (mode === 'with') return bucket.length;
    const drawnSet = new Set(history.map((h) => h.drawn));
    return bucket.filter((item) => !drawnSet.has(item)).length;
  });

  function setMode(next: DrawMode): void {
    mode = next;
  }

  function runDraw(): void {
    const items =
      mode === 'with'
        ? bucket
        : bucket.filter(
            (item) => !history.some((h) => h.drawn === item),
          );

    if (items.length === 0) {
      // Nothing to draw from — don't crash, don't update the result.
      return;
    }

    const result = draw(items, { withReplacement: mode === 'with' });
    const drawn = String(result.drawn);

    // Fade out the current result, swap, then fade in.
    opacity = 0;
    // schedule the swap + fade-in on the next tick so the opacity:0 frame
    // actually paints first.
    setTimeout(() => {
      currentDraw = drawn;
      history = [{ drawn, at: Date.now() }, ...history].slice(0, 10);
      fadeKey++;
      // tiny rAF-equivalent: nudge opacity up after the DOM has had a beat
      // to apply opacity:0 to the new value.
      setTimeout(() => {
        opacity = 1;
      }, 20);
    }, 200);
  }

  function clearHistory(): void {
    history = [];
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(HISTORY_KEY);
      } catch {
        // localStorage may be blocked; ignore.
      }
    }
  }

  function resetBucket(): void {
    // "Reset bucket" — pull the saved ORIGINAL bucket text back out of
    // localStorage, drop the in-session draws from `history`.
    if (typeof window !== 'undefined') {
      try {
        const saved = window.localStorage.getItem(BUCKET_KEY);
        if (saved !== null) bucketText = saved;
      } catch {
        // ignore
      }
    }
    history = [];
    currentDraw = null;
    opacity = 1;
  }

  function prefillBundesliga(): void {
    // Replace the textarea contents with the current 1. Bundesliga clubs
    // and clear history (the old draws are unrelated to the new contents).
    // The textarea stays editable — the user can add/remove clubs freely.
    // Mode is preserved.
    bucketText = BUNDESLIGA_OPTIONS;
    history = [];
  }

  function formatTime(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  }

  /**
   * URL-hash payload. base64url over UTF-8 so non-ASCII options
   * (umlauts, accents, emoji) round-trip safely. Same pattern as
   * RoomRandomizer — copy, do not share.
   */
  function encodePayload(payload: {
    bucket: string;
    mode: DrawMode;
  }): string {
    const json = JSON.stringify(payload);
    const bytes = new TextEncoder().encode(json);
    let bin = '';
    for (let i = 0; i < bytes.length; i++)
      bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin);
    return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodePayload(
    encoded: string,
  ): { bucket: string; mode: DrawMode } | null {
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
        'bucket' in parsed &&
        'mode' in parsed &&
        typeof (parsed as { bucket: unknown }).bucket === 'string' &&
        ((parsed as { mode: unknown }).mode === 'with' ||
          (parsed as { mode: unknown }).mode === 'without')
      ) {
        const p = parsed as { bucket: string; mode: DrawMode };
        return { bucket: p.bucket, mode: p.mode };
      }
      return null;
    } catch {
      return null;
    }
  }

  async function share(): Promise<void> {
    if (typeof window === 'undefined') return;
    const encoded = encodePayload({ bucket: bucketText, mode });
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
        bucketText = decoded.bucket;
        mode = decoded.mode;
        return;
      }
    }

    // 2. Fall back to localStorage.
    try {
      const b = window.localStorage.getItem(BUCKET_KEY);
      const m = window.localStorage.getItem(MODE_KEY);
      const h = window.localStorage.getItem(HISTORY_KEY);
      if (b !== null) bucketText = b;
      if (m === 'with' || m === 'without') mode = m;
      if (h !== null) {
        const parsed = JSON.parse(h) as unknown;
        if (Array.isArray(parsed)) {
          history = parsed
            .filter(
              (e): e is HistoryEntry =>
                !!e &&
                typeof e === 'object' &&
                typeof (e as { drawn?: unknown }).drawn === 'string' &&
                typeof (e as { at?: unknown }).at === 'number',
            )
            .slice(0, 10);
        }
      }
    } catch {
      // localStorage may be blocked (private mode, etc.). Skip silently.
    }
  });

  // Persist on every state change. v1: simple, no debounce.
  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(BUCKET_KEY, bucketText);
    } catch {
      // ignore
    }
  });

  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(MODE_KEY, mode);
    } catch {
      // ignore
    }
  });

  $effect(() => {
    if (!mounted) return;
    try {
      window.localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
    } catch {
      // ignore
    }
  });
</script>

<div class="space-y-6">
  <label class="block">
    <span class="text-fg mb-2 flex items-center justify-between gap-3 text-sm font-medium">
      <span>
        Bucket
        <span class="text-muted font-normal">(one option per line)</span>
      </span>
      <button
        type="button"
        onclick={prefillBundesliga}
        class="border-border text-fg hover:border-accent rounded-lg border px-3 py-1.5 text-sm font-medium"
        aria-label="Prefill bucket with current 1. Bundesliga clubs"
      >
        Prefill Bundesliga
      </button>
    </span>
    <textarea
      bind:value={bucketText}
      rows="8"
      placeholder={"Alice&#10;Bob&#10;Carol"}
      class="text-base border-border bg-bg text-fg placeholder:text-muted w-full rounded-lg border px-3 py-2 focus:border-accent focus:outline-none"
      style="font-size: 16px"
      aria-label="Bucket options, one per line"
    ></textarea>
  </label>

  <div>
    <span class="text-fg mb-2 block text-sm font-medium">Mode</span>
    <div
      role="group"
      aria-label="Draw mode"
      class="inline-flex flex-wrap gap-2"
    >
      <button
        type="button"
        onclick={() => setMode('without')}
        class="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors {mode ===
        'without'
          ? 'bg-accent text-accent-fg'
          : 'border-border text-muted border bg-transparent'}"
        aria-pressed={mode === 'without'}
      >
        Without replacement
      </button>
      <button
        type="button"
        onclick={() => setMode('with')}
        class="min-h-[44px] rounded-lg px-4 py-2 text-sm font-medium transition-colors {mode ===
        'with'
          ? 'bg-accent text-accent-fg'
          : 'border-border text-muted border bg-transparent'}"
        aria-pressed={mode === 'with'}
      >
        With replacement
      </button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-3">
    <button
      type="button"
      onclick={runDraw}
      disabled={bucket.length === 0 ||
        (mode === 'without' && remaining === 0)}
      class="bg-accent text-accent-fg hover:opacity-90 disabled:text-muted disabled:bg-border inline-flex min-h-[56px] items-center rounded-xl px-6 py-4 text-lg font-semibold disabled:cursor-not-allowed"
    >
      Draw
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
  </div>

  {#if currentDraw !== null}
    {#key fadeKey}
      <section
        aria-label="Current draw"
        class="border-border rounded-xl border p-6 transition-opacity duration-200 ease-out"
        style="opacity: {opacity}"
      >
        <p class="text-muted text-xs font-semibold uppercase tracking-wide">
          Drawn
        </p>
        <p class="text-fg mt-2 text-3xl font-semibold break-words">
          {currentDraw}
        </p>
        <p class="text-muted mt-3 text-sm">
          {#if mode === 'with'}
            Bucket has {remaining} item{remaining === 1 ? '' : 's'}.
          {:else}
            Bucket has {remaining} remaining.
          {/if}
        </p>
      </section>
    {/key}
  {:else if bucket.length === 0}
    <p class="text-muted text-sm">Add some options to your bucket to begin.</p>
  {/if}

  {#if history.length > 0}
    <section aria-label="Draw history" class="space-y-2">
      <h2 class="text-accent-2 text-sm font-semibold uppercase tracking-wide">
        <span aria-hidden="true">$ </span>Recent draws
      </h2>
      <ul class="space-y-1">
        {#each history as entry (entry.at + ':' + entry.drawn)}
          <li class="text-muted text-sm">
            <span class="text-fg">{entry.drawn}</span>
            <span class="px-1">—</span>
            <span>{formatTime(entry.at)}</span>
          </li>
        {/each}
      </ul>

      <div class="flex flex-wrap gap-3 pt-2">
        <button
          type="button"
          onclick={clearHistory}
          class="text-muted hover:text-fg inline-flex min-h-[44px] items-center text-sm font-medium"
        >
          Clear history
        </button>
        <button
          type="button"
          onclick={resetBucket}
          class="border-border text-fg hover:border-accent inline-flex min-h-[44px] items-center rounded-lg border bg-transparent px-4 py-2 text-sm font-medium"
        >
          Reset bucket
        </button>
      </div>
    </section>
  {/if}
</div>