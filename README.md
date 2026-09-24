# random-tools

Two tiny web tools, deployed to GitHub Pages:

- **`/`** — landing page with two cards
- **`/room-randomizer/`** — paste people + rooms (with optional capacities), get a random assignment
- **`/draw/`** — bucket of options, draw one out (with or without replacement)

100% client-side. No backend, no tracking, no network calls after page load. State persists in `localStorage`; shareable state encoded in URL hash.

## Stack

Astro 7 (static) + Svelte 5 islands + Tailwind CSS v4. Pinned versions in `package.json`.

## Develop

```bash
npm install
npm run dev   # http://localhost:4321/random-tools/
```

## Deploy

Push to `main`. GitHub Actions builds and deploys to GitHub Pages automatically. Live URL: `https://mmc-de.github.io/random-tools/`.
