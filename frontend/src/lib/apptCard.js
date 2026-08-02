// The appointment confirmation drawn as a PNG, so it can be sent as a real image
// attachment the way a payment app sends its receipt — picture first, message under it.
//
// Drawn on a canvas rather than screenshotting the DOM: no extra dependency, and the
// output is identical on every device instead of inheriting whatever the browser did
// with the page's fonts and layout.
import { LOGO_URL } from "@/lib/printable";
import { to12h, endTime12h } from "@/lib/time";

const W = 720;              // logical width; the bitmap is scaled up for retina
const PAD = 36;
const HEADER_H = 108;
const TEAL = "#0d9488";
const TEAL_DARK = "#0f766e";
const ROSE = "#e11d48";
const ROSE_DARK = "#be123c";

const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
  : "—");
const dmyLabel = (d) => {
  const [y, m, day] = String(d || "").split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d || "—";
};

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
  const when = `${to12h(a.time)} – ${endTime12h(a.time, a.duration)}`;

  const rows = [
    ["Reference No.", a.refNo || "—"],
    ["Patient", a.patient],
    ["Patient No.", a.patientNo],
    ["Phone", a.phone],
    ["Date", dmyLabel(a.date)],
    ["Time", when],
    ["Duration", `${a.duration} minutes`],
    ["Head Physio", a.headPhysio],
    ...(a.branch ? [["Branch", a.branch]] : []),
    ...(a.bookedBy ? [["Booked By", a.bookedBy]] : []),
  ];

  const HERO_H = 168;
  const ROW_H = 52;
  const NOTE_H = cancelled ? 64 : 0;
  const H = HEADER_H + PAD + HERO_H + 24 + rows.length * ROW_H + NOTE_H + PAD + 44;

  const dpr = 2;
  const canvas = document.createElement("canvas");
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const font = (size, weight = "400") => `${weight} ${size}px "Segoe UI", system-ui, -apple-system, Arial, sans-serif`;

  // Card
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  // Header
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, W, HEADER_H);

  const logo = await loadLogo();
  const logoBox = 60;
  const logoX = PAD;
  const logoY = (HEADER_H - logoBox) / 2;
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  roundRect(ctx, logoX, logoY, logoBox, logoBox, 12);
  ctx.fill();
  if (logo) {
    ctx.drawImage(logo, logoX + 6, logoY + 6, logoBox - 12, logoBox - 12);
  } else {
    ctx.fillStyle = accent;
    ctx.font = font(30, "800");
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("F", logoX + logoBox / 2, logoY + logoBox / 2 + 1);
  }

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#ffffff";
  ctx.font = font(26, "700");
  ctx.fillText(cancelled ? "Appointment Cancelled" : "Appointment Confirmed", logoX + logoBox + 18, HEADER_H / 2 - 2);
  if (a.refNo) {
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.font = font(15);
    ctx.fillText(`Ref ${a.refNo}`, logoX + logoBox + 18, HEADER_H / 2 + 24);
  }

  // Hero
  let y = HEADER_H + PAD;
  ctx.fillStyle = cancelled ? "#fff1f2" : "#f0fdfa";
  ctx.strokeStyle = cancelled ? "#fecdd3" : "#99f6e4";
  ctx.lineWidth = 2;
  roundRect(ctx, PAD, y, W - PAD * 2, HERO_H, 14);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = "center";
  const cx = W / 2;
  ctx.fillStyle = accent;
  ctx.font = font(14, "700");
  ctx.fillText("YOUR APPOINTMENT", cx, y + 38);
  ctx.fillStyle = accentDark;
  ctx.font = font(34, "800");
  ctx.fillText(weekdayLabel(a.date), cx, y + 84);
  ctx.font = font(25, "700");
  ctx.fillText(when, cx, y + 120);
  ctx.fillStyle = accent;
  ctx.font = font(17, "600");
  ctx.fillText(`with ${a.headPhysio}`, cx, y + 149);

  y += HERO_H + 24;

  // Detail rows
  ctx.textAlign = "left";
  rows.forEach(([k, v]) => {
    ctx.fillStyle = "#64748b";
    ctx.font = font(17);
    ctx.fillText(k, PAD, y + 30);

    ctx.fillStyle = "#1e293b";
    ctx.font = font(17, "700");
    ctx.textAlign = "right";
    ctx.fillText(String(v), W - PAD, y + 30);
    ctx.textAlign = "left";

    ctx.strokeStyle = "#f1f5f9";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, y + ROW_H - 6);
    ctx.lineTo(W - PAD, y + ROW_H - 6);
    ctx.stroke();

    y += ROW_H;
  });

  if (cancelled) {
    y += 8;
    ctx.fillStyle = "#fff1f2";
    ctx.strokeStyle = "#fecdd3";
    ctx.lineWidth = 1;
    roundRect(ctx, PAD, y, W - PAD * 2, 48, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = ROSE_DARK;
    ctx.font = font(15, "600");
    ctx.fillText("This appointment has been cancelled.", PAD + 16, y + 30);
    y += NOTE_H;
  }

  // Footer
  ctx.textAlign = "center";
  ctx.fillStyle = "#94a3b8";
  ctx.font = font(14);
  ctx.fillText("FITSIOMAX · Physiotherapy & Rehabilitation", cx, H - 22);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Could not render the card"))), "image/png");
  });
};
