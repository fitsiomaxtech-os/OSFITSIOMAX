import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, ChevronDown, Printer, FileSpreadsheet, XCircle, AlarmClock, CalendarClock, Users } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { StatTile } from "@/components/ui/stat-tile";
import { RecordCards } from "@/components/branch/RecordCards";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

// The overview's status codes, re-labelled for this board. "partial" upstream just
// means "owes money, nothing scheduled or due further out" — on a row where not a
// rupee has come in, calling it Partial Paid would be plainly wrong, so it reads
// Not Paid here.
const STATUS_META = {
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_soon: { label: "Due Soon", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  partial: { label: "Not Paid", classes: "bg-slate-100 text-slate-600 border-slate-200" },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.partial;
  return (
    <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      {meta.label}
    </span>
  );
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

const SummaryCard = ({ label, ...rest }) => (
  <StatTile label={label} testid={`payment-unpaid-summary-${label.toLowerCase().replace(/\s+/g, "-")}`} {...rest} />
);

const toCsv = (rows) => {
  const header = ["S.No", "Client", "Phone", "Branch", "Total Bill", "Unpaid Amount", "Due Date", "Status"];
  const lines = rows.map((r, i) => [
    i + 1, r.client_name, r.phone || "", r.branch_name || "",
    r.total_bill, r.balance, r.due_date || "",
    (STATUS_META[r.status] || STATUS_META.partial).label,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [header.join(","), ...lines].join("\n");
};

const downloadCsv = (rows) => {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `payment-unpaid-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Accountant Manage > Payment Unpaid — the opposite end of Payment Paid: every
 * client who has been billed and has paid nothing at all, not one rupee in.
 *
 * This is deliberately narrower than Outstanding Amount, which lists anyone still
 * owing — a client who has paid four of six installments sits there, not here.
 * Payment Paid = all the money in, Payment Unpaid = none of it in, and Outstanding
 * Amount remains the superset covering everything in between. There is no expander
 * row for the same reason: these clients have no payment history to open.
 */
export const PaymentUnpaidBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");

  const today = todayIso();

  const filtered = useMemo(() => rows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(r.client_name || "").toLowerCase().includes(q) && !(r.phone || "").includes(q)) return false;
    }
    if (status !== "all" && r.status !== status) return false;
    if (minAmount && r.balance < Number(minAmount)) return false;
    if (maxAmount && r.balance > Number(maxAmount)) return false;
    return true;
  }), [rows, search, status, minAmount, maxAmount]);

  // Counts as well as sums, so each card's second line says how many clients it covers.
  const totals = useMemo(() => {
    const overdueRows = filtered.filter((r) => r.status === "overdue");
    const dueTodayRows = filtered.filter((r) => r.due_date === today);
    return {
      unpaid: filtered.reduce((s, r) => s + (r.balance || 0), 0),
      overdue: overdueRows.reduce((s, r) => s + (r.balance || 0), 0),
      overdueClients: overdueRows.length,
      dueToday: dueTodayRows.reduce((s, r) => s + (r.balance || 0), 0),
      dueTodayClients: dueTodayRows.length,
      clients: filtered.length,
    };
  }, [filtered, today]);

  const footer = useMemo(() => filtered.reduce((acc, r) => ({
    total_bill: acc.total_bill + (r.total_bill || 0),
    balance: acc.balance + (r.balance || 0),
  }), { total_bill: 0, balance: 0 }), [filtered]);

  return (
    <div className="space-y-4" data-testid="payment-unpaid-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Unpaid" value={fmt(totals.unpaid)} sub={plural(totals.clients, "client")} icon={XCircle} color="#e11d48" />
        <SummaryCard label="Overdue Amount" value={fmt(totals.overdue)} sub={plural(totals.overdueClients, "client")} icon={AlarmClock} color="#be123c" />
        <SummaryCard label="Due Today" value={fmt(totals.dueToday)} sub={plural(totals.dueTodayClients, "client")} icon={CalendarClock} color="#d97706" />
        <SummaryCard label="Unpaid Clients" value={totals.clients} sub="billed, nothing paid" icon={Users} color="#7c3aed" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or phone..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="payment-unpaid-search"
          />
          <ColorFilterDropdown
            value={status}
            options={[
              { value: "all", label: "All Statuses", classes: "border-slate-200 bg-white text-slate-700" },
              { value: "overdue", label: "Overdue", classes: STATUS_META.overdue.classes },
              { value: "due_soon", label: "Due Soon", classes: STATUS_META.due_soon.classes },
              { value: "partial", label: "Not Paid", classes: STATUS_META.partial.classes },
            ]}
            onChange={setStatus}
            testId="payment-unpaid-status-filter"
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
              data-testid="payment-unpaid-export-csv"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
            </button>
            <button
              type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid="payment-unpaid-print"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-payment-unpaid">
        <CardContent className="p-4">
          <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-rose-600">
            <XCircle className="h-3.5 w-3.5" /> Payment Unpaid
          </p>
          <RecordCards
            rows={filtered}
            empty="No unpaid clients — everyone billed has paid something."
            testid="payment-unpaid-cards"
            card={(r) => ({
              key: r.lead_id,
              testid: `accountant-manage-payment-unpaid-card-${r.lead_id}`,
              title: r.client_name,
              subtitle: r.phone || r.branch_name || "—",
              amount: (
                <>
                  <span className="block text-sm font-bold text-rose-700">{fmt(r.balance)}</span>
                  <span className="block text-[11px] text-slate-400">of {fmt(r.total_bill)}</span>
                </>
              ),
              meta: [
                <StatusBadge status={r.status} />,
                r.due_date ? `Due ${r.due_date}` : null,
              ],
              onOpen: onView ? () => onView(r.lead_id) : undefined,
            })}
          />

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[54rem] table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[5%] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[19%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[13%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Bill</th>
                  <th className="w-[12%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Unpaid Amount</th>
                  <th className="w-[11%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[7%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={9} className="px-3 py-8 text-center text-sm text-slate-400">No unpaid clients — everyone billed has paid something.</td></tr>
                ) : filtered.map((r, i) => (
                  <tr key={r.lead_id} data-testid={`accountant-manage-payment-unpaid-${r.lead_id}`}>
                    <td className="rounded-l-[5px] border-y border-l border-rose-200 bg-rose-50/40 px-2 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center text-slate-600">{r.phone || "—"}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center text-slate-600">{r.branch_name || "—"}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center text-slate-700">{fmt(r.total_bill)}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center font-bold text-rose-700">{fmt(r.balance)}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center text-slate-600">{r.due_date || "—"}</td>
                    <td className="border-y border-rose-200 bg-rose-50/40 px-3 py-2 text-center"><StatusBadge status={r.status} /></td>
                    <td className="rounded-r-[5px] border-y border-r border-rose-200 bg-rose-50/40 px-3 py-2">
                      <div className="flex items-center justify-center">
                        <button type="button" onClick={() => onView && onView(r.lead_id)} title="View Details" className="rounded p-1 text-rose-500 hover:bg-rose-100 hover:text-rose-700">
                          <Eye className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
              {filtered.length > 0 && (
                <tfoot>
                  <tr>
                    <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Totals</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-slate-700">{fmt(footer.total_bill)}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-rose-700">{fmt(footer.balance)}</td>
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

export default PaymentUnpaidBoard;
