# Handoff: Cafe Kadhem — Pop-up Cafe Series Website

## Overview

Cafe Kadhem is a roving pop-up bakery + cafe series (NYC-based, est. 2025). Each pop-up is a numbered event ("POP-UP NO. 014") with its own poster, location, ticketed RSVP, and a rotating menu that travels with the night. The site exists to:

1. Sell the next event front-and-center (poster, RSVP, what to expect)
2. Show the current pop-up's menu
3. List upcoming events on a calendar
4. Tell the founder's story
5. (Future) link out to an archive of past events

The visual direction is **bold, vintage, retro** — inspired by Youssef Chahine-era Egyptian cinema posters, Beirut beach culture, and Arabic letterpress circulars. Bilingual English/Arabic throughout (decorative + functional).

## About the Design Files

The files in this bundle (`index.html`, `components/*.jsx`, `styles/*.css`, `vendor/image-slot.js`) are **design references created in HTML**. They are interactive prototypes showing the intended look, layout, copy, and behavior — **not production code to copy directly**.

Your task is to **recreate these designs in the target codebase's existing environment** (whatever framework, component library, and patterns it already uses) — or, if no codebase exists yet, choose the best framework for the project (Next.js, Astro, SvelteKit, etc.) and implement there. The JSX in this bundle uses inline styles and hand-rolled markup because that's expedient for design exploration; you should map components to whatever the target codebase prefers (CSS modules, Tailwind, styled-components, design-system primitives, etc.).

The React + Babel-in-browser setup here is a prototype runtime only — replace it.

## Fidelity

**High-fidelity.** Final colors, typography, spacing, copy, and interactions are intentional. Recreate pixel-perfectly. The exact hex codes, font choices, and font sizes in the design tokens section below are the ones to ship.

The one exception: imagery. The site uses `<image-slot>` placeholders the user will fill in with their own poster + portrait photos. Treat those as `<img>` slots in your build with the same aspect ratios and overlay chrome.

---

## Screens / Views

The single landing page has six stacked sections plus a sticky audio toggle. Top-to-bottom:

### 1. Top Strip (announcement bar)

- **Position**: Topmost element. Full width.
- **Background**: `var(--cream)` (`#F4ECD8`).
- **Border**: `2px solid var(--ink)` (`#0D0D0F`) on the bottom.
- **Padding**: `10px 28px` desktop, `8px 16px` mobile.
- **Layout**: Flex, space-between, baseline-aligned.
- **Left**: `✦ POP-UP CAFE SERIES · NEW YORK · EST. 2025` — JetBrains Mono, 10px, letter-spacing 0.16em.
- **Right** (hidden on mobile): a date/weather/greeting line, e.g. `06 / 16 / TUE · 78°F · صباح الخير` (mixes English mono with Arabic Reem Kufi).

### 2. Top Nav

- **Position**: Below top strip. Full width. Sticky is fine but currently static.
- **Padding**: `20px 28px` desktop, `12px 16px` mobile.
- **Border**: `2px solid var(--ink)` bottom.
- **Layout**: Flex, three groups (logo · links · CTA).
- **Logo (left)**: registered-mark icon (a stylized SVG, see `RegMark` in `components/shared.jsx`) + `KadhemLockup` (Cafe Kadhem English serif + كافيه كاظم Arabic, scaled 0.6).
- **Links (center)**: 4 links each rendered as `EN / ar` pair. English in JetBrains Mono 11px tracked, Arabic in **Rakkas** 18px right-to-left. Slash separator at 50% opacity.
  - `CALENDAR / التقويم` → `#calendar`
  - `MENU / القائمة` → `#menu`
  - `STORY / القصة` → `#story`
  - `ARCHIVE / الأرشيف` → `#archive`
- **CTA (right)**: "Save a Spot →" primary button (cobalt fill, cream text). Opens RSVP modal for `NEXT_EVENT`.
- **Mobile**: links + CTA hidden; show a hamburger button (3 stacked 2px-tall bars in a 40×40 box with 2px ink border). Tapping toggles a drawer below the nav with the same `EN / ar` pairs, each as a row with English left-aligned and Arabic right-aligned, dividers between.

### 3. Hero — Next Event

- **Position**: Below nav. Full width.
- **Padding**: `28px 28px 32px` desktop, `16px` mobile.
- **Border**: `2px solid var(--ink)` bottom.

**3a. Strap line above the hero card** (flex, space-between):
- Left: `✦ NEXT POP-UP · NO. 014 · TUE 06.16.26` — Mono 11px, color cobalt.
- Right (desktop only): "Hi, hello — we throw pop-ups. Here's the next one." — Bodoni Moda italic 16px.

**3b. Hero card** — a 2-column grid `1.1fr 1fr`, wrapped in a 3px ink border. Internal divider is also 3px ink. Stacks to 1 column on mobile.

**Left column — Poster slot (4:3) + caption**:
- The poster is a `<image-slot>` with `aspect-ratio: 4/3` filling its container. Background while empty: cobalt. The user will drop in a 1200×900 image.
- Four overlay chrome elements absolutely positioned over the poster:
  - **Top-left**: "FOLIO 014" — mono 10px on ink fill with cream text, 2px cream border. Padding 6px 10px.
  - **Top-right**: Arabic word for the event (e.g. الكأس) in **Rakkas** 64px, color sun (`#FF8E2C`), with a 2px ink text-shadow offset (`2px 2px 0 var(--ink)`).
  - **Bottom-left**: Date stamp — "TUE 06.16" in Bodoni Moda 900 28px on a black box with 2px cream border + time line "6PM TILL LATE" in mono 9px below.
  - **Bottom-right**: A circular price seal — 88×88, 2px cream border, cobalt translucent fill (`rgba(30,43,208,0.85)`), rotated -8deg. Stack inside: "NO. 014" (mono 8px), "$26" (Bodoni 22px), "SEAT" (mono 7px).
- Below the poster: a thin caption strip — ink fill, cream text, mono 10px, "POSTER · POP-UP NO. 014" left, location uppercased right.

**Right column — Title + tagline + details + RSVP** (flex column, gap 18px, padding 28px):
- **H1** Title (Bodoni Moda 900, clamp(44px, 4.6vw, 72px), line-height 0.85, letter-spacing -0.01em). Title can have an embedded newline (e.g. "WORLD CUP\nWATCH PARTY" — render that as two lines).
- **Tagline** Bodoni italic 18px line-height 1.35, color cobalt.
- **Details strip** — 2-col grid with When / Where, separated by 2px ink top + bottom borders. WHEN: day + date in Bodoni 800 18px, time in mono 10px. WHERE: location in Inter 600 14px.
- **Bullets** — Inter 13.5px, line-height 1.55, standard `<ul>` with default disc markers. 3–4 lines. e.g. "Iraq v Norway · 6pm kickoff", "Pistachio buns out the oven all night".
- **InlineRSVP** — see Components → InlineRSVP.
- **Bottom dashed strip** (margin-top auto, 1px dashed ink): "CK-014" left, "RSVP / حجز" right. Mono 10px, 0.6 opacity.

### 4. Marquee

- **Background**: ink (`#0D0D0F`), text cream.
- **Height**: ~52px.
- **Behavior**: Infinite horizontal scroll. Items cycle. Mix of English and Arabic phrases:
  `FRESH BAKES TUESDAYS`, `كافيه كاظم`, `KNAFEH CROISSANTS RETURN`, `صحتين`, `EAST 3RD ST`, `بالهنا والشفا`, `PISTACHIO BUNS HOT AT 9AM`.
- **Separator**: a small ✦ between items.
- Implementation: see `Marquee` in `components/shared.jsx` — uses a CSS keyframe + duplicated track. ~30s loop. Pauses on hover (optional).

### 5. Current Menu

- **Background**: `var(--paper)` (`#EFE6CF`, slightly cooler than cream).
- **Padding**: 60px 28px.
- **Border**: 2px ink bottom.
- **Layout**: Header row (flex, space-between, end-aligned) above a 3-col grid.

**Header**:
- Eyebrow: "✦ POP-UP NO. 014 · WORLD CUP WATCH PARTY" — mono 11px cobalt.
- H2 + Arabic display lockup, baseline-aligned with 18px gap:
  - `CURRENT MENU.` — Bodoni 900, clamp(56px, 7vw, 96px), line-height 0.85.
  - `القائمة` — Rakkas 72px, cobalt, RTL, line-height 0.9.
- Subhead: Bodoni italic 17px, max 540px wide: "The menu rotates with the night. This one travels with the watch party — small, snackable, easy to eat one-handed."
- Right side: small mono block — "SERVED TUE 06.16.26" + location uppercased.

**Menu grid** — `repeat(3, 1fr)` desktop, `1fr` mobile. Outer 2px ink border; each cell has 2px ink right + bottom border (creates a single-line divider grid). Cells alternate `cream` / `paper` background by index.

Each cell (min-height 200px desktop, auto on mobile):
- Top row: mono 9px label `01 / PASTRY` left, Arabic display word right (Rakkas 26px cobalt, RTL).
- Item name: Bodoni 800 26px UPPERCASE.
- Description: Inter 13px line-height 1.5.
- Bottom strip (1px dashed ink top): mono divider dots left, Bodoni 800 22px price right.
- **Mobile compresses**: padding 14px 16px, item name 20px, description 12px.

### 6. Calendar — Upcoming

- **Padding**: 60px 28px.
- **Border**: 2px ink bottom.
- **Header** (same pattern as Menu): eyebrow "WHAT'S COMING UP" mono cobalt; H2 lockup `THE CALENDAR. / التقويم`; right side: link `See full calendar →` styled as secondary button.
- **List**: 2px ink border around a stack of `CalendarRow`s.

**Each CalendarRow** (alternates `cream` / `paper` bg, 2px ink divider between):
- Desktop grid: `70px 110px 1fr 200px 70px 130px` × center-aligned, padding `20px 24px`.
  1. `NO. 014` — mono 10px cobalt
  2. Date stack — `06.16` Bodoni 900 30px / `TUE` mono 10px
  3. Title block — `World Cup Watch Party` Bodoni 800 26px + Arabic Rakkas 24px cobalt (baseline, 12px gap, wraps); below: tagline italic 14px 0.85 opacity
  4. Location/time — mono 11px, 1.5 line-height, two lines
  5. Price — Bodoni 800 22px right-aligned. `$26` or `FREE`.
  6. RSVP button — ink fill, cream text, mono 11px tracked, padding 10px 14px.
- Mobile collapses to a 56-rail + 1fr + auto grid:
  - Areas `"date title price" / "date loc btn"`. Hide NO. column. Hide tagline. Truncate location to one line. Date 22px, title 18px, button 6px 10px.

### 7. Story

- **Background**: cobalt (`#1E2BD0`), text cream.
- **Padding**: 70px 28px.
- **Border**: 2px ink bottom.
- **Layout**: 2-col grid `1.4fr 1fr`, gap 40px, center-aligned. Stacks to 1 col on mobile.
- **Left**:
  - Eyebrow: "HOW THIS HAPPENED" — mono 11px cream.
  - H2: large stacked headline, Bodoni 900, clamp(56px, 7vw, 88px), line-height 0.82. Last line is italic Bodoni edit-style (e.g. `kept going`).
  - Body: 2-column text (CSS columns, gap 32px), Inter 15px, line-height 1.7. 3 paragraphs about the founder's grandfather Kadhem and how the pop-ups began. Mobile collapses to 1 column.
- **Right**: portrait `<image-slot>`, `aspect-ratio: 3/4`, 3px cream border. Background ink while empty. Placeholder text: "Drop a photo (you, Kadhem, the kitchen)".

### 8. Footer

- **Padding**: 32px 28px.
- **Layout**: Flex, end-aligned, space-between. Stacks on mobile.
- **Three groups**:
  1. KadhemLockup at scale 0.7 (left).
  2. Mono 10px contact block: address / email / IG handle.
  3. `صحتين` (sahteen — "to your health") in Rakkas 36px cobalt right.

### 9. Floating Audio Toggle (right side, bottom)

- 56px circular button, fixed `bottom: 24px; right: 24px`, z-index high.
- Default state: cobalt fill, cream icon (a tiny waveform / speaker SVG). Label below: "TARAB" in mono 9px tracked (Tarab = Arabic musical ecstasy/groove).
- On state: sun fill, ink icon, label "ON".
- Click toggles an ambient music loop (placeholder; no audio file is bundled).

### 10. RSVP Modal (overlay)

Triggered from: top-nav CTA, hero "Reserve" button, or any `RSVP →` button on a calendar row.

- Full viewport overlay, `rgba(13,13,15,0.85)` backdrop, click-outside closes.
- Centered card, max-width 540px, cream bg, 3px ink border.
- Header: event title (Bodoni 900 ~36px), event meta line (mono 11px tracked).
- Form fields:
  - Name (text)
  - Email (email)
  - Phone (tel, optional)
  - Number of seats (stepper, 1–8, default 2)
  - Dietary notes (textarea, optional)
- Total line: `${seats} × $26 = $52` updated live.
- Submit button: full-width, cobalt fill, "Reserve · $52 →".
- Close: × button top-right.
- Submission currently logs to console — see "Backend / Integration" below.

---

## Components (in `components/shared.jsx` and `cinema-landing.jsx`)

Map these to your codebase's component primitives.

| Component | File | Purpose |
| --- | --- | --- |
| `RegMark` | shared | Small SVG circular ® mark used in nav. ~18px default. |
| `KadhemLockup` | shared | Logo lockup: "Cafe Kadhem" Bodoni serif + كافيه كاظم Rakkas. `size` prop scales whole thing. |
| `Marquee` | shared | Infinite horizontal scroller. Takes `items: string[]`. |
| `AudioToggle` | shared | Sticky audio toggle button. Takes `position: {bottom, right}`. |
| `RSVPModal` | shared | Overlay modal. Takes `open`, `onClose`, `event: {title, date, time, location, price}`. |
| `CinemaLanding` | cinema-landing | The full landing page. Takes optional `initialScroll: 'calendar'` prop to scroll-anchor on mount (used for a mobile artboard variant; not needed in production). |
| `InlineRSVP` | cinema-landing | Compact RSVP block in the hero rail (seat stepper, email, "Reserve · $X" button). |
| `CalendarRow` | cinema-landing | One row of the upcoming-events list. |

---

## Interactions & Behavior

- **Nav links** smooth-scroll to in-page anchors (`#calendar`, `#menu`, `#story`, `#archive`).
- **Save a Spot CTA / Reserve / RSVP →** all open the RSVP modal, pre-filled with the event clicked.
- **InlineRSVP stepper**: − and + buttons, clamp 1–8, total updates live.
- **Mobile hamburger**: tap toggles drawer; tap link auto-closes drawer + scrolls.
- **Marquee**: pure-CSS infinite scroll. ~30s loop. No pause needed.
- **Audio toggle**: click flips state, swaps colors + label. Plays/pauses ambient track.
- **Hover states**: buttons darken ~10%; links underline on hover.
- **Loading**: none currently — content is static. When wired to a CMS, show a 200ms skeleton (cream bg, ink stroke pulse) for hero card + calendar list + menu grid.
- **Form validation** (RSVP modal):
  - Name: required, min 2 chars.
  - Email: required, valid email format.
  - Phone: optional, accept `+` and digits/spaces/dashes.
  - Seats: required, 1–8.
  - Errors: 2px solid magenta (`#E83479`) border on field + small mono error message below in magenta.
- **Submit success**: replace modal body with confirmation — cobalt H2 "You're in.", event details, "We'll send a reminder the day before. Bring a friend." in italic Bodoni.

### Responsive

- Container queries are used (`container-type: inline-size; container-name: cinema`) so the layout responds to **the rendering element's width**, not the viewport. This is so the prototype's mobile artboard at 390px renders as mobile even when the browser viewport is 1440px. **In production, you can safely switch to viewport media queries** (`@media (max-width: 720px)`) — the rules in `responsive.css` translate 1:1.
- Single breakpoint at **720px**. No tablet variant.
- Below 720px:
  - Top strip: shorter padding, hide right block.
  - Nav: links + CTA → hamburger drawer.
  - Hero: 1-column stack (poster on top, RSVP rail below).
  - Menu grid: 1 column, compressed cell padding/typography.
  - Calendar rows: 2-line stack, hide "NO." + tagline + second location line.
  - Story: 1 column, single-column text.
  - Footer: stack vertical.

---

## State Management

Per-page (CinemaLanding) local state:

- `rsvp: boolean` — modal open/closed.
- `rsvpEvent: Event | null` — which event the modal is for.
- `navOpen: boolean` — mobile drawer.

Global / data:

- `UPCOMING: Event[]` — array of all upcoming events. First element is `NEXT_EVENT`. Currently hard-coded — see "Backend / Integration" for what to move server-side.

```ts
type Event = {
  no: string;          // "014"
  date: string;        // "06.16.26"
  day: string;         // "TUE"
  time: string;        // "6PM TILL LATE"
  title: string;       // "WORLD CUP\nWATCH PARTY" (newlines render as line breaks)
  short: string;       // "World Cup Watch Party"
  ar: string;          // "الكأس"
  tagline: string;
  loc: string;         // "91 E 3rd St · New York"
  price: number;       // 26 (0 = FREE)
  bullets: string[];
  menu?: MenuItem[];   // present on featured (next) event; optional on others
};

type MenuItem = {
  name: string;        // "Knafeh Croissant"
  ar: string;          // "كنافة"
  desc: string;
  price: number;
  cat: string;         // "PASTRY" | "BUNS" | "COFFEE" | "DRINKS" | "SAVORY" | "COOKIES" | "CAKE"
};
```

---

## Backend / Integration — things to discuss with the user

These are **not implemented** in the prototype; you'll need to decide where each lives in their target stack.

1. **Event store**. Where does the `UPCOMING` array live in production? Options:
   - Markdown/MDX files in the repo (simplest, requires redeploy per event).
   - A headless CMS (Sanity, Contentful, Payload, Notion).
   - A database (Postgres + Prisma) with an admin route.
   - Recommendation depends on how often the user adds events and whether they want non-developer editing.

2. **Menu store**. Each event has its own menu. Same store as events, nested. The "Current Menu" section reads from the *next* event's menu — define what "next" means (`now() < event.date`, sorted ascending, take first).

3. **RSVP form submission**. Currently `console.log`. Needs:
   - **Persistence** — where do RSVPs land? Options: Airtable, a Postgres table, Notion DB, an email-only flow (just send confirmation email + manage capacity manually).
   - **Capacity** — does each event have a seat cap? If yes, decrement on each RSVP and show "SOLD OUT" when 0.
   - **Payment** — are seats charged at RSVP, or paid at the door? If charged: Stripe Checkout (simplest) or Stripe Elements inline. The "$26 SEAT" stamp implies pay-to-reserve.
   - **Confirmation email** — Resend / Postmark / SendGrid. Template should match the brand (cobalt H1, Bodoni italic).
   - **Reminder email** — cron/scheduled task day-before.

4. **Image upload** for the hero poster + story portrait. The `<image-slot>` web component is a *prototype* drag-and-drop placeholder that persists to localStorage. In production, replace with:
   - A simple `<img>` whose `src` is a CMS asset, OR
   - An admin upload flow (S3 / Cloudinary / Vercel Blob) if the user wants to swap posters per event without touching code.

5. **Audio file** for the TARAB toggle. Pick one: a single ambient track (~2min loop, royalty-free oud/qanun, ~200KB MP3) or skip the feature.

6. **Newsletter signup** — not in current design but likely wanted. Footer block? Use Buttondown / ConvertKit / a simple Postgres `subscribers` table.

7. **Analytics** — Plausible (privacy-friendly) recommended over GA. Track: page views, RSVP modal opens, RSVP submissions, audio-toggle clicks.

8. **Past events / Archive** — nav links to `#archive` but the archive page isn't built in this bundle. Discuss whether they want a grid of past posters with photo galleries.

---

## Design Tokens

All declared in `styles/system.css` as CSS custom properties.

### Colors

| Token | Hex | Use |
| --- | --- | --- |
| `--cream` | `#F4ECD8` | Primary surface |
| `--paper` | `#EFE6CF` | Secondary surface (alternates in grids) |
| `--ink` | `#0D0D0F` | Text + borders |
| `--cobalt` | `#1E2BD0` | Primary accent (story bg, posters, primary buttons, accent type) |
| `--sea` | `#5BA88E` | Sea green (used in sticker accents, tertiary) |
| `--sun` | `#FF8E2C` | Sunset orange (Arabic display in poster, audio "ON" state) |
| `--magenta` | `#E83479` | Form errors, occasional accent |
| `--shadow` | `rgba(13,13,15,0.18)` | Drop shadows |

### Typography

Loaded from Google Fonts (see `index.html` `<link href>`):

| Token | Family | Use |
| --- | --- | --- |
| `--serif` | `Bodoni Moda` (400/700/800, italic 400/700) | All headlines, titles, prices |
| `--serif-edit` | `Bodoni Moda`, italic | Pull-quote / editorial italic moments |
| `--sans` | `Inter` (400/500/600/700/800) | Body copy, UI labels |
| `--mono` | `JetBrains Mono` (400/500/700) | Eyebrows, micro-labels, dates, marquee |
| `--arabic` | `Reem Kufi` (400/500/700) | Inline Arabic in body copy |
| `--arabic-display` | `Rakkas` | Display Arabic — calendar lockups, footer, nav, poster overlay |

Type sizes are inline + use `clamp()` for hero/section H2. See section descriptions above for exact values.

### Spacing & layout

- Section padding: `60–70px 28px` desktop, `28–36px 16px` mobile.
- Hero card border: `3px solid var(--ink)`.
- Section dividers: `2px solid var(--ink)`.
- Cell dividers: `2px solid var(--ink)` (right + bottom on each cell).
- Internal divider: `1px dashed var(--ink)` (price line in menu cells, footer signoff).
- No border-radius. Hard corners everywhere — this is the vintage poster aesthetic.

### Shadows

- Buttons: none, just border + fill.
- Modal: `0 12px 40px rgba(13,13,15,0.4)`.
- Poster Arabic text-shadow: `2px 2px 0 var(--ink)`.

### Borders

- All ink. 2px standard, 3px on hero/poster frames. Dashed for internal subdividers. No CSS `box-shadow` glow.

---

## Assets

- **Fonts**: All from Google Fonts — no self-hosted files. Replace with self-hosted woff2 in production for performance.
- **Logo (`KadhemLockup`)**: hand-rendered as styled text (Bodoni + Rakkas) — no image asset. The user may want a real logo file made; current text lockup is the brand spec.
- **`RegMark` icon**: inline SVG component.
- **Marquee separator** (`✦`): unicode character, no asset.
- **Hero poster image**: `<image-slot id="hero-poster">` — placeholder, user-supplied at build time. Aspect 4:3, target 1200×900 minimum.
- **Story portrait**: `<image-slot id="story-portrait">` — placeholder, user-supplied. Aspect 3:4.
- **Audio file**: not bundled. See Backend → 5.

The `<image-slot>` web component (`vendor/image-slot.js`) is a **prototype tool only** — it lets the designer drop a local image that persists in localStorage. **Do not ship it.** Replace with regular `<img>` or a Next/Image component pulling from your asset host.

---

## Files in this bundle

```
design_handoff_cafe_kadhem/
├── README.md                       ← this file
├── index.html                      ← entry HTML; renders <CinemaLanding /> full-bleed
├── styles/
│   ├── system.css                  ← design tokens (CSS vars), base type, button styles, grain effect
│   └── responsive.css              ← container-query breakpoints (720px)
├── components/
│   ├── shared.jsx                  ← RegMark, KadhemLockup, Marquee, AudioToggle, RSVPModal, CursorSticker (no-op)
│   └── cinema-landing.jsx          ← CinemaLanding (full page), InlineRSVP, CalendarRow, UPCOMING data
└── vendor/
    └── image-slot.js               ← <image-slot> prototype web component (drop-replace in production)
```

To preview locally: serve the folder over any static server (`python3 -m http.server`, `npx serve`, etc.) and open `index.html`. Babel transpiles JSX in-browser — slow, prototype-only.

---

## Recommended implementation order

1. Stand up the target framework with the design tokens (CSS vars in a global stylesheet or your design-system equivalent).
2. Load fonts (Bodoni Moda, Inter, JetBrains Mono, Rakkas, Reem Kufi).
3. Implement layout primitives: section wrapper with 2px ink bottom border, marquee, top strip, footer.
4. Build the hero (most complex piece); decide on the `<image-slot>` replacement strategy first.
5. Build menu grid + calendar list (similar grid patterns; share a cell component).
6. Wire the RSVP modal + form.
7. Decide event/menu data source (start with MDX in repo, migrate to CMS if/when needed).
8. Wire RSVP submission + payment + email.
9. Replace the JSX-in-browser setup with native components.
10. Mobile QA at 360 / 390 / 414 / 768 / 1024 / 1440.

Questions for the user as you go:
- Where should events be authored?
- Are seats paid up-front or at the door?
- Which email provider?
- Real logo asset vs. text lockup?
- Audio toggle: keep, or cut?
- Newsletter signup in footer?
