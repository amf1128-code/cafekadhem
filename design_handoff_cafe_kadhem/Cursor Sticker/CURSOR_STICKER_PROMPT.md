# Add the Cursor Sticker back to the Cafe Kadhem landing page

## What it is

A small orange pill that follows the user's mouse around the landing page, with an Arabic word inside it (Rakkas font, 22px). Click anywhere on the page to cycle to the next phrase. Cute, not corny — it's a single small bubble, not a swarm.

It's the brand's "personality moment" — the site is otherwise reserved (cobalt + cream + halftone, condensed serif), so this one playful element on hover/click adds warmth without breaking the cinema-poster restraint.

## Reference files

- **`cursor-sticker-reference.html`** — open this in a browser. Move your mouse over the stage, click to cycle phrases. This is the exact behavior to match.
- **`cursor-sticker-screenshot.png`** — visual reference of the sticker rendered.

## Visual spec

- Pill shape, `border-radius: 999px`
- Background: `#FF8E2C` (the brand `--sun` orange)
- Text color: `#0D0D0F` (ink)
- Border: `2px solid #0D0D0F`
- Box shadow: `2px 2px 0 #0D0D0F` (hard offset, no blur — matches the rest of the brand's poster shadows)
- Padding: `8px 14px`
- Font: **Rakkas** (Google Fonts), 22px, line-height 1, `direction: rtl`
- Rotation: `-12deg` (subtle tilt, not cartoony)

## Behavior

1. Tracks `mousemove` on the landing page root container
2. Position offset from cursor: `+20px x, -30px y`
3. **Use `requestAnimationFrame` to throttle DOM updates** — do NOT call `setState` on every mousemove or it will tank performance. Store cursor position in a ref/variable, schedule one rAF, write `transform: translate(x, y) rotate(-12deg)` directly to the element style
4. `pointer-events: none` so it never blocks clicks underneath
5. Fade in (200ms) on first move into the page; fade out on `mouseleave`
6. **Click anywhere on the page** cycles to the next phrase in the array

## Phrases (cycle in this order)

```js
const phrases = [
  "صحتين",   // sahteen — "to your health" (default)
  "بالهنا",   // bil hana — "with pleasure"
  "اتفضل",   // itfaddal — "help yourself"
  "يلا",     // yalla — "let's go"
  "طازة",    // taza — "fresh"
  "حبيبي",   // habibi — "my dear"
];
```

## Disable conditions

The sticker should NOT render / should be hidden when:

- Touch device — `@media (pointer: coarse)` or `matchMedia("(pointer: coarse)").matches`
- Any modal is open (e.g. RSVP modal) — don't fight modal UX
- Cursor is over an `<input>`, `<textarea>`, `<select>`, or `<button>` — it covers UI; just hide it on those elements (use `mouseenter`/`mouseleave` on form fields, or check `e.target.closest("input, textarea, select, button")`)

## Don'ts

- Don't make multiple stickers spawn — it's one bubble, not particle effects
- Don't change the phrase on mousemove — only on click
- Don't auto-cycle on a timer — it's user-driven
- Don't add cute emojis or sparkles around it — the sticker alone is the moment
- Don't render it inside the React render tree if it causes re-renders on every mousemove. Either (a) mount it as a sibling DOM node and update its `style.transform` imperatively via a ref, or (b) use a `useRef` for position and only commit via rAF

## Suggested React implementation sketch

```jsx
function CursorSticker() {
  const ref = useRef(null);
  const [phraseIdx, setPhraseIdx] = useState(0);
  const [visible, setVisible] = useState(false);
  const pos = useRef({ x: 0, y: 0 });
  const raf = useRef(0);

  useEffect(() => {
    if (matchMedia("(pointer: coarse)").matches) return;

    const apply = () => {
      raf.current = 0;
      if (ref.current) {
        ref.current.style.transform =
          `translate(${pos.current.x + 20}px, ${pos.current.y - 30}px) rotate(-12deg)`;
      }
    };
    const onMove = (e) => {
      // hide over interactive elements
      if (e.target.closest("input, textarea, select, button, a")) {
        setVisible(false);
        return;
      }
      pos.current = { x: e.clientX, y: e.clientY };
      setVisible(true);
      if (!raf.current) raf.current = requestAnimationFrame(apply);
    };
    const onLeave = () => setVisible(false);
    const onClick = () => setPhraseIdx((i) => (i + 1) % phrases.length);

    window.addEventListener("mousemove", onMove, { passive: true });
    window.addEventListener("mouseleave", onLeave);
    window.addEventListener("click", onClick);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`cursor-sticker ${visible ? "" : "hidden"}`}
      style={{ position: "fixed", top: 0, left: 0, pointerEvents: "none", zIndex: 9999 }}
    >
      {phrases[phraseIdx]}
    </div>
  );
}
```

## Acceptance criteria

- [ ] Sticker appears on mouse enter, follows cursor smoothly with no jank
- [ ] Click anywhere cycles through all 6 phrases in order, then loops
- [ ] Hidden over inputs, buttons, links, and when modal is open
- [ ] Hidden entirely on touch devices
- [ ] No console errors, no perceptible mousemove lag (test with 6x CPU throttle)
- [ ] Rakkas font is loaded (Google Fonts: `Rakkas&display=swap`)
