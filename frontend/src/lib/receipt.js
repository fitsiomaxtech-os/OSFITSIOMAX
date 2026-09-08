// ---- Payment receipt ----------------------------------------------------------------
// The receipt is built as a standalone HTML document rather than printed from the page:
// window.print() on a board would send the whole board — modals, sidebar and all — to the
// printer, and the same document is what gets downloaded, so paper and file always match.
//
// Lifted out of ConsultationsBoard, which is where every one of these was written and for
// a while the only screen that could produce a receipt at all. Three screens can now: the
// fee cards on a patient reissue the one they were handed, the Accountant Manage desk
// reissues any collection on its ledger, and the collect popups still print the original.
// One copy of the document is what stops those three handing a patient three different
// pieces of paper for the same payment.
import { toast } from "@/components/ui/sonner";
import { waNumber } from "@/lib/phone";
import {
  LOGO_URL, PRINTABLE_STYLES, escapeHtml, openPrintable, downloadPrintable, sharePrintable,
} from "@/lib/printable";

// "split" is here and not on the collect popups' own lists on purpose: it is never a mode
// anyone picks, it is what the record says afterwards when a collection came in over more
// than one tender. A reissued receipt reads the stored mode back, so without this line a
// split payment printed the bare word "split" on the one row a patient checks.
export const ALL_PAYMENT_MODE_LABELS = { cash: "Cash", upi: "UPI", card: "Card", account_transfer: "Account Transfer", cheque: "Cheque", partial: "Partial Payment", split: "Split" };

/** Whatever identifies this payment with the bank — the thing a dispute is traced by. */
export const paymentReference = (p) => p.transfer_reference
  || p.upi_utr || p.upi_transaction_id
  || p.card_transaction_id
  || (p.cheque_number ? `Cheque ${p.cheque_number}${p.bank_name ? ` · ${p.bank_name}` : ""}` : "")
  // Cards taken before they stopped asking for the payer's bank details, which kept the
  // account's last four and no transaction id. Reprinting one of those receipts has to
  // still show what it showed the day it was handed over.
  || (p.account_number ? `Card ****${String(p.account_number).replace(/\D/g, "").slice(-4)}` : "");

// `kind: "schedule"` is a Partial Payment plan — the installments are agreed but no money
// has come in yet, so it must never print "Amount Paid" or "PAYMENT RECEIVED".
export const isSchedule = (r) => r.kind === "schedule";

// The receipt's own document content. The branding, styles and the open/print/download/
// share mechanics are shared with every other printable in lib/printable.js.
export const receiptRows = (r) => [
  [isSchedule(r) ? "Reference No." : "Transaction ID", r.receiptNo],
  ["Date", r.dateLabel],
  ["Patient", r.patient],
  ["Patient No.", r.patientNo],
  ["Phone", r.phone],
  r.branch ? ["Branch", r.branch] : null,
  [isSchedule(r) ? "Scheduled For" : "Paid For", r.paidFor],
  r.packageName ? ["Package", r.packageName] : null,
  r.sessionsCovered ? ["Sessions Covered", r.sessionsCovered] : null,
  ["Payment Mode", r.modeLabel],
  r.reference ? ["Reference", r.reference] : null,
  // Printed because the count is the half of a cash payment that can be checked against
  // a till later; the figure on its own cannot be.
  r.cashCounted ? ["Cash Counted", r.cashCounted] : null,
  r.originalAmount != null && r.originalAmount !== r.amount ? ["Original Price", `Rs.${r.originalAmount}`] : null,
  // The percentage alongside the rupees, so the receipt says how big the discount was and
  // not just how much came off. Omitted when there's no original price to measure against.
  r.discount
    ? ["Discount", r.originalAmount > 0
        ? `- Rs.${r.discount} (${Number(((r.discount / r.originalAmount) * 100).toFixed(2))}%)`
        : `- Rs.${r.discount}`]
    : null,
  [isSchedule(r) ? "Total Payable" : "Amount Paid", `Rs.${r.amount}`],
  r.balanceDue ? ["Balance Due", r.balanceDue] : null,
  [isSchedule(r) ? "Prepared By" : "Collected By", r.collectedBy],
].filter(Boolean);

/**
 * The shorter list the on-screen receipt shows. Deliberately not receiptRows.
 *
 * The printed bill and the shared text are records — they carry the branch, the package,
 * the mode, the original price and who collected it, because that is what a receipt has to
 * prove months later. The popup is an acknowledgement seen for a few seconds while the
 * patient is still standing there, and thirteen rows to confirm one payment is a wall to
 * read past rather than a confirmation.
 *
 * Everything dropped here is still on the bill, in the share text and in the download.
 * Money is not among it: the three figures sit in the block above this, larger.
 */
export const receiptPopupRows = (r) => [
  [isSchedule(r) ? "Reference No." : "Transaction ID", r.receiptNo],
  ["Date and Time", r.dateLabel],
  ["Patient Name", r.patient],
  ["Phone Number", r.phone],
  [isSchedule(r) ? "Scheduled For" : "Paid For", r.paidFor],
].filter(([, v]) => v);

export const receiptHtml = (r) => `<!doctype html><html><head><meta charset="utf-8">
<title>Receipt ${escapeHtml(r.receiptNo)}</title><style>${PRINTABLE_STYLES}</style></head>
<body><div class="wrap">
  <div class="head">
    <img class="logo" src="${LOGO_URL}" alt="FITSIOMAX">
    <div>
      <div class="brand">FITSIOMAX</div>
      <div class="sub">${escapeHtml(r.branch || "Physiotherapy & Rehabilitation")}</div>
    </div>
  </div>
  <div class="tag${isSchedule(r) ? " tag-sch" : ""}">${isSchedule(r) ? "PAYMENT SCHEDULE" : "PAYMENT RECEIVED"}</div>
  <hr>
  <div class="amt-label">${isSchedule(r) ? "Total Payable" : "Amount Paid"}</div>
  <div class="amt${isSchedule(r) ? " amt-sch" : ""}">Rs.${escapeHtml(r.amount)}</div>
  <hr>
  <table>${receiptRows(r).map(([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`).join("")}</table>
  ${(r.installments || []).length ? `<hr><div class="amt-label">Installments</div>
  <table>${r.installments.map((i, n) => `<tr><td class="k">#${n + 1}${i.sessions ? ` · ${escapeHtml(i.sessions)} sessions` : ""} · due ${escapeHtml(i.due_date || "—")}</td><td class="v">Rs.${escapeHtml(i.amount)}${i.paid ? " · PAID" : ""}</td></tr>`).join("")}</table>` : ""}
  <hr>
  <div class="foot">${isSchedule(r)
    ? "This is a payment schedule, not a receipt — no amount has been collected yet.<br>A receipt is issued for each installment when it is paid."
    : "This is a computer-generated receipt and needs no signature.<br>Thank you for choosing FITSIOMAX."}</div>
</div></body></html>`;

export const receiptText = (r) => [
  `FITSIOMAX — Payment Receipt`,
  ...receiptRows(r).map(([k, v]) => `${k}: ${v}`),
].join("\n");

export const printReceipt = (r) => openPrintable(receiptHtml(r), { print: true });
export const downloadReceipt = (r) => downloadPrintable(receiptHtml(r), `receipt-${r.receiptNo}.html`);
export const shareReceipt = (r) => sharePrintable(receiptText(r), `FITSIOMAX Receipt ${r.receiptNo}`);

/** A phone rather than a desk: the two need opposite handoffs, below. */
export const isHandheld = () => (typeof window !== "undefined"
  && (window.matchMedia?.("(pointer: coarse)").matches || navigator.maxTouchPoints > 0));

/**
 * Straight to the patient's own number with the receipt already typed.
 *
 * Share hands the text to whatever the OS offers and asks who it is going to; this skips
 * that, which is the whole point — the receipt is nearly always going to the person whose
 * number is already on it.
 */
export const whatsappReceipt = (r) => {
  const num = waNumber(r.phone);
  if (!num) { toast.error("This patient has no phone number on file"); return; }
  const url = `https://wa.me/${num}?text=${encodeURIComponent(receiptText(r))}`;
  if (isHandheld()) {
    // Same-tab on a phone. window.open with _blank hands mobile browsers an ambiguous
    // new-tab context and often leaves the app on a blank white screen once WhatsApp
    // gives control back — the same fix the appointment card needed (caf18a6).
    window.location.href = url;
    return;
  }
  // Desk: its own tab, so the board stays where it was. noopener isn't passed because it
  // makes window.open return null; the opener is cleared by hand for the same protection.
  const tab = window.open(url, "_blank");
  if (tab) tab.opener = null;
};

/**
 * A receipt rebuilt from one row of the finance ledger.
 *
 * The Accountant Manage desk works off `finance/revenue-overview`, which returns a
 * collection as money rather than as a patient: an amount, a mode, a transaction id, who
 * took it and when. That is nearly a receipt already — and crucially it carries the real
 * `created_at`, so a reissue from this desk is dated the day the money came in rather
 * than the day somebody asked for the paper again.
 *
 * What it cannot carry is the record behind the money — the package name, the cash
 * denominations, the bank reference, the installment schedule. Those live on the lead and
 * only the patient's own fee card can reach them, so a receipt reissued from here is the
 * shorter of the two on purpose rather than by omission.
 */
export const receiptFromTransaction = (tx) => {
  const amount = Number(tx.gross) || 0;
  const discount = Number(tx.discount) || 0;
  return {
    kind: "paid",
    receiptNo: tx.transaction_id || "—",
    // Written by the server when the money was taken. Falls back to nothing rather than
    // to today: a receipt that quietly dates itself to the reprint is worse than one that
    // admits the date is not on the record.
    dateLabel: tx.date
      ? new Date(tx.date).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })
      : "—",
    patient: tx.client_name || "—",
    patientNo: tx.patient_number || "—",
    phone: tx.phone || "—",
    branch: tx.branch_name || "",
    paidFor: tx.paidFor || "",
    packageName: tx.item_name || "",
    sessionsCovered: "",
    balanceDue: "",
    installments: [],
    amount,
    // A discount only means anything against the price it came off. The ledger carries
    // both, but `original_amount` is null on collections taken before it was recorded —
    // there the discount is dropped rather than printed against nothing.
    originalAmount: tx.original_amount != null ? Number(tx.original_amount) : null,
    discount: tx.original_amount != null && discount > 0 ? discount : null,
    modeLabel: ALL_PAYMENT_MODE_LABELS[tx.payment_mode] || tx.payment_mode || "—",
    reference: "",
    collectedBy: tx.collected_by || "Branch Admin",
    isCash: tx.payment_mode === "cash",
    cashCounted: "",
  };
};
