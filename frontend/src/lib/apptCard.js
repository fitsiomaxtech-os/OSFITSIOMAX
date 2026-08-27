// The appointment confirmation drawn as a PNG, so it can be sent as a real image
// attachment the way a payment app sends its receipt — picture first, message under it.
//
// Drawn on a canvas rather than screenshotting the DOM: no extra dependency, and the
// output is identical on every device instead of inheriting whatever the browser did
// with the page's fonts and layout.
//
// The content is deliberately a note to the patient rather than a field dump — their
// own copy doesn't need their phone number read back to them, it needs the day, the
// place, and a line telling them they're in hand.
import { LOGO_URL } from "@/lib/printable";
import { to12h, endTime12h } from "@/lib/time";

const W = 720;
const PAD = 40;
const HEADER_H = 108;
const TEAL = "#0d9488";
const TEAL_DARK = "#0f766e";
const ROSE = "#e11d48";
const ROSE_DARK = "#be123c";

export const REASSURANCE = "We understand the pain you are going through. Don't worry — our team is here to consult with you and see you through it.";

const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
  : "—");

const roundRect = (ctx, x, y, w, h, r) => {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
};

/** Greedy wrap — returns the lines so height can be measured before anything is drawn. */
const wrapLines = (ctx, text, maxWidth) => {
  const out = [];
  let line = "";
  String(text || "").split(/\s+/).filter(Boolean).forEach((word) => {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) { out.push(line); line = word; }
    else line = next;
  });
  if (line) out.push(line);
  return out;
};

/** The same job for a string with nothing to break at — a URL is one word, and wrapLines
 *  hands it back whole however long it is, which then draws straight off the card. Broken
 *  by character instead, which is ugly on prose and the only option on an address. */
const wrapAnywhere = (ctx, text, maxWidth) => {
  const out = [];
  let line = "";
  for (const ch of String(text || "")) {
    if (line && ctx.measureText(line + ch).width > maxWidth) { out.push(line); line = ch; }
    else line += ch;
  }
  if (line) out.push(line);
  return out;
};

/** crossOrigin="anonymous" makes a logo the CDN won't share simply fail to load rather
 *  than silently tainting the canvas — a tainted canvas throws on toBlob, which would
 *  break the share entirely. A null here just means the monogram is drawn instead. */
const loadLogo = () => new Promise((resolve) => {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = () => resolve(img);
  img.onerror = () => resolve(null);
  img.src = LOGO_URL;
});

/**
 * Renders the confirmation and resolves with a PNG Blob.
 * `a` is the same object the on-screen confirmation popup is built from.
 */
export const apptCardPng = async (a) => {
  const cancelled = Boolean(a.cancelled);
  const accent = cancelled ? ROSE : TEAL;
  const accentDark = cancelled ? ROSE_DARK : TEAL_DARK;
  const when = `${to12h(a.time)} to ${endTime12h(a.time, a.duration)}`;
  const inner = W - PAD * 2;

  // Measured on a throwaway context so the canvas can be sized before it's created.
  const probe = document.createElement("canvas").getContext("2d");
  const font = (size, weight = "400") => `${weight} ${size}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`;
  probe.font = font(17);
  const noteLines = cancelled ? [] : wrapLines(probe, REASSURANCE, inner - 32);
  // Where the patient is being asked to be. A meeting link answers that instead of the
  // branch, and replaces it rather than joining it: the card is pasted into the same chat
  // as the message, so a branch address printed under a video appointment contradicts the
  // words directly above it. The scheme is dropped because it is the one part of a URL
  // nobody reads and it costs a line at this width.
  const meetLink = String(a.meetLink || "").trim();
  const placeLabel = meetLink ? "GOOGLE MEET" : "LOCATION";
  const addrLines = meetLink
    ? wrapAnywhere(probe, meetLink.replace(/^https?:\/\//, ""), inner - 90)
    : a.branchAddress ? wrapLines(probe, a.branchAddress, inner - 90) : [];

  const HERO_H = 196;
  const GREET_H = 44;
  const NOTE_H = cancelled ? 58 : 26 + noteLines.length * 26 + 30;
  const FACT_H = 40;
  const facts = [["CONSULTANT", a.headPhysio], ...(a.refNo ? [["Reference", a.refNo]] : [])];
  const ADDR_H = addrLines.length ? 22 + addrLines.length * 24 + 14 : 0;
  const H = HEADER_H + PAD + HERO_H + 26 + GREET_H + NOTE_H + 14 + facts.length * FACT_H + ADDR_H + PAD + 40;

  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // ---- Header
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, HEADER_H);

  const logo = await loadLogo();
  const box = 60;
  const lx = PAD;
  const ly = (HEADER_H - box) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(ctx, lx, ly, box, box, 12);
  ctx.fill();
  if (logo) {
    ctx.drawImage(logo, lx + 6, ly + 6, box - 12, box - 12);
  } else {
    ctx.fillStyle = accent;
    ctx.font = font(30, "800");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("F", lx + box / 2, ly + box / 2 + 1);
    ctx.textBaseline = "alphabetic";
  }

  ctx.textAlign = "left";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(26, "700");
  ctx.fillText(cancelled ? "Appointment Cancelled" : "Appointment Confirmed", lx + box + 18, HEADER_H / 2 - 2);
  ctx.fillStyle = "rgba(255,255,255,0.85)";
  ctx.font = font(15);
  ctx.fillText("FITSIOMAX · Physiotherapy & Rehabilitation", lx + box + 18, HEADER_H / 2 + 24);

  // ---- Hero: the day, the hours, the place
  let y = HEADER_H + PAD;
  ctx.fillStyle = cancelled ? "#fff1f2" : "#f0fdfa";
  ctx.strokeStyle = cancelled ? "#fecdd3" : "#99f6e4";
  ctx.lineWidth = 2;
  roundRect(ctx, PAD, y, inner, HERO_H, 14);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  const cx = W / 2;
  ctx.fillStyle = accent;
  ctx.font = font(14, "700");
  ctx.fillText("YOUR APPOINTMENT", cx, y + 38);
  ctx.fillStyle = accentDark;
  ctx.font = font(30, "800");
  ctx.fillText(weekdayLabel(a.date), cx, y + 84);
  ctx.font = font(25, "700");
  ctx.fillText(when, cx, y + 122);
  if (a.branch) {
    ctx.fillStyle = accent;
    ctx.font = font(18, "600");
    ctx.fillText(`at ${a.branch}`, cx, y + 158);
  }

  y += HERO_H + 26;

  // ---- Greeting
  ctx.textAlign = "left";
  ctx.fillStyle = "#0f172a";
  ctx.font = font(21, "700");
  ctx.fillText(`Hi ${a.patient},`, PAD, y + 22);
  y += GREET_H;

  // ---- The reassurance the note is really for
  if (cancelled) {
    ctx.fillStyle = "#fff1f2";
    ctx.strokeStyle = "#fecdd3";
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y, inner, 46, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ROSE_DARK;
    ctx.font = font(15, "600");
    ctx.fillText("This appointment has been cancelled. Please contact the branch.", PAD + 16, y + 29);
    y += NOTE_H;
  } else {
    const boxH = 20 + noteLines.length * 26 + 16;
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y, inner, boxH, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#475569";
    ctx.font = font(17);
    noteLines.forEach((ln, i) => ctx.fillText(ln, PAD + 16, y + 34 + i * 26));
    ctx.fillStyle = TEAL;
    ctx.font = font(15, "700");
    ctx.textAlign = "right";
    ctx.fillText("— Team Fitsiomax", W - PAD - 16, y + boxH + 22);
    ctx.textAlign = "left";
    y += NOTE_H;
  }

  y += 14;

  // ---- Head Physio / reference
  facts.forEach(([k, v]) => {
    ctx.fillStyle = "#64748b";
    ctx.font = font(16);
    ctx.fillText(k, PAD, y + 22);
    ctx.fillStyle = "#1e293b";
    ctx.font = font(16, "700");
    ctx.textAlign = "right";
    ctx.fillText(String(v), W - PAD, y + 22);
    ctx.textAlign = "left";
    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y + FACT_H - 6);
    ctx.lineTo(W - PAD, y + FACT_H - 6);
    ctx.stroke();
    y += FACT_H;
  });

  // ---- Where to come
  if (addrLines.length) {
    ctx.fillStyle = "#64748b";
    ctx.font = font(13, "700");
    ctx.fillText(placeLabel, PAD, y + 20);
    ctx.fillStyle = "#475569";
    ctx.font = font(16);
    addrLines.forEach((ln, i) => ctx.fillText(ln, PAD, y + 44 + i * 24));
  }

  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = font(14);
  ctx.fillText(meetLink ? "Please join the meeting 5 minutes early" : "Please arrive 10 minutes early", cx, H - 20);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the card"))), "image/png");
  });
};
