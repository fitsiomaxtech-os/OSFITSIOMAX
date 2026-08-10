import { useEffect, useMemo, useRef, useState } from "react";
import { Eye, Banknote, CreditCard, Smartphone, Landmark, ChevronDown, CalendarDays, CalendarRange, AlertCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { MilkDateInput } from "@/components/ui/milk-calendar";
import { StatTile } from "@/components/ui/stat-tile";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);
const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

const MODE_META = {
  cash: { label: "Cash", icon: Banknote, classes: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  upi: { label: "UPI", icon: Smartphone, classes: "bg-sky-50 text-sky-700 border-sky-200" },
  card: { label: "Card", icon: CreditCard, classes: "bg-violet-50 text-violet-700 border-violet-200" },
  account_transfer: { label: "Account Transfer", icon: Landmark, classes: "bg-cyan-50 text-cyan-700 border-cyan-200" },
};

const PaymentModeBadge = ({ mode }) => {
  const meta = MODE_META[mode] || { label: mode || "—", icon: Banknote, classes: "bg-slate-50 text-slate-600 border-slate-200" };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      <Icon className="h-3 w-3" /> {meta.label}
    </span>
  );
};

// A fixed color per branch would need a stable name->color map that survives
// the branch list changing; cycling a palette by list position is simpler and
// still gives each branch its own distinct color in the open dropdown.
const BRANCH_COLOR_PALETTE = [
  "border-purple-300 bg-purple-50 text-purple-700",
  "border-indigo-300 bg-indigo-50 text-indigo-700",
  "border-emerald-300 bg-emerald-50 text-emerald-700",
  "border-amber-300 bg-amber-50 text-amber-700",
  "border-cyan-300 bg-cyan-50 text-cyan-700",
  "border-pink-300 bg-pink-50 text-pink-700",
  "border-orange-300 bg-orange-50 text-orange-700",
  "border-sky-300 bg-sky-50 text-sky-700",
];

// Native <select> can't reliably color individual dropdown-list items across
// browsers — only the closed box. This renders each option as its own colored,
// rounded row in a custom open list instead.
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

const StatusBadge = ({ paid }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${paid ? "bg-emerald-100 text-emerald-700 border-emerald-200" : "bg-rose-100 text-rose-700 border-rose-200"}`}>
    {paid ? "PAID" : "NOT PAID"}
  </span>
);

const SummaryCard = ({ label, ...rest }) => (
  <StatTile label={label} testid={`consultation-summary-${label.toLowerCase().replace(/\s+/g, "-")}`} {...rest} />
);

export const ConsultationCollectionsBoard = ({ rows, onView }) => {
  const [search, setSearch] = useState("");
  const [branch, setBranch] = useState("all");
  const [mode, setMode] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [activeCard, setActiveCard] = useState(null);

  const today = todayIso();
  const monthPrefix = today.slice(0, 7);

  const branches = useMemo(() => [...new Set(rows.map((r) => r.branch_name).filter(Boolean))], [rows]);

  const toggleCard = (key, modeValue) => {
    const next = activeCard === key ? null : key;
    setActiveCard(next);
    if (modeValue) setMode(next ? modeValue : "all");
  };

  const filtered = useMemo(() => rows.filter((r) => {
    // Matches the transaction id as well as the name, so a receipt handed back over the
    // desk can be found by the number printed on it.
    if (search) {
      const q = search.toLowerCase();
      const hit = (r.client_name || "").toLowerCase().includes(q)
        || (r.transaction_id || "").toLowerCase().includes(q);
      if (!hit) return false;
    }
    if (branch !== "all" && r.branch_name !== branch) return false;
    if (mode !== "all" && r.payment_mode !== mode) return false;
    const d = (r.date || "").slice(0, 10);
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    if (activeCard === "today" && d !== today) return false;
    if (activeCard === "month" && (r.date || "").slice(0, 7) !== monthPrefix) return false;
    if (activeCard === "outstanding" && !(r.client_balance > 0)) return false;
    return true;
  }), [rows, search, branch, mode, fromDate, toDate, activeCard, today, monthPrefix]);

  // Each card carries its own count as well as its sum, so the line under the figure says
  // how many transactions clicking it will leave in the table.
  const totals = useMemo(() => {
    const bucket = (pred) => {
      const hits = rows.filter(pred);
      return { total: hits.reduce((s, r) => s + r.gross, 0), count: hits.length };
    };
    const uniqueBalances = new Map();
    rows.forEach((r) => uniqueBalances.set(r.lead_id, r.client_balance || 0));
    const balances = [...uniqueBalances.values()];
    return {
      today: bucket((r) => (r.date || "").slice(0, 10) === today),
      month: bucket((r) => (r.date || "").slice(0, 7) === monthPrefix),
      cash: bucket((r) => r.payment_mode === "cash"),
      card: bucket((r) => r.payment_mode === "card"),
      upi: bucket((r) => r.payment_mode === "upi"),
      // Summed over every client rather than only those in the red, so an overpayment
      // still nets off the branch's total the way it did before. The count is of clients
      // actually owing, which is what the figure is read as.
      outstanding: { total: balances.reduce((s, b) => s + b, 0), count: balances.filter((b) => b > 0).length },
    };
  }, [rows, today, monthPrefix]);

  return (
    <div className="space-y-4" data-testid="consultation-collections-board">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <SummaryCard label="Today's Collection" value={fmt(totals.today.total)} sub={plural(totals.today.count, "payment")} icon={CalendarDays} color="#059669" active={activeCard === "today"} onClick={() => toggleCard("today")} />
        <SummaryCard label="This Month" value={fmt(totals.month.total)} sub={plural(totals.month.count, "payment")} icon={CalendarRange} color="#0284c7" active={activeCard === "month"} onClick={() => toggleCard("month")} />
        <SummaryCard label="Cash" value={fmt(totals.cash.total)} sub={plural(totals.cash.count, "payment")} icon={Banknote} color="#16a34a" active={activeCard === "cash"} onClick={() => toggleCard("cash", "cash")} />
        <SummaryCard label="Card" value={fmt(totals.card.total)} sub={plural(totals.card.count, "payment")} icon={CreditCard} color="#7c3aed" active={activeCard === "card"} onClick={() => toggleCard("card", "card")} />
        <SummaryCard label="UPI" value={fmt(totals.upi.total)} sub={plural(totals.upi.count, "payment")} icon={Smartphone} color="#0ea5e9" active={activeCard === "upi"} onClick={() => toggleCard("upi", "upi")} />
        <SummaryCard label="Outstanding" value={fmt(totals.outstanding.total)} sub={plural(totals.outstanding.count, "client")} icon={AlertCircle} color="#d97706" active={activeCard === "outstanding"} onClick={() => toggleCard("outstanding")} />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or transaction ID..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="consultation-collections-search"
          />
          <ColorFilterDropdown
            value={branch}
            options={[
              { value: "all", label: "All Branches", classes: "border-slate-200 bg-white text-slate-700" },
              ...branches.map((b, i) => ({ value: b, label: b, classes: BRANCH_COLOR_PALETTE[i % BRANCH_COLOR_PALETTE.length] })),
            ]}
            onChange={setBranch}
            testId="consultation-collections-branch-filter"
          />
          <ColorFilterDropdown
            value={mode}
            options={[
              { value: "all", label: "All Payment Modes", classes: "border-slate-200 bg-white text-slate-700" },
              { value: "cash", label: "Cash", classes: MODE_META.cash.classes },
              { value: "upi", label: "UPI", classes: MODE_META.upi.classes },
              { value: "card", label: "Card", classes: MODE_META.card.classes },
              { value: "account_transfer", label: "Account Transfer", classes: MODE_META.account_transfer.classes },
            ]}
            onChange={(v) => {
              setMode(v);
              setActiveCard(["cash", "card", "upi"].includes(v) ? v : null);
            }}
            testId="consultation-collections-mode-filter"
          />
          {/* Centred: these sit in a toolbar directly above the table, where an anchored
              panel opens over the rows and is clipped by the scroll container. */}
          <MilkDateInput
            centered
            title="From Date"
            placeholder="From date"
            value={fromDate} onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="consultation-collections-from-date"
          />
          <MilkDateInput
            centered
            title="To Date"
            placeholder="To date"
            min={fromDate || undefined}
            value={toDate} onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="consultation-collections-to-date"
          />
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-consultation">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Consultation Collections</p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[5%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[19%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Payment Mode</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Amount</th>
                  <th className="w-[15%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[16%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">View</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-slate-400">No transactions yet.</td></tr>
                ) : filtered.map((tx, i) => (
                  <tr key={tx.id} data-testid={`collections-row-${tx.id}`}>
                    <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-3 py-2 text-center text-slate-400">{i + 1}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{tx.client_name || "Unknown"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{tx.branch_name || "—"}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><PaymentModeBadge mode={tx.payment_mode} /></td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-slate-800">{fmt(tx.gross)}</td>
                    <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge paid={!(tx.client_balance > 0)} /></td>
                    <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2 text-center">
                      <button
                        type="button"
                        onClick={() => onView && onView(tx.lead_id)}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600"
                        data-testid={`collections-view-${tx.id}`}
                      >
                        <Eye className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ConsultationCollectionsBoard;
