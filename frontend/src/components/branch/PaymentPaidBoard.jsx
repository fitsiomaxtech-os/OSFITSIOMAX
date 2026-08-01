import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Eye, ChevronDown, ChevronRight, Printer, FileSpreadsheet, CheckCircle2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const formatMode = (mode) => (mode ? (mode === "upi" ? "UPI" : mode.charAt(0).toUpperCase() + mode.slice(1)) : "—");

const PAYMENT_MODE_STYLES = {
  cash: "bg-emerald-50 text-emerald-700 border-emerald-200",
  upi: "bg-sky-50 text-sky-700 border-sky-200",
  card: "bg-violet-50 text-violet-700 border-violet-200",
  cheque: "bg-amber-50 text-amber-700 border-amber-200",
  partial: "bg-orange-50 text-orange-700 border-orange-200",
};

// Same custom open-list dropdown the sibling boards use — a native <select> can't
// colour its individual options reliably across browsers.
const ColorFilterDropdown = ({ value, options, onChange, testId }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-9 items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold ${current?.classes || "border-slate-200 bg-white text-slate-700"}`}
        data-testid={testId}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 z-20 mt-1 max-h-64 min-w-[170px] space-y-1 overflow-y-auto rounded-md border border-slate-200 bg-white p-1.5 shadow-lg" data-testid={`${testId}-list`}>
          {options.map((o) => (
            <button
              key={o.value}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full whitespace-nowrap rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${o.classes}`}
              data-testid={`${testId}-option-${o.value}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const SummaryCard = ({ label, value, color }) => (
  <div className="rounded-xl border bg-white p-4 shadow-sm" style={{ borderLeftColor: color, borderLeftWidth: 4 }}>
    <p className="text-xs text-slate-500">{label}</p>
    <p className="mt-1 text-2xl font-bold" style={{ color }}>{value}</p>
  </div>
);

const toCsv = (rows) => {
  const header = ["S.No", "Client", "Phone", "Branch", "Consultation Paid", "Session Paid", "Total Paid", "Last Payment", "Payment Mode"];
  const lines = rows.map((r, i) => [
    i + 1, r.client_name, r.phone || "", r.branch_name || "",
    r.consultation_paid, r.session_paid, r.total_paid,
    r.last_date || "", r.modes.map(formatMode).join(" / "),
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [header.join(","), ...lines].join("\n");
};

const downloadCsv = (rows) => {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payment-paid-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Accountant Manage > Payment Paid — the settled side of the ledger, and the exact
 * mirror of Outstanding Amount: every client whose money is fully in, with nothing
 * left owing. Rows are rolled up per client from the same transactions the other
 * boards read, so a client appears here the moment their last balance clears —
 * including clients who paid the whole package up front and so never had an
 * installment schedule at all.
 */
export const PaymentPaidBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [mode, setMode] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [expanded, setExpanded] = useState(null);

  const filtered = useMemo(() => rows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(r.client_name || "").toLowerCase().includes(q) && !(r.phone || "").includes(q)) return false;
    }
    if (mode !== "all" && !r.modes.includes(mode)) return false;
    if (minAmount && r.total_paid < Number(minAmount)) return false;
    if (maxAmount && r.total_paid > Number(maxAmount)) return false;
    return true;
  }), [rows, search, mode, minAmount, maxAmount]);

  const totals = useMemo(() => filtered.reduce((acc, r) => ({
    consultation_paid: acc.consultation_paid + (r.consultation_paid || 0),
    session_paid: acc.session_paid + (r.session_paid || 0),
    total_paid: acc.total_paid + (r.total_paid || 0),
  }), { consultation_paid: 0, session_paid: 0, total_paid: 0 }), [filtered]);

  return (
    <div className="space-y-4" data-testid="payment-paid-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Received" value={fmt(totals.total_paid)} color="#059669" />
        <SummaryCard label="Consultation Paid" value={fmt(totals.consultation_paid)} color="#0284c7" />
        <SummaryCard label="Session Paid" value={fmt(totals.session_paid)} color="#7c3aed" />
        <SummaryCard label="Fully Paid Clients" value={filtered.length} color="#059669" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or phone..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="payment-paid-search"
          />
          <ColorFilterDropdown
            value={mode}
            options={[
              { value: "all", label: "All Payment Modes", classes: "border-slate-200 bg-white text-slate-700" },
              { value: "cash", label: "Cash", classes: PAYMENT_MODE_STYLES.cash },
              { value: "upi", label: "UPI", classes: PAYMENT_MODE_STYLES.upi },
              { value: "card", label: "Card", classes: PAYMENT_MODE_STYLES.card },
              { value: "cheque", label: "Cheque", classes: PAYMENT_MODE_STYLES.cheque },
              { value: "partial", label: "Partial Payment", classes: PAYMENT_MODE_STYLES.partial },
            ]}
            onChange={setMode}
            testId="payment-paid-mode-filter"
          />
          <input
            type="number" value={minAmount} onChange={(e) => setMinAmount(e.target.value)}
            placeholder="Min amount" className="h-9 w-28 rounded-md border border-slate-200 px-2 text-sm"
          />
          <input
            type="number" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)}
            placeholder="Max amount" className="h-9 w-28 rounded-md border border-slate-200 px-2 text-sm"
          />
          <div className="ml-auto flex gap-2">
            <button
              type="button" onClick={() => downloadCsv(filtered)}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid="payment-paid-export-csv"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
            </button>
            <button
              type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid="payment-paid-print"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-payment-paid">
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" /> Payment Paid
          </p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[4%] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400"></th>
                  <th className="w-[5%] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[17%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Consultation</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Session</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Paid</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Last Payment</th>
                  <th className="w-[6%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[6%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-400">No fully paid clients yet.</td></tr>
                ) : filtered.map((r, i) => (
                  <Fragment key={r.lead_id}>
                    <tr data-testid={`accountant-manage-payment-paid-${r.lead_id}`}>
                      <td className="rounded-l-[5px] border-y border-l border-emerald-200 bg-emerald-50/40 px-2 py-2 text-center">
                        <button type="button" onClick={() => setExpanded(expanded === r.lead_id ? null : r.lead_id)} className="text-emerald-500 hover:text-emerald-800">
                          {expanded === r.lead_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-2 py-2 text-center text-slate-400">{i + 1}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center text-slate-600">{r.phone || "—"}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center text-slate-600">{r.branch_name || "—"}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center text-slate-700">{r.consultation_paid ? fmt(r.consultation_paid) : "—"}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center text-slate-700">{r.session_paid ? fmt(r.session_paid) : "—"}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center font-bold text-emerald-700">{fmt(r.total_paid)}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center text-slate-600">{r.last_date || "—"}</td>
                      <td className="border-y border-emerald-200 bg-emerald-50/40 px-3 py-2 text-center">
                        <span className="inline-flex items-center rounded-[5px] border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700">PAID</span>
                      </td>
                      <td className="rounded-r-[5px] border-y border-r border-emerald-200 bg-emerald-50/40 px-3 py-2">
                        <div className="flex items-center justify-center">
                          <button type="button" onClick={() => onView && onView(r.lead_id)} title="View Details" className="rounded p-1 text-emerald-500 hover:bg-emerald-100 hover:text-emerald-700">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === r.lead_id && (
                      <tr>
                        <td colSpan={11} className="border-x border-b border-emerald-200 bg-emerald-50/30 p-0">
                          {/* Already loaded with the overview — no extra fetch to see the
                              individual payments that add up to this client's total. */}
                          <div className="space-y-1.5 px-4 py-3">
                            {r.txns.map((tx) => (
                              <div key={tx.id} className="flex items-center justify-between rounded-lg border border-emerald-100 bg-white px-3 py-1.5 text-xs">
                                <span className="capitalize text-slate-600">{tx.source} · <span className="normal-case">{formatMode(tx.payment_mode)}</span></span>
                                <span className="text-slate-400">{(tx.date || "").slice(0, 10)}</span>
                                <span className="font-semibold text-emerald-600">{fmt(tx.gross)}</span>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={5} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Totals</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-slate-700">{fmt(totals.consultation_paid)}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-slate-700">{fmt(totals.session_paid)}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-emerald-700">{fmt(totals.total_paid)}</td>
                    <td colSpan={3}></td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default PaymentPaidBoard;
