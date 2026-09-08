// The appointment confirmation — the sheet the patient is given, and the four ways it
// leaves the room. Opening it as a printable, sharing it, WhatsApping it and saving it all
// render the exact same document.
//
// Lifted out of BranchAdminBoard, which is where it was written and for a while the only
// screen that could raise it: it appeared once, on the booking, and was gone the moment it
// was dismissed. A patient who lost the message had nothing to be sent again. It is a
// component now so the Consultations board can hand the same card back off the record,
// which is the whole point — the second copy has to be the first copy, not a redrawing of
// it that differs in some detail the patient then queries.
import { CheckCircle2, Download, Printer, Share2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { WhatsAppIcon } from "@/components/ui/whatsapp-icon";
import { apptCardPng, REASSURANCE } from "@/lib/apptCard";
import { waNumber } from "@/lib/phone";
import { isHandheld } from "@/lib/receipt";
import { LOGO_URL, PRINTABLE_STYLES, escapeHtml, rowsHtml, openPrintable } from "@/lib/printable";
import { to12h, endTime12h } from "@/lib/time";

/** "2026-08-05" -> "05 - 08 - 2026" */
const dmyLabel = (d) => {
  const [y, m, day] = String(d || "").split("-");
  return y && m && day ? `${day} - ${m} - ${y}` : d || "—";
};
/** "2026-08-05" -> "Wednesday, 5 August" */
const weekdayLabel = (d) => (d
  ? new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" })
  : "—");
/** "2026-08-19" -> "Wednesday 19-08-2026". The popup hero only; the printed sheet and the
 *  card keep the spelled-out month, which reads better on paper and cannot be mistaken for
 *  month-first by a patient reading it. */
const weekdayDmy = (d) => {
  const [y, m, day] = String(d || "").split("-");
  if (!y || !m || !day) return d || "—";
  const weekday = new Date(`${d}T00:00:00`).toLocaleDateString("en-US", { weekday: "long" });
  return `${weekday} ${day}-${m}-${y}`;
};

// `compact` drops the three facts the confirmation's own hero already states in bigger
// type — the on-screen popup shows that hero, so repeating them underneath is noise. The
// printed sheet keeps them, where the row list has to stand on its own as the record.
export const apptRows = (a, { compact = false } = {}) => [
  ["Reference No.", a.refNo],
  ["Patient", a.patient],
  ["Patient No.", a.patientNo],
  ["Phone", a.phone],
  compact ? null : ["Date", dmyLabel(a.date)],
  compact ? null : ["Time", `${to12h(a.time)} – ${endTime12h(a.time, a.duration)}`],
  // Popup drops it: the sheet is the record and still carries it, but on screen the
  // start time is what the patient is told and a length beside it invites the question.
  compact ? null : ["Duration", `${a.duration} minutes`],
  compact ? null : ["CONSULTANT", a.headPhysio],
  a.branch ? ["Branch", a.branch] : null,
  // Where an online appointment actually happens, so the sheet the patient keeps carries
  // it as plainly as a branch name. Kept in the compact popup too, unlike Date and Time
  // above: those are dropped because the card overhead already shouts them, and this one
  // appears nowhere else on that screen.
  a.meetLink ? ["Google Meet", a.meetLink] : null,
  ["Booked By", a.bookedBy],
];

/**
 * Puts the card PNG on the system clipboard.
 *
 * Safari only honours a ClipboardItem built around an unresolved promise — awaiting the
 * blob first spends the user gesture and the write is refused. Chrome accepts both, so
 * the promise form is tried first and the resolved form is the fallback for anything
 * that rejects it. A false return is not an error: the message still sends, it just
 * arrives without the picture.
 */
const copyCardToClipboard = async (a) => {
  if (!navigator.clipboard?.write || typeof ClipboardItem === "undefined") return false;
  try {
    await navigator.clipboard.write([new ClipboardItem({ "image/png": apptCardPng(a) })]);
    return true;
  } catch {
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await apptCardPng(a) })]);
      return true;
    } catch {
      return false;
    }
  }
};

// Above the two senders that call them. A const is not hoisted, so the pair only start
// existing at the line they are written on, and that line was below both callers.
export const downloadApptCard = async (a, prebuilt) => {
  try {
    const blob = prebuilt || await apptCardPng(a);
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `appointment-${a.refNo || "confirmation"}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch {
    toast.error("Couldn't build the card image");
  }
};

/** The confirmation as a note to the patient — the day, the hours, the place, and a line
 *  telling them they're in hand. Short lines, because it is read on a phone in WhatsApp.
 *
 *  Where the appointment carries a meeting link, the place is that link and the message
 *  says so instead of naming a branch. The two endings are exclusive on purpose rather
 *  than the link being one more line on the old one: an address, a map pin and "arrive 10
 *  minutes early" tell a patient to travel, and a patient told to travel to a video call
 *  either goes to a branch that is not expecting them or reads the message as a mistake
 *  and asks. The room is where they are being asked to be, so it is the only place named. */
export const apptMessage = (a) => {
  const meet = (a.meetLink || "").trim();
  const lines = [
    `Hi ${a.patient},`,
    "",
    "Your appointment is",
    weekdayLabel(a.date),
    `${to12h(a.time)} to ${endTime12h(a.time, a.duration)}`,
  ];
  // Online is a mode, not a branch, so the branch line goes with the rest of the room.
  if (a.branch && !meet) lines.push(`at ${a.branch}`);
  if (meet) lines.push("online, on Google Meet");
  lines.push("", REASSURANCE, "— Team Fitsiomax", "", `CONSULTANT: ${a.headPhysio}`);
  if (a.notes) lines.push(`Notes: ${a.notes}`);
  if (meet) {
    lines.push("", "Join here:", meet, "", "Please join 5 minutes early.");
    return lines.join("\n");
  }
  if (a.branchAddress) lines.push("", `Location: ${a.branchAddress}`);
  if (a.mapLocation) lines.push(a.mapLocation);
  lines.push("", "Please arrive 10 minutes early.");
  return lines.join("\n");
};

/**
 * Opens WhatsApp on the patient's own number with the confirmation already typed, and
 * leaves the card image on the clipboard so it can be pasted in on top.
 *
 * The split is forced by WhatsApp, not chosen: wa.me is the only route that addresses a
 * specific number and it carries text only, while the share sheet is the only route that
 * carries an attachment and it always asks who it is for. The clipboard bridges them —
 * pasting into the chat attaches the card and WhatsApp moves the typed text down into
 * its caption, which is the picture-above/words-below shape the branch is after.
 *
 * Resolves true when the card made it to the clipboard. Both outcomes are reported here,
 * so callers need not.
 */
export const sendApptOnWhatsApp = async (a) => {
  const num = waNumber(a.phone);
  if (!num) { toast.error("This patient has no phone number on file"); return false; }

  // The tab has to be claimed here, synchronously, while the click is still the reason
  // anything is happening — after the await below the gesture is spent and the popup
  // blocker takes it. Opened blank and pointed at WhatsApp once the card is copied.
  // noopener isn't passed because it makes window.open return null; opener is cleared
  // by hand instead, which buys the same protection while keeping the handle.
  const tab = isHandheld() ? null : window.open("", "_blank");
  if (tab) tab.opener = null;

  const copied = await copyCardToClipboard(a);
  // Both outcomes are worth saying, since the popup itself no longer explains the paste.
  // On desktop WhatsApp takes its own tab, so this is still on screen when the branch
  // looks back at the board; on a phone the page navigates away and neither would have
  // survived anyway.
  if (copied) toast.success("Card copied — paste it into the chat to send the picture");
  else toast.message("This browser can't copy the card — use Send Card + Message for the image");
  const url = `https://wa.me/${num}?text=${encodeURIComponent(apptMessage(a))}`;

  if (tab && !tab.closed) {
    // Desk: WhatsApp Web gets its own tab and the board stays where it was, so the
    // "now paste it" prompt is still on screen when the branch looks back.
    tab.location.href = url;
  } else {
    // Phone: same-tab, not window.open(..., "_blank") — that hands mobile browsers an
    // ambiguous new-tab context and often leaves the app on a blank white screen once
    // WhatsApp gives control back (caf18a6, same fix on the Physio board).
    window.location.href = url;
  }
  return copied;
};

/** The card image plus the message, through the OS share sheet — the only path that can
 *  carry an attachment, at the cost of picking the recipient there. */
export const shareApptCard = async (a) => {
  try {
    const blob = await apptCardPng(a);
    const file = new File([blob], `appointment-${a.refNo || "confirmation"}.png`, { type: "image/png" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text: apptMessage(a) });
      return;
    }
    downloadApptCard(a, blob);
    toast.success("Card saved — attach it to your message");
  } catch (err) {
    if (err?.name === "AbortError") return;  // the user closed the share sheet
    toast.error("Couldn't build the card image");
  }
};

/** The card on its own, for attaching by hand where the share sheet isn't available. */
export const apptHtml = (a) => `<!doctype html><html><head><meta charset="utf-8">
<title>Appointment ${escapeHtml(a.refNo)}</title><style>${PRINTABLE_STYLES}</style></head>
<body><div class="wrap">
  <div class="head">
    <img class="logo" src="${LOGO_URL}" alt="FITSIOMAX">
    <div>
      <div class="brand">FITSIOMAX</div>
      <div class="sub">${escapeHtml(a.branch || "Physiotherapy & Rehabilitation")}</div>
    </div>
  </div>
  <div class="tag tag-appt">APPOINTMENT CONFIRMED</div>
  <hr>
  <div class="amt-label">Your Appointment</div>
  <div class="amt amt-appt">${escapeHtml(weekdayLabel(a.date))}<br>${escapeHtml(to12h(a.time))}</div>
  <hr>
  ${rowsHtml(apptRows(a))}
  ${a.notes ? `<div class="note"><b>Notes</b><br>${escapeHtml(a.notes)}</div>` : ""}
  <div class="note">${a.meetLink ? "Please join the meeting 5 minutes early." : "Please arrive 10 minutes early."} To reschedule or cancel, contact the branch
  quoting reference ${escapeHtml(a.refNo)}.</div>
  <hr>
  <div class="foot">This is a computer-generated confirmation and needs no signature.<br>Thank you for choosing FITSIOMAX.</div>
</div></body></html>`;

/**
 * The confirmation on screen.
 *
 * `appt` is the object the booking builds and the reissue endpoint returns; nothing is
 * drawn while it is null, so a caller can hold the state and mount this unconditionally.
 * `onClose` runs on both the X and the backdrop-free header button — the booking flow uses
 * it to release the card and then move the lead on, a reissue only to dismiss it.
 */
export function AppointmentConfirmCard({ appt, onClose, testid = "branch-appt-confirm" }) {
  if (!appt) return null;
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-3" data-testid={`${testid}-modal`}>
      {/* 90%, this dialog only. zoom rather than transform: scale — zoom shrinks the
          layout box itself, so the flex centring above and the max-h below still work
          on the size actually drawn. scale would leave the box at full size, centring
          the card off its own bounds and reserving space nothing occupies. */}
      <div
        className="flex max-h-[94vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        style={{ zoom: 0.9 }}
      >
        {/* The receipt popup's header. items-center so the two-line title does not
            leave a band of empty teal beneath it, a status mark rather than the logo
            (which already opens the body), and a plain close — the orange-bordered X
            read as a warning on a dialog that only confirms. */}
        <div className="flex shrink-0 items-center justify-between gap-3 bg-teal-600 px-4 py-3 text-white">
          <div className="flex min-w-0 items-center gap-2.5">
            <CheckCircle2 className="h-7 w-7 shrink-0" />
            <div className="min-w-0">
              <p className="text-base font-bold leading-tight">Appointment Confirmed</p>
              <p className="truncate text-xs text-white/80">Ref {appt.refNo}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-full p-1.5 text-white/80 hover:bg-white/20"
            aria-label="Close"
            data-testid={`${testid}-close`}
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          <div className="rounded-xl border-2 border-teal-200 bg-teal-50 px-4 py-5 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-teal-600">Your Appointment</p>
            {/* Day and time on one line — they are read as one fact. Start only: a
                consultation runs as long as it needs to, so printing an end time
                promised something the branch cannot hold to. Wrapping is left on so a
                narrow phone drops the time to its own line rather than shrinking it. */}
            <p className="mt-1 flex flex-wrap items-baseline justify-center gap-x-3 gap-y-0.5 text-xl font-extrabold text-teal-700 sm:text-2xl">
              <span>{weekdayDmy(appt.date)}</span>
              <span className="text-lg sm:text-xl">{to12h(appt.time)}</span>
            </p>
            <p className="mt-1 text-sm font-semibold text-teal-600">with {appt.headPhysio}</p>
          </div>

          <dl className="mt-5 space-y-2 text-sm">
            {apptRows(appt, { compact: true }).filter(Boolean).map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 pb-2">
                <dt className="shrink-0 text-slate-500">{k}</dt>
                {/* break-words and min-w-0 for the meeting link, which is one
                    unbroken token long enough to push the row off its own card. */}
                <dd className="min-w-0 break-words text-right font-semibold text-slate-700">{v}</dd>
              </div>
            ))}
          </dl>

          {/* The two standing instructions, same wording the printed sheet carries.
              The first of them is about travelling to a branch, so an appointment held
              in a video room is told to join early instead — the same swap apptMessage
              makes, and for the same reason: nobody arrives anywhere for this one. */}
          <div className="mt-4 rounded-lg border border-teal-100 bg-teal-50/60 p-3 text-xs leading-relaxed text-teal-800" data-testid={`${testid}-note`}>
            <p>{appt.meetLink ? "Please join the meeting 5 minutes early." : "Please arrive 10 minutes early."}</p>
            <p>To reschedule or cancel, contact the branch quoting reference {appt.refNo}.</p>
          </div>

          {appt.notes && (
            <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Notes</p>
              <p className="mt-1 whitespace-pre-wrap text-sm text-slate-600">{appt.notes}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-slate-200 bg-slate-50 px-4 py-3">
          {/* Icons on one row, as the receipt popup does. Every label moves to title
              and aria-label rather than being dropped. Done goes with them: the header
              X runs the same close-and-move, so it was a second button for one action. */}
          <div className="flex items-center justify-center gap-2 pt-1 sm:gap-3">
            {/* A printer, matching the receipt popup's own first button. It opens the
                sheet with the print dialog already up, which is what a printer icon
                promises — the document glyph promised a file and delivered a print.
                Save-as-PDF still lives behind that dialog, so nothing is lost. */}
            <Button
              variant="outline"
              className="h-10 w-10 shrink-0 p-0"
              onClick={() => openPrintable(apptHtml(appt), { print: true })}
              title="Print"
              aria-label="Print"
              data-testid={`${testid}-pdf`}
            >
              <Printer className="h-4 w-4" />
            </Button>
            {/* The one the branch actually reaches for: straight to the patient's own
                number with the confirmation typed, card image on the clipboard. */}
            <Button
              className="h-10 w-10 shrink-0 bg-[#25D366] p-0 text-white hover:bg-[#1da851]"
              onClick={() => sendApptOnWhatsApp(appt)}
              title="Send on WhatsApp"
              aria-label="Send on WhatsApp"
              data-testid={`${testid}-whatsapp`}
            >
              <WhatsAppIcon className="h-4 w-4" />
            </Button>
            {/* The attachment route proper: the share sheet is the only thing that can
                carry a file, at the cost of asking who it is going to. */}
            <Button
              variant="outline"
              className="h-10 w-10 shrink-0 p-0"
              onClick={() => shareApptCard(appt)}
              title="Send Card + Message"
              aria-label="Send Card + Message"
              data-testid={`${testid}-share-card`}
            >
              <Share2 className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              className="h-10 w-10 shrink-0 p-0"
              onClick={() => downloadApptCard(appt)}
              title="Download Card"
              aria-label="Download Card"
              data-testid={`${testid}-download`}
            >
              <Download className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default AppointmentConfirmCard;
