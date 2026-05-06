// Shared building blocks for Cafe Kadhem prototypes
const { useState, useEffect, useRef, useMemo } = React;

// ---------- HALFTONE PORTRAIT (programmatic, no real photo needed) ----------
function HalftonePortrait({ seed = 1, label, w = 400, h = 500, style = {} }) {
  // procedural radial halftone "portrait" — silhouette over noise dots
  const id = `ht-${seed}`;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ display: "block", ...style }}>
      <defs>
        <radialGradient id={`bg-${id}`} cx="50%" cy="35%" r="65%">
          <stop offset="0%" stopColor="#f4ecd8" />
          <stop offset="35%" stopColor="#a8a8aa" />
          <stop offset="70%" stopColor="#1a1a1d" />
          <stop offset="100%" stopColor="#0d0d0f" />
        </radialGradient>
        <pattern id={`dots-${id}`} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="3" cy="3" r="1.4" fill="#0d0d0f" />
        </pattern>
        <mask id={`mask-${id}`}>
          <rect width={w} height={h} fill="white" />
          <rect width={w} height={h} fill={`url(#dots-${id})`} opacity="0.85" />
        </mask>
      </defs>
      <rect width={w} height={h} fill={`url(#bg-${id})`} />
      <rect width={w} height={h} fill="#0d0d0f" mask={`url(#mask-${id})`} opacity="0.55" />
      {/* Soft silhouette suggestion */}
      <ellipse cx={w * 0.5} cy={h * 0.32} rx={w * 0.18} ry={h * 0.16} fill="#f4ecd8" opacity="0.18" />
      <ellipse cx={w * 0.5} cy={h * 0.7} rx={w * 0.32} ry={h * 0.28} fill="#0d0d0f" opacity="0.4" />
      {label && (
        <text x={w - 12} y={h - 14} textAnchor="end" fontFamily="JetBrains Mono, monospace" fontSize="10" fill="#f4ecd8" letterSpacing="2">
          {label}
        </text>
      )}
    </svg>
  );
}

// ---------- GRAIN OVERLAY ----------
function Grain({ opacity = 0.35, blend = "multiply" }) {
  return (
    <div
      aria-hidden
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 50,
        mixBlendMode: blend,
        opacity,
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='220' height='220'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 0.55 0'/></filter><rect width='100%25' height='100%25' filter='url(%23n)'/></svg>\")",
      }}
    />
  );
}

// ---------- MARQUEE ----------
function Marquee({ items, speed = 38, style = {}, sep = "✦", invert = false }) {
  const text = items.join(`   ${sep}   `);
  return (
    <div
      style={{
        overflow: "hidden",
        whiteSpace: "nowrap",
        borderTop: "2px solid var(--ink)",
        borderBottom: "2px solid var(--ink)",
        background: invert ? "var(--ink)" : "var(--cream)",
        color: invert ? "var(--cream)" : "var(--ink)",
        ...style,
      }}
    >
      <div
        style={{
          display: "inline-block",
          animation: `marquee ${speed}s linear infinite`,
          padding: "14px 0",
        }}
      >
        <span style={{ paddingRight: 56, fontFamily: "var(--serif-edit)", fontStyle: "italic", fontSize: 24 }}>
          {text}   {sep}   {text}   {sep}&nbsp;
        </span>
      </div>
    </div>
  );
}

// ---------- REGISTRATION MARK ----------
function RegMark({ size = 18, color = "var(--ink)" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "inline-block" }}>
      <circle cx="12" cy="12" r="10" fill="none" stroke={color} strokeWidth="1.5" />
      <line x1="12" y1="0" x2="12" y2="24" stroke={color} strokeWidth="1.5" />
      <line x1="0" y1="12" x2="24" y2="12" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

// ---------- ARABIC LOCKUP ----------
function KadhemLockup({ size = 1, color = "currentColor", stacked = true, latinFont = "var(--serif)" }) {
  return (
    <div style={{ display: "inline-flex", flexDirection: stacked ? "column" : "row", alignItems: "center", gap: 6 * size, color, lineHeight: 1 }}>
      <div style={{ fontFamily: "var(--arabic-display)", fontSize: 36 * size, direction: "rtl", letterSpacing: "0.02em" }}>
        كافيه كاظم
      </div>
      <div style={{ fontFamily: latinFont, fontWeight: 800, fontSize: 22 * size, letterSpacing: "0.18em" }}>
        CAFE KADHEM
      </div>
    </div>
  );
}

// ---------- TICKET / RSVP MODAL ----------
function RSVPModal({ open, onClose, event }) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [count, setCount] = useState(2);
  useEffect(() => { if (open) setStep(0); }, [open]);
  if (!open) return null;
  const total = (event?.price ?? 26) * count;
  return (
    <div
      onClick={onClose}
      style={{ position: "absolute", inset: 0, background: "rgba(13,13,15,0.7)", zIndex: 200, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ background: "var(--cream)", border: "2px solid var(--ink)", padding: 28, width: "min(440px, 100%)", boxShadow: "8px 8px 0 var(--ink)" }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 18 }}>
          <div style={{ fontFamily: "var(--mono)", fontSize: 11, letterSpacing: "0.1em" }}>{`TICKET / 0${step + 1}`}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer" }}>×</button>
        </div>
        {step === 0 && (
          <>
            <div style={{ fontFamily: "var(--serif)", fontSize: 44, lineHeight: 0.9, fontWeight: 800, marginBottom: 6 }}>
              {event?.title || "RESERVE A SEAT"}
            </div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, marginBottom: 18 }}>
              {event?.date} · {event?.time} · {event?.location}
            </div>
            <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, marginBottom: 4 }}>YOUR NAME</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="ISMAIL YASSIN" style={inputStyle} />
            <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, marginTop: 14, marginBottom: 4 }}>EMAIL</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="hi@cafekadhem.nyc" style={inputStyle} />
            <label style={{ display: "block", fontFamily: "var(--mono)", fontSize: 10, marginTop: 14, marginBottom: 4 }}>HOW MANY</label>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <button onClick={() => setCount(Math.max(1, count - 1))} style={stepBtn}>−</button>
              <span style={{ fontFamily: "var(--serif)", fontSize: 32, fontWeight: 800, minWidth: 30, textAlign: "center" }}>{count}</span>
              <button onClick={() => setCount(Math.min(8, count + 1))} style={stepBtn}>+</button>
              <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 11 }}>${total}.00</span>
            </div>
            <button
              onClick={() => setStep(1)}
              style={{ marginTop: 22, width: "100%", padding: 14, border: "2px solid var(--ink)", background: "var(--cobalt)", color: "var(--cream)", fontFamily: "var(--sans)", fontWeight: 700, fontSize: 12, letterSpacing: "0.12em", textTransform: "uppercase", cursor: "pointer" }}
            >
              Reserve · ${total}.00
            </button>
          </>
        )}
        {step === 1 && (
          <div style={{ textAlign: "center", padding: "12px 0" }}>
            <div style={{ fontFamily: "var(--arabic-display)", fontSize: 64, color: "var(--cobalt)", direction: "rtl", lineHeight: 1 }}>أهلاً</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 36, fontWeight: 800, lineHeight: 1, marginTop: 8 }}>SEE YOU THERE,</div>
            <div style={{ fontFamily: "var(--serif)", fontSize: 36, fontWeight: 800, lineHeight: 1 }}>{name.toUpperCase() || "HABIBI"}</div>
            <div style={{ fontFamily: "var(--mono)", fontSize: 11, margin: "16px 0", letterSpacing: "0.1em" }}>
              CONFIRMATION SENT TO {email || "YOUR INBOX"}
            </div>
            <div style={{ borderTop: "2px dashed var(--ink)", paddingTop: 14, fontFamily: "var(--mono)", fontSize: 10 }}>
              CK-{(Math.random() * 9000 + 1000).toFixed(0)} · {count} SEAT{count > 1 ? "S" : ""}
            </div>
            <button onClick={onClose} className="btn" style={{ marginTop: 18 }}>Close</button>
          </div>
        )}
      </div>
    </div>
  );
}
const inputStyle = {
  width: "100%",
  padding: "10px 12px",
  border: "2px solid var(--ink)",
  background: "transparent",
  fontFamily: "var(--sans)",
  fontSize: 14,
  outline: "none",
};
const stepBtn = {
  width: 36, height: 36, border: "2px solid var(--ink)", background: "var(--cream)", fontSize: 18, cursor: "pointer", fontFamily: "var(--serif)",
};

// ---------- AUDIO TOGGLE (decorative; no real audio) ----------
function AudioToggle({ position = { bottom: 18, left: 18 } }) {
  const [on, setOn] = useState(false);
  return (
    <button
      onClick={() => setOn(!on)}
      title="Tarab radio"
      style={{
        position: "absolute",
        ...position,
        zIndex: 60,
        width: 64, height: 64,
        border: "2px solid var(--ink)",
        borderRadius: "50%",
        background: on ? "var(--sun)" : "var(--cream)",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexDirection: "column",
        animation: on ? "spin 4s linear infinite" : "none",
        fontFamily: "var(--mono)", fontSize: 9, letterSpacing: "0.08em",
      }}
    >
      <div style={{ fontSize: 18 }}>{on ? "♫" : "♪"}</div>
      <div>{on ? "ON" : "TARAB"}</div>
    </button>
  );
}

// CursorSticker removed — was a corny click toy.
function CursorSticker() { return null; }

Object.assign(window, { HalftonePortrait, Grain, Marquee, RegMark, KadhemLockup, RSVPModal, AudioToggle, CursorSticker });
