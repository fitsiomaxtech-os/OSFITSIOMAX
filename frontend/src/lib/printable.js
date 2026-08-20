// Branded documents the clinic hands to a client — payment receipts, appointment
// confirmations. Each is built as a standalone HTML document and opened in its own
// window rather than printed from the page: window.print() on the app would send the
// whole board, modals and all, to the printer. The same document is what Download saves
// and what Print renders, so screen, paper and file can never disagree.
import { toast } from "@/components/ui/sonner";

// The mark the login page and CRM header already use, so a printed sheet is recognisably
// the OS's.
export const LOGO_URL =
  "https://customer-assets.emergentagent.com/job_3d74aa9e-a241-4207-b148-2bbe29802707/artifacts/nozl77ti_Logo%20Icon.webp";

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

export const PRINTABLE_STYLES = `
  /* Its own font link. This is a standalone document opened in its own window, so the
     app's index.css never reaches it — without this the sheet falls back to Segoe UI and
     paper stops matching screen. Weights go to 800 because .brand, .amt and .tag all use
     it; requesting only the app's 500-700 would leave the browser synthesising the bold. */
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;500;600;700;800&display=swap');
  *{box-sizing:border-box}
  /* 88%, on the document rather than .wrap, so the page padding scales with the sheet.
     Segoe UI stays in the stack: a printer with no network still produces a receipt. */
  body{margin:0;padding:28px;zoom:.88;font-family:'Lexend','Segoe UI',Arial,sans-serif;color:#0f172a;background:#f1f5f9}
  .wrap{max-width:560px;margin:0 auto;border:1px solid #cbd5e1;border-radius:12px;padding:26px;background:#fff}
  .head{display:flex;align-items:center;gap:14px}
  .logo{width:52px;height:52px;object-fit:contain;border-radius:10px;flex:none}
  .brand{font-size:22px;font-weight:800;letter-spacing:.5px}
  .sub{font-size:12px;color:#64748b;margin-top:2px}
  .tag{display:inline-block;margin-top:12px;padding:5px 12px;border-radius:6px;
       background:#dcfce7;color:#15803d;font-size:12px;font-weight:800;letter-spacing:.6px}
  .tag-sch{background:#fef3c7;color:#b45309}
  .tag-appt{background:#ccfbf1;color:#0f766e}
  hr{border:0;border-top:1px dashed #cbd5e1;margin:18px 0}
  .amt-label{font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b}
  .amt{font-size:34px;font-weight:800;color:#15803d;margin-top:2px}
  .amt-sch{color:#b45309}
  .amt-appt{color:#0f766e;font-size:26px}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:6px}
  td{padding:7px 0;vertical-align:top}
  td.k{color:#64748b;width:45%}
  td.v{text-align:right;font-weight:600}
  .note{margin-top:16px;padding:12px 14px;border-radius:8px;background:#f8fafc;
        border:1px solid #e2e8f0;font-size:12px;color:#475569;line-height:1.6}
  .foot{margin-top:20px;font-size:11px;color:#94a3b8;text-align:center;line-height:1.6}
  @media print{body{padding:0;background:#fff}.wrap{border:none;border-radius:0}}
`;

/** Rows are [label, value] pairs; falsy entries are dropped so callers can inline conditions. */
export const rowsHtml = (rows) => `<table>${rows.filter(Boolean).map(
  ([k, v]) => `<tr><td class="k">${escapeHtml(k)}</td><td class="v">${escapeHtml(v)}</td></tr>`,
).join("")}</table>`;

/**
 * Opens the document in its own window.
 *
 * `print` also raises the print dialog — where the browser's own "Save as PDF" lives, so
 * this is the PDF path without shipping a PDF library. It waits for the logo before
 * printing: document.write returns immediately while the image is still loading, and
 * printing on a timer produces a sheet with a blank space where the logo should be, at
 * random. `load` fires even if the image fails, and the timeout covers it never resolving.
 */
export const openPrintable = (html, { print = false } = {}) => {
  const w = window.open("", "_blank", "width=720,height=860");
  if (!w) { toast.error("Allow pop-ups to open the document"); return null; }
  w.document.write(html);
  w.document.close();
  w.focus();
  if (!print) return w;
  let printed = false;
  const go = () => {
    if (printed) return;
    printed = true;
    try { w.print(); } catch { /* window was closed before printing */ }
  };
  if (w.document.readyState === "complete") go();
  else w.addEventListener("load", go, { once: true });
  setTimeout(go, 3000);
  return w;
};

export const downloadPrintable = (html, filename) => {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

// A cell that starts with one of these is executed as a formula when the sheet is opened,
// so a designation somebody typed as "-Senior Physio" would run rather than read. Prefixed
// with an apostrophe, which Excel strips on display and never evaluates.
const CSV_FORMULA_START = /^[=+\-@\t\r]/;

const csvCell = (value) => {
  const raw = value == null ? "" : String(value);
  const text = CSV_FORMULA_START.test(raw) ? `'${raw}` : raw;
  // Quoted only when it has to be, and an inner quote doubled, which is how CSV escapes it.
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/**
 * Rows of cells as a .csv, which Excel opens natively — no library, and no .xlsx writer to
 * carry for a two-column list.
 *
 * The byte-order mark is not decoration: without it Excel reads the file in the local
 * codepage and any name with an accent or a rupee sign arrives mangled. CRLF for the same
 * reason — it is what Excel writes, and what older versions expect to read.
 */
export const downloadCsv = (rows, filename) => {
  const body = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${body}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Native share sheet where the device has one; otherwise the text goes to the clipboard. */
export const sharePrintable = async (text, title) => {
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; }
    catch { return; } // dismissed the share sheet — not an error worth reporting
  }
  try {
    await navigator.clipboard.writeText(text);
    toast.success("Copied — paste it into WhatsApp or email");
  } catch {
    toast.error("Couldn't share on this device");
  }
};
