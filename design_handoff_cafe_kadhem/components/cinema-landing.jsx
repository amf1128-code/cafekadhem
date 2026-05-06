// DIRECTION A — CINEMA POSTER (event-led hero, fully responsive)
const { useState: useStateA, useRef: useRefA, useEffect: useEffectA } = React;

// All upcoming events. Each has its own rotating menu that travels with the pop-up.
const UPCOMING = [
  {
    no: "014", date: "06.16.26", day: "TUE", time: "6PM TILL LATE",
    title: "WORLD CUP\nWATCH PARTY", short: "World Cup Watch Party",
    ar: "الكأس",
    tagline: "Football, free knafeh croissants at halftime, and yelling at the screen.",
    loc: "91 E 3rd St · New York", price: 26,
    bullets: [
      "Iraq v Norway · 6pm kickoff",
      "Algeria v Argentina · 9pm",
      "Pistachio buns out the oven all night",
      "Net proceeds → World Central Kitchen",
    ],
    menu: [
      { name: "Knafeh Croissant", ar: "كنافة", desc: "Laminated dough, akkawi cheese, orange-blossom syrup. Halftime snack.", price: 8, cat: "PASTRY" },
      { name: "Halftime Pistachio Buns", ar: "كعك", desc: "Brown-buttered, dusted with crushed Aleppo pistachio.", price: 7, cat: "BUNS" },
      { name: "Cardamom Drip", ar: "قهوة", desc: "Single-origin Yemen, cardamom, no-nonsense.", price: 5, cat: "COFFEE" },
      { name: "Karkadeh Spritz", ar: "كركديه", desc: "Hibiscus, ginger, lemon. Non-alcoholic; bring your own beer.", price: 7, cat: "DRINKS" },
      { name: "Manakish on a Stick", ar: "مناقيش", desc: "Za'atar, olive oil, sumac. Easy to eat standing up yelling at the TV.", price: 6, cat: "SAVORY" },
      { name: "Date Maamoul", ar: "معمول", desc: "Semolina shell, medjool dates, just enough rose water.", price: 4, cat: "COOKIES" },
    ],
  },
  {
    no: "015", date: "06.30.26", day: "SUN", time: "1PM TILL SOLD OUT",
    title: "CAFE KADHEM\nTURNS ONE", short: "Cafe Kadhem Turns One",
    ar: "عيد ميلاد",
    tagline: "We're a year old. Come eat cake and stay too long.",
    loc: "167 Utica Ave · Brooklyn", price: 20,
    bullets: [
      "Three cakes (one of them carrot)",
      "Lemon-pistachio slice for the first 100",
      "Dabke after sundown",
      "Bring your friend who eats like four people",
    ],
    menu: [
      { name: "Pistachio Lemon Cake", ar: "ليمون", desc: "Olive oil, meyer lemon, heavy cream cheese frosting.", price: 6, cat: "CAKE" },
      { name: "Carrot Cake (Teta's)", ar: "جزر", desc: "Walnuts, raisins, a little too much cinnamon (on purpose).", price: 6, cat: "CAKE" },
      { name: "Chocolate-Tahini Cake", ar: "طحينة", desc: "Layered, dark, swirl of toasted-sesame frosting.", price: 7, cat: "CAKE" },
      { name: "Birthday Maamoul", ar: "معمول", desc: "Pistachio shortbread, in honor of one whole year of this.", price: 5, cat: "COOKIES" },
    ],
  },
  {
    no: "016", date: "07.12.26", day: "FRI", time: "8PM TILL MIDNIGHT",
    title: "TARAB FRIDAY", short: "Tarab Friday",
    ar: "طرب",
    tagline: "Live oud + qanun, cardamom drip flowing, no phones on the table.",
    loc: "Bedford-Stuy, BK", price: 18,
    bullets: ["Live oud + qanun · 8pm", "Cardamom coffee on tap", "Standing room only after 9", "BYO listening ears"],
  },
  {
    no: "017", date: "07.26.26", day: "SAT", time: "8PM",
    title: "CINEMA UNDER\nTHE BQE", short: "Cinema Under the BQE",
    ar: "سينما",
    tagline: "Outdoor screening · Youssef Chahine retrospective · bring a blanket.",
    loc: "TBA · Brooklyn", price: 0,
    bullets: ["Free, RSVP required", "Two films, one intermission", "Mint tea on the house"],
  },
];

const NEXT_EVENT = UPCOMING[0];

function CinemaLanding({ initialScroll }) {
  const [rsvp, setRsvp] = useStateA(false);
  const [rsvpEvent, setRsvpEvent] = useStateA(NEXT_EVENT);
  const [navOpen, setNavOpen] = useStateA(false);
  const containerRef = useRefA(null);

  useEffectA(() => {
    if (!initialScroll || !containerRef.current) return;
    const target = containerRef.current.querySelector(`#${initialScroll}`);
    if (target) {
      const top = target.offsetTop - 8;
      containerRef.current.scrollTop = top;
    }
  }, [initialScroll]);

  const openRsvp = (ev) => { setRsvpEvent(ev); setRsvp(true); };

  return (
    <div ref={containerRef} className="cinema-root grain" style={{ background: "var(--cream)", color: "var(--ink)", position: "relative", height: "100%", overflowY: "auto" }}>

      {/* TOP STRIP */}
      <div className="cinema-strip" style={{ borderBottom: "2px solid var(--ink)", padding: "10px 28px", display: "flex", justifyContent: "space-between", alignItems: "center", background: "var(--cream)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em" }}>
        <span>✦ POP-UP CAFE SERIES · NEW YORK · EST. 2025</span>
        <span className="hide-mobile">06 / 16 / TUE · 78°F · صباح الخير</span>
      </div>

      {/* NAV */}
      <header className="cinema-nav" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "20px 28px", borderBottom: "2px solid var(--ink)", gap: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <RegMark size={18} />
          <KadhemLockup size={0.6} />
        </div>
        <nav className="cinema-nav-links" style={{ display: "flex", gap: 26, fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.12em", alignItems: "center" }}>
          {[
            { en: "CALENDAR", ar: "التقويم", href: "#calendar" },
            { en: "MENU", ar: "القائمة", href: "#menu" },
            { en: "STORY", ar: "القصة", href: "#story" },
            { en: "ARCHIVE", ar: "الأرشيف", href: "#archive" },
          ].map((l) => (
            <a key={l.en} href={l.href} style={{ color: "var(--ink)", textDecoration: "none", display: "inline-flex", alignItems: "baseline", gap: 8 }}>
              <span>{l.en}</span>
              <span style={{ opacity: 0.5 }}>/</span>
              <span style={{ fontFamily: "var(--arabic-display)", fontSize: 18, direction: "rtl", letterSpacing: 0 }}>{l.ar}</span>
            </a>
          ))}
        </nav>
        <button onClick={() => openRsvp(NEXT_EVENT)} className="btn btn-primary cinema-reserve">Save a Spot →</button>
        <button className="cinema-burger" onClick={() => setNavOpen(!navOpen)} aria-label="Menu" style={{
          display: "none", width: 40, height: 40, border: "2px solid var(--ink)", background: "var(--cream)", padding: 0, cursor: "pointer", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 4,
        }}>
          <span style={{ width: 18, height: 2, background: "var(--ink)" }} />
          <span style={{ width: 18, height: 2, background: "var(--ink)" }} />
          <span style={{ width: 18, height: 2, background: "var(--ink)" }} />
        </button>
      </header>

      {navOpen && (
        <div className="cinema-mobile-nav" style={{ display: "none", flexDirection: "column", borderBottom: "2px solid var(--ink)", background: "var(--cream)" }}>
          {[
            { en: "CALENDAR", ar: "التقويم" },
            { en: "MENU", ar: "القائمة" },
            { en: "STORY", ar: "القصة" },
            { en: "ARCHIVE", ar: "الأرشيف" },
          ].map(({ en, ar }) => (
            <a key={en} href={`#${en.toLowerCase()}`} onClick={() => setNavOpen(false)} style={{ padding: "16px 28px", fontFamily: "var(--mono)", fontSize: 12, letterSpacing: "0.16em", color: "var(--ink)", textDecoration: "none", borderTop: "1px solid var(--ink)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span>{en}</span>
              <span style={{ fontFamily: "var(--arabic-display)", fontSize: 22, direction: "rtl", letterSpacing: 0 }}>{ar}</span>
            </a>
          ))}
        </div>
      )}

      {/* HERO — POSTER + DETAILS + RSVP */}
      <section className="cinema-hero" style={{ borderBottom: "2px solid var(--ink)", padding: "28px 28px 32px" }}>
        <div className="cinema-hero-strap" style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 18, flexWrap: "wrap", gap: 8 }}>
          <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.18em", color: "var(--cobalt)" }}>
            ✦ NEXT POP-UP · NO. {NEXT_EVENT.no} · {NEXT_EVENT.day} {NEXT_EVENT.date}
          </div>
          <div className="hide-mobile" style={{ fontFamily: "var(--serif-edit)", fontStyle: "italic", fontSize: 16, color: "var(--ink)" }}>
            Hi, hello — we throw pop-ups. Here's the next one.
          </div>
        </div>

        {/* TWO-COLUMN: POSTER (4:3) + DETAILS COLUMN */}
        <div className="cinema-hero-grid" style={{ display: "grid", gridTemplateColumns: "1.1fr 1fr", gap: 0, border: "3px solid var(--ink)" }}>

          {/* LEFT: POSTER SLOT (4:3) WITH OVERLAY CHROME */}
          <div className="cinema-poster-wrap" style={{ position: "relative", background: "var(--cobalt)", overflow: "hidden", borderRight: "3px solid var(--ink)" }}>
            <div className="cinema-poster-frame" style={{ position: "relative", width: "100%", aspectRatio: "4/3", background: "var(--cobalt)" }}>
              <image-slot
                id="hero-poster"
                shape="rect"
                placeholder="Drop a 4:3 poster (1200×900)"
                style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}>
              </image-slot>

              {/* Folio top-left */}
              <div className="mono" style={{ position: "absolute", top: 16, left: 16, fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--cream)", background: "var(--ink)", padding: "6px 10px", border: "2px solid var(--cream)", zIndex: 2 }}>
                FOLIO {NEXT_EVENT.no}
              </div>

              {/* Arabic display top-right */}
              <div style={{ position: "absolute", top: 12, right: 16, fontFamily: "var(--arabic-display)", fontSize: 64, direction: "rtl", lineHeight: 1, color: "var(--sun)", textShadow: "2px 2px 0 var(--ink)", zIndex: 2 }}>
                {NEXT_EVENT.ar}
              </div>

              {/* Stamp/seal bottom-right */}
              <div style={{ position: "absolute", bottom: 16, right: 16, width: 88, height: 88, border: "2px solid var(--cream)", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", color: "var(--cream)", background: "rgba(30,43,208,0.85)", transform: "rotate(-8deg)", zIndex: 2 }}>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 8, letterSpacing: "0.14em" }}>NO. {NEXT_EVENT.no}</div>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: 22, lineHeight: 1, marginTop: 2 }}>${NEXT_EVENT.price}</div>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 7, letterSpacing: "0.16em", marginTop: 2 }}>SEAT</div>
              </div>

              {/* Date stamp bottom-left */}
              <div style={{ position: "absolute", bottom: 16, left: 16, color: "var(--cream)", background: "var(--ink)", padding: "8px 12px", border: "2px solid var(--cream)", zIndex: 2 }}>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: 28, lineHeight: 0.9 }}>{NEXT_EVENT.day} {NEXT_EVENT.date.slice(0,5)}</div>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.16em", marginTop: 2 }}>{NEXT_EVENT.time}</div>
              </div>
            </div>

            {/* Caption below poster */}
            <div style={{ background: "var(--ink)", color: "var(--cream)", padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em" }}>
              <span>POSTER · POP-UP NO. {NEXT_EVENT.no}</span>
              <span>{NEXT_EVENT.loc.toUpperCase()}</span>
            </div>
          </div>

          {/* RIGHT: TITLE + TAGLINE + DETAILS + RSVP */}
          <div className="cinema-rsvp-rail" style={{ background: "var(--cream)", padding: "28px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
            <div>
              <h1 style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: "clamp(44px, 4.6vw, 72px)", lineHeight: 0.85, letterSpacing: "-0.01em", whiteSpace: "pre-line", margin: 0 }}>
                {NEXT_EVENT.title}
              </h1>
              <p style={{ fontFamily: "var(--serif-edit)", fontStyle: "italic", fontSize: 18, lineHeight: 1.35, marginTop: 12, color: "var(--cobalt)" }}>
                {NEXT_EVENT.tagline}
              </p>
            </div>

            {/* Details strip */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, padding: "14px 0", borderTop: "2px solid var(--ink)", borderBottom: "2px solid var(--ink)" }}>
              <div>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.18em", opacity: 0.65 }}>WHEN</div>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 800, fontSize: 18, marginTop: 3 }}>{NEXT_EVENT.day} {NEXT_EVENT.date.slice(0,5)}</div>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", opacity: 0.7 }}>{NEXT_EVENT.time}</div>
              </div>
              <div>
                <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.18em", opacity: 0.65 }}>WHERE</div>
                <div style={{ fontFamily: "var(--sans)", fontWeight: 600, fontSize: 14, marginTop: 3, lineHeight: 1.3 }}>{NEXT_EVENT.loc}</div>
              </div>
            </div>

            {/* Bullets */}
            <ul style={{ fontFamily: "var(--sans)", fontSize: 13.5, lineHeight: 1.55, paddingLeft: 18, margin: 0 }}>
              {NEXT_EVENT.bullets.map((b) => <li key={b}>{b}</li>)}
            </ul>

            {/* RSVP */}
            <InlineRSVP event={NEXT_EVENT} onOpenFull={() => openRsvp(NEXT_EVENT)} />

            <div style={{ marginTop: "auto", paddingTop: 14, borderTop: "1px dashed var(--ink)", fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em", color: "var(--ink)", opacity: 0.6, display: "flex", justifyContent: "space-between" }}>
              <span>CK-{NEXT_EVENT.no}</span>
              <span>RSVP / حجز</span>
            </div>
          </div>
        </div>
      </section>

      {/* MARQUEE */}
      <Marquee items={["FRESH BAKES TUESDAYS", "كافيه كاظم", "KNAFEH CROISSANTS RETURN", "صحتين", "EAST 3RD ST", "بالهنا والشفا", "PISTACHIO BUNS HOT AT 9AM"]} />

      {/* MENU FOR THIS POP-UP */}
      <section id="menu" style={{ padding: "60px 28px", borderBottom: "2px solid var(--ink)", background: "var(--paper)" }}>
        <div className="cinema-menu-head" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 24, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.18em", color: "var(--cobalt)" }}>
              ✦ POP-UP NO. {NEXT_EVENT.no} · {NEXT_EVENT.short.toUpperCase()}
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap", marginTop: 6 }}>
              <h2 style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: "clamp(56px, 7vw, 96px)", lineHeight: 0.85, margin: 0 }}>
                CURRENT MENU.
              </h2>
              <div style={{ fontFamily: "var(--arabic-display)", fontSize: 72, direction: "rtl", color: "var(--cobalt)", lineHeight: 0.9 }}>القائمة</div>
            </div>
            <p style={{ fontFamily: "var(--serif-edit)", fontStyle: "italic", fontSize: 17, color: "var(--ink)", maxWidth: 540, marginTop: 10, lineHeight: 1.4 }}>
              The menu rotates with the night. This one travels with the watch party — small, snackable, easy to eat one-handed.
            </p>
          </div>
          <div style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.16em", color: "var(--ink)", textAlign: "right" }}>
            SERVED {NEXT_EVENT.day} {NEXT_EVENT.date}<br/>
            {NEXT_EVENT.loc.toUpperCase()}
          </div>
        </div>

        <div className="cinema-bakes-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 0, border: "2px solid var(--ink)" }}>
          {NEXT_EVENT.menu.map((d, i) => (
            <div key={d.name} className="cinema-bake-cell" style={{
              padding: 22,
              borderRight: "2px solid var(--ink)",
              borderBottom: "2px solid var(--ink)",
              background: i % 2 === 0 ? "var(--cream)" : "var(--paper)",
              minHeight: 200,
              display: "flex", flexDirection: "column", justifyContent: "space-between",
            }}>
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <span className="mono" style={{ fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.14em" }}>0{i + 1} / {d.cat}</span>
                  <span style={{ fontFamily: "var(--arabic-display)", fontSize: 26, direction: "rtl", color: "var(--cobalt)" }}>{d.ar}</span>
                </div>
                <div style={{ fontFamily: "var(--serif)", fontWeight: 800, fontSize: 26, lineHeight: 0.95, marginTop: 6 }}>{d.name.toUpperCase()}</div>
                <div style={{ fontFamily: "var(--sans)", fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{d.desc}</div>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 16, borderTop: "1px dashed var(--ink)", paddingTop: 8 }}>
                <span className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10 }}>—— · —— · ——</span>
                <span style={{ fontFamily: "var(--serif)", fontWeight: 800, fontSize: 22 }}>${d.price}</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* CALENDAR — UPCOMING EVENTS LIST */}
      <section id="calendar" style={{ padding: "60px 28px", borderBottom: "2px solid var(--ink)" }}>
        <div className="cinema-also" style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 22, flexWrap: "wrap", gap: 16 }}>
          <div>
            <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.18em", color: "var(--cobalt)" }}>WHAT'S COMING UP</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexWrap: "wrap", marginTop: 6 }}>
              <h2 style={{ fontFamily: "var(--serif)", fontSize: "clamp(56px, 7vw, 96px)", lineHeight: 0.85, fontWeight: 900, margin: 0 }}>
                THE CALENDAR.
              </h2>
              <div style={{ fontFamily: "var(--arabic-display)", fontSize: 72, direction: "rtl", color: "var(--cobalt)", lineHeight: 0.9 }}>التقويم</div>
            </div>
          </div>
          <a href="#" className="btn">See full calendar →</a>
        </div>

        <div style={{ border: "2px solid var(--ink)" }}>
          {UPCOMING.map((e, i) => (
            <CalendarRow key={e.no} event={e} onRsvp={() => openRsvp(e)} last={i === UPCOMING.length - 1} alt={i % 2 === 1} />
          ))}
        </div>
      </section>

      {/* STORY */}
      <section id="story" style={{ padding: "70px 28px", borderBottom: "2px solid var(--ink)", background: "var(--cobalt)", color: "var(--cream)", position: "relative" }}>
        <div className="cinema-story-grid" style={{ display: "grid", gridTemplateColumns: "1.4fr 1fr", gap: 40, alignItems: "center" }}>
          <div>
            <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.18em" }}>HOW THIS HAPPENED</div>
            <h2 style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: "clamp(56px, 7vw, 88px)", lineHeight: 0.82, margin: "8px 0 22px" }}>
              I STARTED<br/>BAKING TOO<br/>MUCH, &<br/><span style={{ fontStyle: "italic", fontFamily: "var(--serif-edit)" }}>kept going</span>
            </h2>
            <div className="cinema-story-cols" style={{ columnCount: 2, columnGap: 32, fontFamily: "var(--sans)", fontSize: 15, lineHeight: 1.7 }}>
              <p style={{ marginTop: 0 }}>Kadhem was my grandfather — he ran a tiny coffeehouse in Baghdad and fed everyone who walked in. I'm not running a coffeehouse, I'm baking out of a borrowed kitchen. But the part where you feed everyone who walks in, that part I kept.</p>
              <p>It started as one Saturday with way too many cardamom buns. Forty people came, ate them all, and someone asked when I was doing it again. So I did it again.</p>
              <p>Now it's a roving thing — sometimes a watch party, sometimes a birthday, once a wedding (long story). Always too many cookies. Come hungry, bring a friend.</p>
            </div>
          </div>
          <div style={{ position: "relative", aspectRatio: "3/4", border: "3px solid var(--cream)", overflow: "hidden", background: "var(--ink)" }}>
            <image-slot id="story-portrait" shape="rect" placeholder="Drop a photo (you, Kadhem, the kitchen)" style={{ width: "100%", height: "100%" }}></image-slot>
          </div>
        </div>
      </section>

      <footer style={{ padding: "32px 28px", display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", gap: 24 }}>
        <KadhemLockup size={0.7} />
        <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em" }}>
          91 E 3RD ST · NEW YORK<br/>HI@CAFEKADHEM.NYC<br/>@CAFE.KADHEM
        </div>
        <div style={{ fontFamily: "var(--arabic-display)", fontSize: 36, direction: "rtl", color: "var(--cobalt)" }}>
          صحتين
        </div>
      </footer>

      <AudioToggle position={{ bottom: 24, right: 24 }} />
      <RSVPModal open={rsvp} onClose={() => setRsvp(false)} event={rsvpEvent ? { title: rsvpEvent.title.replace(/\n/g, " "), date: `${rsvpEvent.day} ${rsvpEvent.date}`, time: rsvpEvent.time, location: rsvpEvent.loc, price: rsvpEvent.price } : null} />
    </div>
  );
}

// One row of the upcoming-events calendar list.
function CalendarRow({ event, onRsvp, last, alt }) {
  return (
    <div className="cinema-cal-row" style={{
      display: "grid",
      gridTemplateColumns: "70px 110px 1fr 200px 70px 130px",
      gap: 20, alignItems: "center",
      padding: "20px 24px",
      background: alt ? "var(--paper)" : "var(--cream)",
      borderBottom: last ? "none" : "2px solid var(--ink)",
    }}>
      <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", color: "var(--cobalt)" }}>NO. {event.no}</div>

      <div>
        <div style={{ fontFamily: "var(--serif)", fontWeight: 900, fontSize: 30, lineHeight: 0.9 }}>{event.date.slice(0,5)}</div>
        <div className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.18em", marginTop: 2 }}>{event.day}</div>
      </div>

      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontFamily: "var(--serif)", fontWeight: 800, fontSize: 26, lineHeight: 1, whiteSpace: "pre-line" }}>{event.short}</span>
          <span style={{ fontFamily: "var(--arabic-display)", fontSize: 24, direction: "rtl", color: "var(--cobalt)" }}>{event.ar}</span>
        </div>
        <div style={{ fontFamily: "var(--serif-edit)", fontStyle: "italic", fontSize: 14, marginTop: 4, lineHeight: 1.4, opacity: 0.85 }}>{event.tagline}</div>
      </div>

      <div className="mono cinema-cal-loc" style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.14em", lineHeight: 1.5 }}>
        {event.loc}<br/>
        <span style={{ opacity: 0.65 }}>{event.time}</span>
      </div>

      <div style={{ fontFamily: "var(--serif)", fontWeight: 800, fontSize: 22, textAlign: "right" }}>
        {event.price === 0 ? "FREE" : `$${event.price}`}
      </div>

      <button onClick={onRsvp} className="cinema-cal-btn" style={{
        padding: "10px 14px", border: "2px solid var(--ink)", background: "var(--ink)", color: "var(--cream)",
        fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.14em", cursor: "pointer",
      }}>RSVP →</button>
    </div>
  );
}

// Inline lightweight RSVP that lives in the hero rail
function InlineRSVP({ event, onOpenFull }) {
  const [count, setCount] = useStateA(2);
  const [email, setEmail] = useStateA("");
  const total = event.price * count;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span className="mono" style={{ fontFamily: "var(--mono)", fontSize: 10, letterSpacing: "0.14em" }}>SEATS</span>
        <button onClick={() => setCount(Math.max(1, count - 1))} style={inlineStep}>−</button>
        <span style={{ fontFamily: "var(--serif)", fontSize: 22, fontWeight: 800, minWidth: 24, textAlign: "center" }}>{count}</span>
        <button onClick={() => setCount(Math.min(8, count + 1))} style={inlineStep}>+</button>
        <span style={{ marginLeft: "auto", fontFamily: "var(--serif)", fontSize: 22, fontWeight: 800 }}>${total}</span>
      </div>
      <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hi@cafekadhem.nyc"
        style={{ padding: "10px 12px", border: "2px solid var(--ink)", background: "transparent", fontFamily: "var(--sans)", fontSize: 13, outline: "none" }} />
      <button onClick={onOpenFull} className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }}>
        Reserve · ${total} →
      </button>
    </div>
  );
}
const inlineStep = { width: 32, height: 32, border: "2px solid var(--ink)", background: "var(--cream)", fontSize: 16, cursor: "pointer", fontFamily: "var(--serif)" };

window.CinemaLanding = CinemaLanding;
window.NEXT_EVENT = NEXT_EVENT;
window.UPCOMING = UPCOMING;
