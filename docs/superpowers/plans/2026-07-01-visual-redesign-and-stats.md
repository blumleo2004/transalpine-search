# Visual Redesign, Extended Stats & Professionalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the visual system (logo, layered dark theme, bento-grid stats hero, reduced emoji), add two new stats (Ja/Nein/Aber-counter, vocabulary richness), and professionalize the project (favicon, OG/meta tags, loading/error states, README, "About" page).

**Architecture:** Single Next.js 14 App Router project, no test framework present. Frontend is one large client component (`src/app/page.tsx` + `page.module.css`); backend is Next.js route handlers hitting Neon Postgres via `src/lib/db.ts`. This plan follows the existing single-file-per-concern convention rather than introducing new structure. Because there is no test runner in this repo, "verification" steps use `npm run build`, direct `curl`/`node` DB checks, and manual browser checks instead of unit tests — noted per-task where it deviates from the skill's default TDD steps.

**Tech Stack:** Next.js 14 (App Router), TypeScript, `pg` (raw SQL), CSS Modules, no test framework.

## Global Constraints

- Full context and history: `docs/superpowers/specs/2026-07-01-visual-redesign-and-stats-design.md` — read it before starting.
- Emoji policy: remove emoji-as-bullet-prefix from section titles; replace flag emoji with SVG flags everywhere; keep sparse, topic-fitting emoji in word-cloud labels only.
- "Patriotismus-König" and "Flüssiges Gold" must NOT appear in the hero KPI row. They stay as data, renamed to "Eigenland-Erwähnungen" and "Meistgenanntes Getränk", relocated into existing sections.
- New hero KPI row order: Episoden, Audio-Stunden, Redeanteil-Sieger, Wortschatz-Sieger.
- No new DB tables. New stats computed from `transcript_chunks` inside the existing `computeStats()` in `src/app/api/stats/route.ts`, cached in the existing `app_cache` table.
- No light-mode toggle, no dynamic OG image generation, no search architecture changes — out of scope per spec.

---

### Task 1: Design tokens — new CSS variables

**Files:**
- Modify: `src/app/globals.css:1-30` (the `:root` block)

**Interfaces:**
- Produces: CSS custom properties `--accent-orange`, `--accent-orange-rgb`, `--surface-elevated`, `--surface-elevated-2`, consumed by Tasks 5 and 6.

- [ ] **Step 1: Add the new variables**

In `src/app/globals.css`, inside the existing `:root { ... }` block, right after the `--accent-red: #d94e4e;` line, add:

```css
  --accent-orange: #e2673a;
  --accent-orange-rgb: 226, 103, 58;

  --surface-elevated: #1c1f22;
  --surface-elevated-2: #26292d;
```

- [ ] **Step 2: Verify the file is valid CSS**

Run: `cd /c/Users/bluml/transalpine-search && npm run build`
Expected: build succeeds (no CSS syntax errors reported by Next.js).

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "style: add orange accent and elevated-surface CSS tokens"
```

---

### Task 2: Logo, favicon, and flag icons

**Files:**
- Create: `src/app/icon.svg`
- Create: `src/components/Logo.tsx`
- Create: `src/components/CountryFlag.tsx`

**Interfaces:**
- Produces: `<Logo size={number} />` component (default export), `<CountryFlag country="CH" | "AT" | "DE" size={number} />` component (default export). Consumed by Task 5 (header) and Task 6 (host flags).

- [ ] **Step 1: Create the favicon SVG**

Next.js App Router auto-detects `src/app/icon.svg` as the site favicon — no manual `<link>` tag needed.

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0d0f11"/>
  <polygon points="32,14 44,46 20,46" fill="#f5f6f8"/>
  <polygon points="22,28 30,46 14,46" fill="#f5f6f8" opacity="0.75"/>
  <polygon points="42,28 50,46 34,46" fill="#f5f6f8" opacity="0.75"/>
  <polygon points="32,10 35,19 32,16.5 29,19" fill="#e2673a"/>
</svg>
```

- [ ] **Step 2: Create the reusable `Logo` component**

`src/components/Logo.tsx`:

```tsx
export default function Logo({ size = 34 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <polygon points="32,10 46,50 18,50" fill="#f5f6f0" />
      <polygon points="20,26 30,50 10,50" fill="#f5f6f0" opacity="0.75" />
      <polygon points="44,26 54,50 34,50" fill="#f5f6f0" opacity="0.75" />
      <polygon points="32,8 36,18 32,15 28,18" fill="#e2673a" />
    </svg>
  );
}
```

- [ ] **Step 3: Create the `CountryFlag` component**

Correctly proportioned flags (fixes the earlier mockup bug where the Swiss flag used Denmark's off-center cross layout instead of a centered one).

`src/components/CountryFlag.tsx`:

```tsx
type Country = 'CH' | 'AT' | 'DE';

export default function CountryFlag({ country, size = 18 }: { country: Country; size?: number }) {
  const width = size;
  const height = Math.round(size * (country === 'CH' ? 1 : 11 / 16));

  if (country === 'CH') {
    return (
      <svg width={width} height={width} viewBox="0 0 32 32" aria-label="Schweiz">
        <rect width="32" height="32" rx="3" fill="#d52b1e" />
        <rect x="13" y="6" width="6" height="20" fill="#fff" />
        <rect x="6" y="13" width="20" height="6" fill="#fff" />
      </svg>
    );
  }

  if (country === 'AT') {
    return (
      <svg width={width} height={height} viewBox="0 0 16 11" aria-label="Österreich">
        <rect width="16" height="11" fill="#ED2939" />
        <rect y="3.667" width="16" height="3.667" fill="#fff" />
      </svg>
    );
  }

  return (
    <svg width={width} height={height} viewBox="0 0 16 11" aria-label="Deutschland">
      <rect width="16" height="3.667" y="0" fill="#000" />
      <rect width="16" height="3.667" y="3.667" fill="#DD0000" />
      <rect width="16" height="3.667" y="7.333" fill="#FFCE00" />
    </svg>
  );
}
```

- [ ] **Step 4: Verify build and visually spot-check the favicon**

Run: `npm run build`
Expected: build succeeds. Run `npm run dev`, open `http://localhost:3000/icon.svg` directly in a browser — should render the mountain+star mark.

- [ ] **Step 5: Commit**

```bash
git add src/app/icon.svg src/components/Logo.tsx src/components/CountryFlag.tsx
git commit -m "feat: add logo, favicon, and country flag SVG components"
```

---

### Task 3: Page metadata and Open Graph image

**Files:**
- Modify: `src/app/layout.tsx`
- Create: `public/og-image.svg`

**Interfaces:**
- Consumes: nothing new.
- Produces: nothing consumed by later tasks (leaf task).

- [ ] **Step 1: Read the current layout.tsx**

Run: `cat src/app/layout.tsx` — confirm the current `export const metadata` shape before editing (avoid clobbering existing fields).

- [ ] **Step 2: Create a static Open Graph image**

`public/og-image.svg` (SVG is valid for `og:image` in most modern clients; if the user later wants broader compatibility they can export a PNG manually — noted as a follow-up, not blocking):

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <rect width="1200" height="630" fill="#0d0f11"/>
  <polygon points="600,180 760,480 440,480" fill="#f5f6f0"/>
  <polygon points="470,320 570,480 370,480" fill="#f5f6f0" opacity="0.75"/>
  <polygon points="730,320 830,480 630,480" fill="#f5f6f0" opacity="0.75"/>
  <polygon points="600,140 620,190 600,175 580,190" fill="#e2673a"/>
  <text x="600" y="560" font-family="Arial, sans-serif" font-weight="800" font-size="40" fill="#f5f6f8" text-anchor="middle">Servus. Grüezi. Hallo. — Suchmaschine</text>
</svg>
```

- [ ] **Step 3: Update `metadata` in `src/app/layout.tsx`**

Merge these fields into the existing `export const metadata: Metadata = { ... }` object (add `openGraph` and `description`/`title` if not already present; keep any existing fields):

```ts
export const metadata: Metadata = {
  title: 'Transalpine Suchmaschine',
  description: 'Durchsuche das Archiv von „Servus. Grüezi. Hallo." — semantische Suche über 94.595 Gesprächsabschnitte aus 411 Episoden.',
  openGraph: {
    title: 'Transalpine Suchmaschine',
    description: 'Durchsuche das Archiv von „Servus. Grüezi. Hallo." — semantische Suche über 94.595 Gesprächsabschnitte.',
    images: ['/og-image.svg'],
  },
};
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: build succeeds. Run `npm run dev`, load the homepage, check page `<head>` in browser devtools contains the `og:title`/`og:image` meta tags.

- [ ] **Step 5: Commit**

```bash
git add src/app/layout.tsx public/og-image.svg
git commit -m "feat: add page metadata and Open Graph preview image"
```

---

### Task 4: Backend — Ja/Nein/Aber counter and vocabulary richness

**Files:**
- Modify: `src/app/api/stats/route.ts`

**Interfaces:**
- Consumes: existing `query()` from `@/lib/db`, existing `HOSTS` constant, existing `computeStats()` function.
- Produces: `computeStats()` return object gains two new keys: `yesNoButCounts: { host: string; ja: number; nein: number; aber: number }[]` and `vocabularySizes: { host: string; distinctWords: number }[]`. Consumed by Task 6 (frontend rendering).

- [ ] **Step 1: Add word-boundary-safe FILTER conditions for ja/nein/aber**

`ILIKE '%ja%'` would also match "jahrelang", "Ampelkoalition" (no — but would match "Ja" inside "Etappenja..." type compounds and worse, match "ja" inside unrelated words like "Ajax"). Postgres regex with word boundaries (`\y`) is the correct tool. In `src/app/api/stats/route.ts`, find the `computeStats` function and the `conditions` array (currently built from `KEYWORDS` and `HOST_SIGNATURE_WORDS`). Add a new array right after the `HOSTS` constant near the top of the file:

```ts
const YES_NO_BUT_WORDS = ['ja', 'nein', 'aber'] as const;
```

- [ ] **Step 2: Extend `buildFilterCountsSql` to support regex-based word-boundary conditions**

The existing `buildFilterCountsSql` function only builds `ILIKE` conditions. Modify it to accept an optional `wordBoundary` flag per condition, being careful that placeholder indices are allocated in the same left-to-right order they appear in the generated SQL text (speaker placeholder before the match placeholder in the speaker branch). Replace the function:

```ts
function buildFilterCountsSql(conditions: { alias: string; speaker?: string; word: string; wordBoundary?: boolean }[]) {
  const selects: string[] = [];
  const params: any[] = [];
  let i = 1;
  for (const c of conditions) {
    if (c.speaker) {
      const speakerIdx = i++;
      const matchIdx = i++;
      const matchExpr = c.wordBoundary ? `content ~* $${matchIdx}` : `content ILIKE $${matchIdx}`;
      selects.push(`count(*) FILTER (WHERE speaker = $${speakerIdx} AND ${matchExpr}) AS "${c.alias}"`);
      params.push(c.speaker, c.wordBoundary ? `\\y${c.word}\\y` : `%${c.word}%`);
    } else {
      const matchIdx = i++;
      const matchExpr = c.wordBoundary ? `content ~* $${matchIdx}` : `content ILIKE $${matchIdx}`;
      selects.push(`count(*) FILTER (WHERE ${matchExpr}) AS "${c.alias}"`);
      params.push(c.wordBoundary ? `\\y${c.word}\\y` : `%${c.word}%`);
    }
  }
  return { sql: `SELECT ${selects.join(', ')} FROM transcript_chunks`, params };
}
```

- [ ] **Step 3: Add the yes/no/but conditions into the existing `conditions` array**

In `computeStats()`, find where `conditions` is built (the array passed to `buildFilterCountsSql`). Add, alongside the existing spread entries:

```ts
    ...HOSTS.flatMap((host) =>
      YES_NO_BUT_WORDS.map((w) => ({ alias: `ynb__${host}__${w}`, speaker: host, word: w, wordBoundary: true }))
    ),
```

- [ ] **Step 4: Read the results into a `yesNoButCounts` array**

After the existing `const [countsRow] = await query<Record<string, number>>(sql, params);` line, add:

```ts
  const yesNoButCounts = HOSTS.map((host) => ({
    host,
    ja: Number(countsRow[`ynb__${host}__ja`]) || 0,
    nein: Number(countsRow[`ynb__${host}__nein`]) || 0,
    aber: Number(countsRow[`ynb__${host}__aber`]) || 0,
  }));
```

- [ ] **Step 5: Add the vocabulary-richness query**

This needs its own query (real `GROUP BY`, not a FILTER batch). Add right after the `yesNoButCounts` block:

```ts
  const vocabRows = await query<{ speaker: string; distinct_words: string }>(`
    SELECT speaker, count(DISTINCT word) AS distinct_words
    FROM transcript_chunks,
         unnest(regexp_split_to_array(lower(content), '[^a-zäöüßA-ZÄÖÜ]+')) AS word
    WHERE word <> '' AND speaker = ANY($1)
    GROUP BY speaker
  `, [HOSTS as unknown as string[]]);

  const vocabularySizes = HOSTS.map((host) => ({
    host,
    distinctWords: Number(vocabRows.find((r) => r.speaker === host)?.distinct_words) || 0,
  }));
```

- [ ] **Step 6: Add both to the returned object**

Find the `return { ... }` statement at the end of `computeStats()` and add two new keys:

```ts
    yesNoButCounts,
    vocabularySizes,
```

- [ ] **Step 7: Verify against the live database directly (no test framework — verify with a Node script)**

```bash
cd /c/Users/bluml/transalpine-search
DATABASE_URL='<paste Neon connection string>' node -e "
const { query } = require('./src/lib/db.ts');
" 2>&1 || true
```

Since `src/lib/db.ts` is TypeScript, verify instead by running the dev server and calling the route directly:

```bash
npm run dev &
sleep 3
curl -s -m 30 -b /tmp/cookies.txt "http://localhost:3000/api/stats" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log('yesNoButCounts:', j.yesNoButCounts);
  console.log('vocabularySizes:', j.vocabularySizes);
});"
```

Expected: both arrays present with 3 entries (one per host), non-zero counts. Note: `/tmp/cookies.txt` must contain a valid `app_session` cookie from `/api/login` first (`curl -c /tmp/cookies.txt -X POST http://localhost:3000/api/login -H "Content-Type: application/json" -d '{"password":"<APP_PASSWORD>"}'`), or temporarily unset `APP_PASSWORD` in `.env.local` for local testing.

- [ ] **Step 8: Commit**

```bash
git add src/app/api/stats/route.ts
git commit -m "feat: add ja/nein/aber counter and vocabulary richness stats"
```

---

### Task 5: Frontend — StatsData type and hero bento-grid

**Files:**
- Modify: `src/app/page.tsx` (the `StatsData` interface, and the stats-tab hero JSX block identified earlier around line 1218-1250)
- Modify: `src/app/page.module.css` (`.statsGrid`, `.statCard` and new bento classes)

**Interfaces:**
- Consumes: `Logo` (unused here, header logo is Task 5b below), `CountryFlag` from Task 2; `yesNoButCounts`/`vocabularySizes` from Task 4's API response.
- Produces: nothing new consumed by later tasks except the visual result.

- [ ] **Step 1: Extend the `StatsData` interface**

In `src/app/page.tsx`, find `interface StatsData { ... }` (around line 40) and add:

```ts
  yesNoButCounts?: { host: string; ja: number; nein: number; aber: number }[];
  vocabularySizes?: { host: string; distinctWords: number }[];
```

- [ ] **Step 2: Import the new components**

At the top of `src/app/page.tsx`, add:

```ts
import Logo from '@/components/Logo';
import CountryFlag from '@/components/CountryFlag';
```

- [ ] **Step 3: Replace the hero KPI block**

Find the current hero block:

```tsx
                <div className={styles.statsGrid}>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber}>{stats.totalEpisodes}</div>
                    <div className={styles.statLabel}>Episoden indiziert</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber} style={{ fontSize: '1.5rem' }}>{patriotismKing.value}</div>
                    <div className={styles.statLabel}>Patriotismus-König (Eigenland-Nennungen)</div>
                    <div className={styles.statSubtext} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{patriotismKing.subtext}</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber}>{stats.totalDurationHours > 0 ? `${stats.totalDurationHours}h` : '~150h'}</div>
                    <div className={styles.statLabel}>Audiomaterial</div>
                  </div>
                  <div className={styles.statCard}>
                    <div className={styles.statNumber} style={{ fontSize: '1.8rem' }}>{favDrink.value}</div>
                    <div className={styles.statLabel}>Flüssiges Gold (Getränk)</div>
                    <div className={styles.statSubtext} style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '4px' }}>{favDrink.subtext}</div>
                  </div>
                </div>
```

Replace it with (this computes the speaker-share leader and vocabulary leader inline, and drops `patriotismKing`/`favDrink` from the hero — they get reused in Task 6 further down):

```tsx
                <div className={styles.bentoHero}>
                  <div className={styles.bentoFeature}>
                    <div className={styles.bentoFeatureLabel}>Archiv-Umfang</div>
                    <div className={styles.bentoFeatureNumber}>{stats.totalChunks.toLocaleString('de-DE')}</div>
                    <div className={styles.bentoFeatureSub}>Gesprächsfetzen aus {stats.totalEpisodes} Episoden</div>
                    <div className={styles.bentoFeatureFooter}>
                      <div>
                        <div className={styles.bentoFooterNumber}>{stats.totalDurationHours}h</div>
                        <div className={styles.bentoFooterLabel}>Audio</div>
                      </div>
                    </div>
                  </div>

                  <div className={styles.bentoTile}>
                    <div className={styles.bentoTileNumber}>{stats.totalEpisodes}</div>
                    <div className={styles.bentoTileLabel}>Episoden</div>
                  </div>

                  <div className={styles.bentoTile}>
                    <div className={styles.bentoTileNumber}>{stats.totalDurationHours}h</div>
                    <div className={styles.bentoTileLabel}>Audiomaterial</div>
                  </div>

                  {(() => {
                    const shares = Object.entries(stats.speakerDistribution || {}).filter(([n]) => n !== 'Gäste & Sonstige');
                    const total = shares.reduce((s, [, v]) => s + v, 0) || 1;
                    const leader = shares.sort((a, b) => b[1] - a[1])[0];
                    const flagFor = (name: string): 'CH' | 'AT' | 'DE' =>
                      name === 'Matthias Daum' ? 'CH' : name === 'Florian Gasser' ? 'AT' : 'DE';
                    if (!leader) return null;
                    return (
                      <div className={styles.bentoTile}>
                        <div className={styles.bentoTileHeader}>
                          <CountryFlag country={flagFor(leader[0])} size={16} />
                          <div className={styles.bentoTileNumber} style={{ fontSize: '1.1rem' }}>{leader[0].split(' ')[0]}</div>
                        </div>
                        <div className={styles.bentoTileLabel}>Redeanteil-Sieger ({Math.round((leader[1] / total) * 100)}%)</div>
                      </div>
                    );
                  })()}

                  {(() => {
                    const vocab = (stats.vocabularySizes || []).slice().sort((a, b) => b.distinctWords - a.distinctWords)[0];
                    if (!vocab) return null;
                    return (
                      <div className={styles.bentoTile}>
                        <div className={styles.bentoTileNumber} style={{ fontSize: '1.1rem' }}>{vocab.host.split(' ')[0]}</div>
                        <div className={styles.bentoTileLabel}>Wortschatz-Sieger ({vocab.distinctWords.toLocaleString('de-DE')} Wörter)</div>
                      </div>
                    );
                  })()}
                </div>
```

- [ ] **Step 4: Add the header logo**

Find the site header markup near the top of the returned JSX (search for the existing app title/header element — it's the element containing the app name, likely near `<header` or a top nav div). Add `<Logo size={30} />` immediately before the text title, wrapped so they sit side by side:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
  <Logo size={30} />
  {/* existing title text stays here */}
</div>
```

(Exact insertion point depends on current header JSX — locate the header by running `grep -n "Transalpine\|Servus" src/app/page.tsx | head -5` and wrap the matched title element.)

- [ ] **Step 5: Add the bento CSS classes**

In `src/app/page.module.css`, right after the existing `.statsGrid { ... }` block, add:

```css
.bentoHero {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1fr;
  grid-template-rows: auto auto;
  gap: 12px;
  margin-bottom: 40px;
  position: relative;
}

.bentoFeature {
  grid-row: span 2;
  background: linear-gradient(155deg, var(--surface-elevated) 0%, #181b1e 100%);
  border: 1px solid rgba(var(--accent-orange-rgb), 0.25);
  border-radius: 14px;
  padding: 24px;
  box-shadow: 0 0 40px -12px rgba(var(--accent-orange-rgb), 0.15);
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.bentoFeatureLabel {
  font-family: var(--font-sans);
  font-size: 0.68rem;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: var(--accent-orange);
  font-weight: 700;
  margin-bottom: 10px;
}

.bentoFeatureNumber {
  font-family: var(--font-sans);
  font-weight: 800;
  font-size: 2.6rem;
  color: var(--text-primary);
  line-height: 1;
}

.bentoFeatureSub {
  color: var(--text-secondary);
  font-size: 0.8rem;
  margin-top: 8px;
}

.bentoFeatureFooter {
  display: flex;
  gap: 16px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
}

.bentoFooterNumber {
  font-family: var(--font-sans);
  font-weight: 700;
  color: var(--text-primary);
  font-size: 1rem;
}

.bentoFooterLabel {
  color: var(--text-muted);
  font-size: 0.68rem;
}

.bentoTile {
  background: var(--surface-elevated);
  border-radius: 14px;
  padding: 18px;
  transition: var(--transition-smooth);
}

.bentoTile:hover {
  background: var(--surface-elevated-2);
}

.bentoTileHeader {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 4px;
}

.bentoTileNumber {
  font-family: var(--font-sans);
  font-weight: 800;
  color: var(--text-primary);
  font-size: 1.6rem;
}

.bentoTileLabel {
  color: var(--text-secondary);
  font-size: 0.75rem;
  margin-top: 4px;
}

@media (max-width: 768px) {
  .bentoHero {
    grid-template-columns: 1fr 1fr;
  }
  .bentoFeature {
    grid-column: span 2;
    grid-row: auto;
  }
}
```

- [ ] **Step 6: Build and visually verify**

Run: `npm run build`
Expected: succeeds. Run `npm run dev`, log in, open the Statistiken tab, confirm the bento hero renders with Episoden/Audio/Redeanteil-Sieger/Wortschatz-Sieger and no "Patriotismus-König"/"Flüssiges Gold" tiles.

- [ ] **Step 7: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "feat: replace stats hero with bento-grid layout"
```

---

### Task 6: Relocate demoted stats, remove emoji section prefixes, add Ja/Nein/Aber section

**Files:**
- Modify: `src/app/page.tsx` (the "Blick über die Grenze" section, the Wortgewitter section, section title elements, and add a new section)
- Modify: `src/app/page.module.css` (section title / accent-bar classes)

**Interfaces:**
- Consumes: `yesNoButCounts` from Task 4, `patriotismKing`/`favDrink` helper values already computed elsewhere in `page.tsx` (grep to confirm their definitions still exist after Task 5's edit — they should, since Task 5 only removed their *rendering*, not their computation).

- [ ] **Step 1: Confirm `patriotismKing` and `favDrink` are still computed**

```bash
grep -n "const patriotismKing\|const favDrink" src/app/page.tsx
```

Expected: both still defined (Task 5 only removed the JSX that displayed them in the hero, not their `useMemo`/computation).

- [ ] **Step 2: Add "Eigenland-Erwähnungen" into the "Blick über die Grenze" card**

Find the `<h3 className={styles.chartTitle}>👀 Blick über die Grenze</h3>` heading. Directly below its descriptive `<p>`, before `<div className={styles.crossBorderGrid}>`, add:

```tsx
                    <div className={styles.inlineStatRow}>
                      <span className={styles.inlineStatLabel}>Eigenland-Erwähnungen (Spitzenreiter):</span>
                      <span className={styles.inlineStatValue}>{patriotismKing.value} — {patriotismKing.subtext}</span>
                    </div>
```

- [ ] **Step 3: Add "Meistgenanntes Getränk" into the Wortgewitter card**

Find `<h3 className={styles.chartTitle}>☁️ Das transalpine Wortgewitter</h3>`. Directly below its descriptive `<p>`, add the same pattern:

```tsx
                    <div className={styles.inlineStatRow}>
                      <span className={styles.inlineStatLabel}>Meistgenanntes Getränk:</span>
                      <span className={styles.inlineStatValue}>{favDrink.value} — {favDrink.subtext}</span>
                    </div>
```

- [ ] **Step 4: Add the `.inlineStatRow` CSS**

In `src/app/page.module.css`, near `.chartTitle`, add:

```css
.inlineStatRow {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 0.85rem;
  margin: -8px 0 18px 0;
  flex-wrap: wrap;
}

.inlineStatLabel {
  color: var(--text-muted);
}

.inlineStatValue {
  color: var(--accent-gold);
  font-weight: 700;
}
```

- [ ] **Step 5: Remove emoji prefixes from all `chartTitle` headings, replace with accent bar**

Find every occurrence of `<h3 className={styles.chartTitle}>` in `src/app/page.tsx` (there are 6: Redeanteil, Episoden nach Jahr, Sprechanteile im Jahresvergleich, Blick über die Grenze, Wortgewitter, Typische Wörter, Transalpine Duelle — confirm count with `grep -c` below). For each, strip the leading emoji character(s) from the text content and wrap the heading like this pattern:

```bash
grep -n "chartTitle}>" src/app/page.tsx
```

For each matched line, e.g. `<h3 className={styles.chartTitle}>🎙️ Redeanteil der Hosts</h3>`, change to:

```tsx
<h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Redeanteil der Hosts</h3>
```

Apply the same transformation (strip emoji, add `<span className={styles.chartTitleBar} />` as first child) to all remaining `chartTitle` headings found by the grep.

- [ ] **Step 6: Add `.chartTitleBar` CSS and update `.chartTitle` to flex layout**

In `src/app/page.module.css`, the existing `.chartTitle` rule already has `display: flex; align-items: center; gap: 8px;` (added in the earlier session's polish pass) — verify with:

```bash
grep -n -A8 "^\.chartTitle {" src/app/page.module.css
```

If `display: flex` is present, just add this new rule after it:

```css
.chartTitleBar {
  display: inline-block;
  width: 3px;
  height: 14px;
  background: var(--accent-orange);
  border-radius: 2px;
  flex-shrink: 0;
}
```

- [ ] **Step 7: Add the new "Ja, Nein & Aber" section**

Find the closing of the "Transalpine Duelle" `chartCard` section (search for `Transalpine Sprach- & Kulturduelle`) and add a new sibling `chartCard` section right after its closing `</div>` (before the final `)}` that closes the `stats.keywordMentions && stats.hostWordCounts &&` conditional block — place it as its own top-level conditional so it doesn't depend on that block):

```tsx
                {stats.yesNoButCounts && stats.yesNoButCounts.length > 0 && (
                  <div className={styles.chartCard} style={{ marginTop: '24px' }}>
                    <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Ja, Nein & Aber</h3>
                    <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: '-8px', marginBottom: '20px', lineHeight: '1.4' }}>
                      Wer stimmt am häufigsten zu, wer widerspricht am meisten, und wer relativiert am liebsten mit einem "aber"?
                    </p>
                    <div className={styles.hostWordsColumns}>
                      {stats.yesNoButCounts.map((row) => {
                        const flag: 'CH' | 'AT' | 'DE' =
                          row.host === 'Matthias Daum' ? 'CH' : row.host === 'Florian Gasser' ? 'AT' : 'DE';
                        const maxVal = Math.max(row.ja, row.nein, row.aber, 1);
                        return (
                          <div key={row.host} className={styles.hostWordsCol}>
                            <div className={styles.hostWordsHeader}>
                              <div className={styles.hostAvatar}><CountryFlag country={flag} size={18} /></div>
                              <div className={styles.hostMeta}>
                                <span className={styles.hostName}>{row.host}</span>
                              </div>
                            </div>
                            <div className={styles.hostWordsList}>
                              {([['Ja', row.ja], ['Nein', row.nein], ['Aber', row.aber]] as [string, number][]).map(([label, count]) => (
                                <div key={label} className={styles.hostWordItem}>
                                  <div className={styles.hostWordTextRow}>
                                    <span className={styles.hostWordLabel}>{label}</span>
                                    <span className={styles.hostWordCount}>{count}x</span>
                                  </div>
                                  <div className={styles.hostWordTrack}>
                                    <div className={styles.hostWordFill} style={{ width: `${(count / maxVal) * 100}%` }} />
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
```

- [ ] **Step 8: Build and visually verify**

Run: `npm run build`
Expected: succeeds. In the dev server, confirm: "Blick über die Grenze" shows the Eigenland-Erwähnungen line, Wortgewitter shows the Getränk line, all section titles use the orange bar instead of emoji, and a new "Ja, Nein & Aber" section appears after the Duelle section with three per-host bar groups.

- [ ] **Step 9: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "feat: relocate demoted stats, remove emoji title prefixes, add ja/nein/aber section"
```

---

### Task 7: Alpine watermark on the hero

**Files:**
- Modify: `src/app/page.tsx` (wrap the `.bentoHero` container)
- Modify: `src/app/page.module.css`

**Interfaces:** none (leaf, purely decorative).

- [ ] **Step 1: Wrap the bento hero in a positioned container with the watermark**

In `src/app/page.tsx`, wrap the `<div className={styles.bentoHero}>...</div>` block (from Task 5) with:

```tsx
                <div className={styles.heroWatermarkWrap}>
                  <svg className={styles.heroWatermark} viewBox="0 0 800 200" preserveAspectRatio="none">
                    <polygon points="0,200 100,60 180,140 260,20 340,110 420,50 500,150 580,70 660,130 740,40 800,90 800,200" fill="currentColor" />
                  </svg>
                  {/* .bentoHero block goes here, unchanged */}
                </div>
```

- [ ] **Step 2: Add the CSS**

```css
.heroWatermarkWrap {
  position: relative;
}

.heroWatermark {
  position: absolute;
  top: -20px;
  left: 0;
  right: 0;
  height: 140px;
  color: var(--text-primary);
  opacity: 0.04;
  pointer-events: none;
  z-index: 0;
}

.bentoHero {
  position: relative;
  z-index: 1;
}
```

(The `position: relative; z-index: 1;` addition merges into the existing `.bentoHero` rule from Task 5 — don't duplicate the selector, add these two lines into that block instead.)

- [ ] **Step 3: Build and visually verify**

Run: `npm run build`. In dev server, confirm a faint mountain-ridge watermark is visible behind the hero without interfering with text readability.

- [ ] **Step 4: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "style: add subtle alpine ridge watermark behind stats hero"
```

---

### Task 8: Loading skeletons and friendlier error messages

**Files:**
- Modify: `src/app/page.tsx` (the `statsLoading` render branch, and the search-results loading/error branches)
- Modify: `src/app/page.module.css`

**Interfaces:** none (leaf).

- [ ] **Step 1: Find the current stats loading branch**

```bash
grep -n "statsLoading ? (" src/app/page.tsx
```

- [ ] **Step 2: Replace the spinner with a skeleton bento grid**

Replace:

```tsx
            {statsLoading ? (
              <div className={styles.loadingContainer}>
                <div className={styles.spinner}></div>
                <p>Statistiken werden geladen...</p>
              </div>
            ) : stats ? (
```

with:

```tsx
            {statsLoading ? (
              <div className={styles.bentoHero}>
                <div className={`${styles.bentoFeature} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
                <div className={`${styles.bentoTile} ${styles.skeleton}`} />
              </div>
            ) : stats ? (
```

- [ ] **Step 3: Add the skeleton shimmer CSS**

```css
.skeleton {
  position: relative;
  overflow: hidden;
  background: var(--surface-elevated);
}

.skeleton::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.06), transparent);
  animation: skeletonShimmer 1.4s ease-in-out infinite;
}

@keyframes skeletonShimmer {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}
```

- [ ] **Step 4: Find and improve the search error state**

```bash
grep -n "database-error\|error.*results\|catch" src/app/page.tsx | grep -i search
```

Locate the branch that renders when a search request fails (look for where the search fetch's `.catch` or error-mode result is rendered — grep for `mode === 'database-error'` or similar). Replace any raw error-text rendering with:

```tsx
              <div className={styles.emptyState}>
                <div className={styles.emptyStateIcon}>⚠</div>
                <h3>Die Suche hat gerade ein Problem</h3>
                <p>Versuch's in ein paar Sekunden nochmal.</p>
              </div>
```

(Exact insertion point depends on the current conditional structure around search results — locate via the grep above and replace only the error-branch JSX, not the empty-results branch.)

- [ ] **Step 5: Build and visually verify**

Run: `npm run build`. In dev server, throttle network (browser devtools) and reload the Statistiken tab to see the skeleton shimmer before data loads.

- [ ] **Step 6: Commit**

```bash
git add src/app/page.tsx src/app/page.module.css
git commit -m "feat: add skeleton loaders and friendlier search error state"
```

---

### Task 9: "Über dieses Projekt" tab

**Files:**
- Modify: `src/app/page.tsx` (tab state/nav and a new tab-content branch)
- Modify: `src/app/page.module.css` (if new classes are needed beyond existing `.chartCard`/typography classes — reuse existing ones first)

**Interfaces:**
- Consumes: the existing tab-switching pattern (`activeTab`, `setActiveTab`) already used for `'search' | 'browse' | 'stats'` — grep to confirm the exact union type name before editing.

- [ ] **Step 1: Find the existing tab type and nav**

```bash
grep -n "activeTab ===\|type.*Tab\|setActiveTab" src/app/page.tsx | head -20
```

- [ ] **Step 2: Add `'about'` to the tab union type and nav bar**

Wherever the tab type is declared (e.g. `useState<'search' | 'browse' | 'stats'>`), add `'about'`. Wherever the nav buttons are rendered (grep found them above), add a fourth button following the exact same pattern as the existing `stats` button, with `onClick={() => setActiveTab('about')}` and label `Über dieses Projekt`.

- [ ] **Step 3: Add the About tab content**

Add a new conditional block alongside the existing `{activeTab === 'stats' && (...)}` block:

```tsx
        {activeTab === 'about' && (
          <section className={styles.statsSection}>
            <div className={styles.chartCard}>
              <h3 className={styles.chartTitle}><span className={styles.chartTitleBar} />Über dieses Projekt</h3>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', lineHeight: '1.7', display: 'flex', flexDirection: 'column', gap: '14px' }}>
                <p>
                  Das hier ist ein privates Hobbyprojekt — keine offizielle Seite von ZEIT ONLINE oder den Podcast-Machern.
                  Es durchsucht das komplette Archiv von <strong>„Servus. Grüezi. Hallo."</strong>, dem transalpinen Politikpodcast
                  von Matthias Daum, Florian Gasser und Lenz Jacobsen.
                </p>
                <p>
                  <strong>Wie es funktioniert:</strong> Jede Folge wird automatisch transkribiert (Deepgram), in Gesprächsabschnitte
                  zerlegt und wer spricht per KI-Heuristik geschätzt. Für die Sinnsuche wird jeder Abschnitt in einen Vektor
                  (OpenAI-Embedding) umgewandelt; deine Suchanfrage wird genauso umgewandelt und die ähnlichsten Abschnitte
                  werden gefunden — daher funktioniert die Suche auch, wenn du nicht die exakten Wörter aus der Folge triffst.
                </p>
                <p>
                  <strong>Ein paar ehrliche Einschränkungen:</strong> Die automatische Sprechererkennung ist nicht perfekt —
                  gelegentlich wird ein Satz dem falschen Host zugeordnet, besonders bei schnellen Wortwechseln. Datumsangaben
                  bei älteren Folgen beruhen teils auf Bestmatch-Vergleichen mit Artikeltiteln und können leicht daneben liegen.
                  Die Statistiken auf der Stats-Seite sind zum Spaß gedacht, nicht als wissenschaftliche Auswertung.
                </p>
              </div>
            </div>
          </section>
        )}
```

- [ ] **Step 4: Build and visually verify**

Run: `npm run build`. In dev server, click the new "Über dieses Projekt" tab and confirm the text renders readably.

- [ ] **Step 5: Commit**

```bash
git add src/app/page.tsx
git commit -m "feat: add About tab with plain-language project explanation and disclaimers"
```

---

### Task 10: README.md

**Files:**
- Create: `README.md`

**Interfaces:** none (leaf, documentation only).

- [ ] **Step 1: Write the README**

```markdown
# Transalpine Suchmaschine

Durchsuchbares Archiv des Podcasts **„Servus. Grüezi. Hallo."** — 411 Episoden, 94.595 Gesprächsabschnitte, semantisch durchsuchbar.

Privates Hobbyprojekt, kein offizielles Angebot der Podcast-Macher. Mehr dazu im "Über dieses Projekt"-Tab der App.

## Tech Stack

- Next.js 14 (App Router) + TypeScript
- [Neon](https://neon.tech) (Serverless Postgres + pgvector), Zugriff via `pg`
- OpenAI `text-embedding-3-small` (256 Dimensionen) für semantische Suche
- Deepgram für Transkription neuer Folgen
- Deployment: Vercel

## Setup

```bash
npm install
cp .env.example .env.local  # falls vorhanden, sonst manuell anlegen — siehe unten
npm run dev
```

Benötigte Umgebungsvariablen in `.env.local`:

```
DATABASE_URL=postgresql://...        # Neon connection string
OPENAI_API_KEY=sk-...
DEEPGRAM_API_KEY=...                 # nur für npm run ingest
RSS_FEED_URL=https://...
APP_PASSWORD=...                     # Zugriffsschutz der App
ADMIN_PASSWORD=...                   # Schutz für /api/admin/stats
```

## Datenbank neu aufsetzen

Vollständiges Schema in [`db/schema.sql`](db/schema.sql).

## Neue Episoden einlesen

```bash
npm run ingest -- --pre-scan   # Dry-Run, zeigt was fehlt
npm run ingest                 # tatsächliche Ingestion
```

## Mehr Details

Technische Hintergründe, Migrationsgeschichte und Architekturentscheidungen: [`CLAUDE.md`](CLAUDE.md).
```

- [ ] **Step 2: Verify links resolve**

```bash
test -f db/schema.sql && test -f CLAUDE.md && echo "OK, both linked files exist"
```

Expected output: `OK, both linked files exist`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: add README.md"
```

---

### Task 11: Final build, deploy, and end-to-end verification

**Files:** none created/modified — verification only.

- [ ] **Step 1: Full local build**

```bash
cd /c/Users/bluml/transalpine-search
npm run build
```

Expected: `✓ Compiled successfully` and `✓ Generating static pages`.

- [ ] **Step 2: Push to deploy**

```bash
git push origin main
```

- [ ] **Step 3: Wait for Vercel deployment**

```bash
until npx vercel ls 2>&1 | grep -qE "● (Ready|Error).*Production"; do sleep 8; done
npx vercel ls 2>&1 | head -8
```

Expected: latest deployment shows `● Ready`.

- [ ] **Step 4: Verify the new stats fields on production**

```bash
curl -s -m 30 -b /tmp/cookies.txt "https://transalpine-search.vercel.app/api/stats" | node -e "
let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{
  const j = JSON.parse(d);
  console.log('has yesNoButCounts:', Array.isArray(j.yesNoButCounts) && j.yesNoButCounts.length === 3);
  console.log('has vocabularySizes:', Array.isArray(j.vocabularySizes) && j.vocabularySizes.length === 3);
});"
```

(Reuse the `app_session` cookie from earlier in this session, or log in again with `curl -c /tmp/cookies.txt -X POST https://transalpine-search.vercel.app/api/login -H "Content-Type: application/json" -d '{"password":"<APP_PASSWORD>"}'`.)

Expected: both lines print `true`.

- [ ] **Step 5: Visual check**

Open `https://transalpine-search.vercel.app` in a browser, log in, check: header shows the new logo, Statistiken tab shows the bento hero (no Patriotismus-König/Flüssiges Gold tiles in the hero row), the new "Ja, Nein & Aber" section renders, the new "Über dieses Projekt" tab is reachable and readable, and the browser tab shows the new favicon.

- [ ] **Step 6: Update CLAUDE.md status section**

Add a line to the `## Status` section of `CLAUDE.md` noting the redesign is live, then commit:

```bash
git add CLAUDE.md
git commit -m "docs: note visual redesign and new stats in status" --allow-empty
git push origin main
```
