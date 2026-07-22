import { Fragment, useEffect, useMemo, useState } from "react";
import { Eye, Wallet, MessageCircle, Mail, ChevronDown, ChevronRight, ChevronLeft, Printer, FileSpreadsheet } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "@/components/ui/sonner";
import { getClientTransactionHistory, markInstallmentPaid } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const todayIso = () => new Date().toISOString().slice(0, 10);

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_COLORS = [
  "#1E3A8A", "#EC4899", "#22C55E", "#38BDF8", "#FACC15", "#A78BFA",
  "#FB7185", "#F97316", "#14B8A6", "#8B5CF6", "#92400E", "#DC2626",
];

const STATUS_META = {
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_soon: { label: "Due Soon", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  partial: { label: "Partial Paid", classes: "bg-sky-100 text-sky-700 border-sky-200" },
};

const StatusBadge = ({ status }) => {
  const meta = STATUS_META[status] || STATUS_META.partial;
  return (
    <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
      {meta.label}
    </span>
  );
};

const MONTHS_VISIBLE = 5;
const centeredStart = (idx) => Math.min(Math.max(idx - 2, 0), MONTHS.length - MONTHS_VISIBLE);

const MonthFilterBar = ({ month, setMonth }) => {
  const [windowStart, setWindowStart] = useState(() => centeredStart(new Date().getMonth()));

  useEffect(() => {
    let autoMonth = new Date().getMonth();
    const interval = setInterval(() => {
      const nowMonth = new Date().getMonth();
      if (nowMonth !== autoMonth) {
        setMonth((prev) => {
          if (String(prev) === String(autoMonth)) {
            setWindowStart(centeredStart(nowMonth));
            return nowMonth;
          }
          return prev;
        });
        autoMonth = nowMonth;
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [setMonth]);

  const visible = MONTHS.slice(windowStart, windowStart + MONTHS_VISIBLE);

  const allActive = String(month) === "all";

  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white p-2" data-testid="outstanding-month-bar">
      <button
        type="button"
        onClick={() => setMonth("all")}
        className={`h-12 shrink-0 rounded-md border px-5 text-sm font-semibold transition ${allActive ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
        data-testid="outstanding-month-all"
      >
        All
      </button>

      <button
        type="button"
        onClick={() => setWindowStart((s) => Math.max(s - 1, 0))}
        disabled={windowStart === 0}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
        data-testid="outstanding-month-prev"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>

      <div className="flex flex-1 gap-2 overflow-x-auto">
        {visible.map((label, i) => {
          const idx = windowStart + i;
          const active = String(month) === String(idx);
          const color = MONTH_COLORS[idx];
          return (
            <button
              key={label}
              type="button"
              onClick={() => setMonth(idx)}
              className="h-12 flex-1 min-w-[100px] rounded-md border text-sm font-semibold transition"
              style={active
                ? { backgroundColor: color, borderColor: color, color: "#fff" }
                : { backgroundColor: `${color}14`, borderColor: `${color}55`, color }}
              data-testid={`outstanding-month-${idx}`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => setWindowStart((s) => Math.min(s + 1, MONTHS.length - MONTHS_VISIBLE))}
        disabled={windowStart >= MONTHS.length - MONTHS_VISIBLE}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-30"
        data-testid="outstanding-month-next"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
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
  const header = ["S.No", "Client", "Phone", "Branch", "Total Bill", "Paid Amount", "Outstanding Balance", "Due Date", "Status"];
  const lines = rows.map((r, i) => [
    i + 1, r.client_name, r.phone || "", r.branch_name || "", r.total_bill, r.paid_amount, r.balance,
    r.due_date || "", (STATUS_META[r.status] || STATUS_META.partial).label,
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  return [header.join(","), ...lines].join("\n");
};

const downloadCsv = (rows) => {
  const blob = new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `outstanding-amount-${todayIso()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

const ExpandedHistory = ({ leadId }) => {
  const [history, setHistory] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClientTransactionHistory(leadId)
      .then((d) => { setHistory(d); setLoading(false); })
      .catch(() => { setHistory(null); setLoading(false); });
  }, [leadId]);

  if (loading) return <p className="px-4 py-3 text-xs text-slate-400">Loading payment history...</p>;
  const transactions = history?.transactions || [];
  if (transactions.length === 0) return <p className="px-4 py-3 text-xs text-slate-400">No payment history yet.</p>;

  return (
    <div className="space-y-1.5 px-4 py-3">
      {transactions.map((tx) => (
        <div key={tx.id} className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-3 py-1.5 text-xs">
          <span className="capitalize text-slate-600">{tx.source} · {tx.payment_mode}</span>
          <span className="text-slate-400">{(tx.date || "").slice(0, 10)}</span>
          <span className="font-semibold text-emerald-600">{fmt(tx.amount)}</span>
        </div>
      ))}
    </div>
  );
};

export const OutstandingAmountBoard = ({ rows, onView, onChanged }) => {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [minAmount, setMinAmount] = useState("");
  const [maxAmount, setMaxAmount] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [collecting, setCollecting] = useState(null);

  const today = todayIso();

  const filtered = useMemo(() => rows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!(r.client_name || "").toLowerCase().includes(q) && !(r.phone || "").includes(q)) return false;
    }
    if (status !== "all" && r.status !== status) return false;
    if (month !== "all") {
      if (!r.due_date || Number(r.due_date.slice(5, 7)) - 1 !== Number(month)) return false;
    }
    if (minAmount && r.balance < Number(minAmount)) return false;
    if (maxAmount && r.balance > Number(maxAmount)) return false;
    return true;
  }), [rows, search, status, month, minAmount, maxAmount]);

  const totals = useMemo(() => {
    const totalOutstanding = rows.reduce((s, r) => s + r.balance, 0);
    const overdue = rows.filter((r) => r.status === "overdue").reduce((s, r) => s + r.balance, 0);
    const dueToday = rows.filter((r) => r.due_date === today).reduce((s, r) => s + r.balance, 0);
    return { totalOutstanding, overdue, dueToday, pendingClients: rows.length };
  }, [rows, today]);

  const footer = useMemo(() => filtered.reduce((acc, r) => ({
    total_bill: acc.total_bill + (r.total_bill || 0),
    paid_amount: acc.paid_amount + (r.paid_amount || 0),
    balance: acc.balance + (r.balance || 0),
  }), { total_bill: 0, paid_amount: 0, balance: 0 }), [filtered]);

  const collectPayment = async (row) => {
    if (!row.next_installment_number) return;
    setCollecting(row.lead_id);
    try {
      await markInstallmentPaid(row.lead_id, row.next_installment_number);
      toast.success(`Payment collected for ${row.client_name}`);
      onChanged && onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to collect payment");
    }
    setCollecting(null);
  };

  const sendWhatsapp = (row) => {
    if (!row.phone) return;
    const digits = row.phone.replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(`Hi ${row.client_name}, this is a reminder that you have an outstanding balance of ${fmt(row.balance)}. Kindly clear it at your earliest convenience.`);
    window.open(`https://wa.me/${digits}?text=${msg}`, "_blank");
  };

  const sendEmail = (row) => {
    if (!row.email) return;
    const subject = encodeURIComponent("Outstanding Payment Reminder");
    const body = encodeURIComponent(`Hi ${row.client_name},\n\nThis is a reminder that you have an outstanding balance of ${fmt(row.balance)}.\n\nKindly clear it at your earliest convenience.`);
    window.location.href = `mailto:${row.email}?subject=${subject}&body=${body}`;
  };

  return (
    <div className="space-y-4" data-testid="outstanding-amount-board">
      <MonthFilterBar month={month} setMonth={setMonth} />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Total Outstanding" value={fmt(totals.totalOutstanding)} color="#d97706" />
        <SummaryCard label="Overdue Amount" value={fmt(totals.overdue)} color="#e11d48" />
        <SummaryCard label="Due Today" value={fmt(totals.dueToday)} color="#0284c7" />
        <SummaryCard label="Pending Clients" value={totals.pendingClients} color="#7c3aed" />
      </div>

      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search client or phone..."
            className="h-9 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
            data-testid="outstanding-search"
          />
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
            data-testid="outstanding-status-filter"
          >
            <option value="all">All Statuses</option>
            <option value="overdue">Overdue</option>
            <option value="due_soon">Due Soon</option>
            <option value="partial">Partial Paid</option>
          </select>
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
              data-testid="outstanding-export-csv"
            >
              <FileSpreadsheet className="h-3.5 w-3.5" /> Export Excel
            </button>
            <button
              type="button" onClick={() => window.print()}
              className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50"
              data-testid="outstanding-print"
            >
              <Printer className="h-3.5 w-3.5" /> Print / PDF
            </button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="accountant-manage-outstanding">
        <CardContent className="p-4">
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Outstanding Amount</p>
          <div className="overflow-x-auto">
            <table className="w-full table-fixed border-separate border-spacing-x-0 border-spacing-y-2 text-sm">
              <thead>
                <tr>
                  <th className="w-[4%] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400"></th>
                  <th className="w-[5%] px-2 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">S.No</th>
                  <th className="w-[16%] px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-slate-400">Client</th>
                  <th className="w-[13%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Phone</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branch</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Bill</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Paid</th>
                  <th className="w-[10%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Balance</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Due Date</th>
                  <th className="w-[9%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Status</th>
                  <th className="w-[13%] px-3 py-2 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-400">Action</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={11} className="px-3 py-8 text-center text-sm text-slate-400">No outstanding balances.</td></tr>
                ) : filtered.map((r, i) => (
                  <Fragment key={r.lead_id}>
                    <tr data-testid={`accountant-manage-outstanding-${r.lead_id}`}>
                      <td className="rounded-l-[5px] border-y border-l border-slate-200 bg-white px-2 py-2 text-center">
                        <button type="button" onClick={() => setExpanded(expanded === r.lead_id ? null : r.lead_id)} className="text-slate-400 hover:text-slate-700">
                          {expanded === r.lead_id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                        </button>
                      </td>
                      <td className="border-y border-slate-200 bg-white px-2 py-2 text-center text-slate-400">{i + 1}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 font-medium text-slate-800">{r.client_name}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.phone || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.branch_name || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-700">{fmt(r.total_bill)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-emerald-600">{fmt(r.paid_amount)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center font-semibold text-amber-600">{fmt(r.balance)}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center text-slate-600">{r.due_date || "—"}</td>
                      <td className="border-y border-slate-200 bg-white px-3 py-2 text-center"><StatusBadge status={r.status} /></td>
                      <td className="rounded-r-[5px] border-y border-r border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-center gap-1">
                          <button type="button" onClick={() => onView && onView(r.lead_id)} title="View Details" className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600">
                            <Eye className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button" onClick={() => collectPayment(r)} title="Collect Payment"
                            disabled={!r.next_installment_number || collecting === r.lead_id}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30"
                          >
                            <Wallet className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => sendWhatsapp(r)} title="Send WhatsApp Reminder" disabled={!r.phone} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-emerald-600 disabled:cursor-not-allowed disabled:opacity-30">
                            <MessageCircle className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" onClick={() => sendEmail(r)} title="Send Email" disabled={!r.email} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-sky-600 disabled:cursor-not-allowed disabled:opacity-30">
                            <Mail className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {expanded === r.lead_id && (
                      <tr>
                        <td colSpan={11} className="border-x border-b border-slate-200 bg-slate-50/60 p-0">
                          <ExpandedHistory leadId={r.lead_id} />
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
                    <td className="px-3 py-2 text-center text-xs font-bold text-slate-700">{fmt(footer.total_bill)}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-emerald-600">{fmt(footer.paid_amount)}</td>
                    <td className="px-3 py-2 text-center text-xs font-bold text-amber-600">{fmt(footer.balance)}</td>
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

export default OutstandingAmountBoard;
