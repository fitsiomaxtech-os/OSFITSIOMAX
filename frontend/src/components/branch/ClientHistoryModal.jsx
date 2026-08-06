import { useEffect, useState } from "react";
import { X, Phone, Mail, MapPin, Printer, FileText, MessageCircle, Wallet, PhoneCall } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { getClientTransactionHistory, markInstallmentPaid } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => (d ? (d.length > 10 ? d.slice(0, 16).replace("T", " ") : d) : "—");
const formatMode = (mode) => (mode ? (mode === "upi" ? "UPI" : mode.charAt(0).toUpperCase() + mode.slice(1)) : "");

const STATUS_STYLES = {
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
};

const BALANCE_STATUS_META = {
  paid: { label: "Paid", classes: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_soon: { label: "Due Soon", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  partial: { label: "Partial", classes: "bg-sky-100 text-sky-700 border-sky-200" },
};

const SCHEDULE_STATUS_META = {
  paid: { label: "Paid", classes: "bg-emerald-100 text-emerald-700 border-emerald-200" },
  overdue: { label: "Overdue", classes: "bg-rose-100 text-rose-700 border-rose-200" },
  due_today: { label: "Due", classes: "bg-amber-100 text-amber-700 border-amber-200" },
  upcoming: { label: "Upcoming", classes: "bg-orange-100 text-orange-700 border-orange-200" },
};

const Badge = ({ meta }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
    {meta.label}
  </span>
);

const INFO_BOX_NEUTRAL = "border-slate-200 bg-slate-50 text-slate-700";

// The same four modes, colours and mode-specific fields the Consultations board
// collects with — a payment recorded from here has to be indistinguishable from one
// recorded there, or Accountant Manage ends up with two grades of record.
const COLLECT_MODES = [
  { value: "cash", label: "Cash", classes: "border-emerald-300 bg-emerald-50 text-emerald-700", active: "border-emerald-500 bg-emerald-600 text-white" },
  { value: "upi", label: "UPI", classes: "border-sky-300 bg-sky-50 text-sky-700", active: "border-sky-500 bg-sky-600 text-white" },
  { value: "card", label: "Card", classes: "border-violet-300 bg-violet-50 text-violet-700", active: "border-violet-500 bg-violet-600 text-white" },
  { value: "account_transfer", label: "Account Transfer", classes: "border-cyan-300 bg-cyan-50 text-cyan-700", active: "border-cyan-500 bg-cyan-600 text-white" },
  { value: "cheque", label: "Cheque", classes: "border-amber-300 bg-amber-50 text-amber-700", active: "border-amber-500 bg-amber-600 text-white" },
];

const emptyCollectDraft = {
  amount: "",
  payment_mode: "cash",
  upi_transaction_id: "", upi_utr: "",
  account_number: "", account_holder_name: "", bank_name: "", ifsc_code: "",
  cheque_number: "", transfer_reference: "",
};

/** A payment's discount as a percentage of the price it was taken off, to 2dp with any
 *  trailing zeros dropped (25, not 25.00). Null when there's no original price to measure
 *  against, so the caller shows nothing rather than a meaningless 0%. */
const discountPct = (tx) => {
  const original = Number(tx.original_amount);
  const discount = Number(tx.discount_amount);
  if (!Number.isFinite(original) || original <= 0 || !Number.isFinite(discount) || !discount) return null;
  return Number((Math.abs(discount) / original * 100).toFixed(2));
};

/**
 * The client's collections, newest first. Rendered in two places — the Overview's left
 * column and the Transaction History tab — from this one definition, so the two can't
 * drift apart. Only one tab is mounted at a time, so the per-row test ids stay unique.
 */
const TransactionList = ({ transactions }) => (
  <div className="space-y-2" data-testid="client-history-transactions">
    {transactions.length === 0 ? (
      <p className="py-10 text-center text-sm text-slate-400">No transactions yet.</p>
    ) : transactions.map((tx) => (
      <div key={tx.id} className="rounded-lg border border-slate-100 px-3 py-2 text-xs" data-testid={`client-history-tx-${tx.id}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="font-medium text-slate-700 capitalize">{tx.source} · <span className="text-slate-500">{formatMode(tx.payment_mode)}</span></p>
            {/* The Transaction ID printed on the patient's own receipt, so the two can be
                matched. Older collections predate it and fall back to the RCPT- number
                derived from the activity id. */}
            <p className="break-all text-[10px] text-slate-400">{fmtDate(tx.date)}{(tx.transaction_id || tx.receipt_no) && ` · ${tx.transaction_id || tx.receipt_no}`}</p>
            {/* The UPI/card/cheque reference recorded with this payment, lifted back out
                of the activity line it was written into. */}
            {detailReference(tx.details) && (
              <p className="mt-0.5 break-all text-[10px] text-slate-500" data-testid={`client-history-tx-ref-${tx.id}`}>{detailReference(tx.details)}</p>
            )}
          </div>
          <div className="shrink-0 text-right">
            <p className="font-semibold text-emerald-700">{fmt(tx.amount)}</p>
            <p className="text-[10px] font-medium text-emerald-600">Paid</p>
          </div>
        </div>
        {!!tx.discount_amount && (
          <div className="mt-1.5 grid grid-cols-3 gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1.5" data-testid={`client-history-tx-discount-${tx.id}`}>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-amber-700">Actual Price</p>
              <p className="text-[11px] font-semibold text-slate-700">{fmt(tx.original_amount)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-amber-700">Collected</p>
              <p className="text-[11px] font-semibold text-slate-700">{fmt(tx.amount)}</p>
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wide text-amber-700">{tx.discount_amount > 0 ? "Discount" : "Extra"}</p>
              <p className="flex flex-wrap items-baseline gap-1">
                <span className="text-[11px] font-semibold text-amber-700">{fmt(Math.abs(tx.discount_amount))}</span>
                {/* What the rupee figure means against the price it came off. Guarded on a
                    non-zero original, since a percentage of nothing is meaningless. */}
                {discountPct(tx) !== null && (
                  <span className="rounded bg-amber-100 px-1 py-px text-[10px] font-bold text-amber-800" data-testid={`client-history-tx-discount-pct-${tx.id}`}>
                    {discountPct(tx)}%
                  </span>
                )}
              </p>
            </div>
            <p className="col-span-3 mt-0.5 text-[10px] font-medium text-amber-700">{tx.discount_reason}</p>
          </div>
        )}
      </div>
    ))}
  </div>
);

const CollectField = ({ label, value, onChange, placeholder, testid }) => (
  <label className="block">
    <span className="mb-1 block text-[11px] font-semibold text-slate-600">{label}</span>
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm focus:border-sky-400 focus:outline-none focus:ring-1 focus:ring-sky-400"
      data-testid={testid}
    />
  </label>
);

/** The reference a paid installment carries, as short chips — how it was paid and the
 *  proof of it. Nothing renders for a mode that has no reference (cash). */
const paidReference = (s) => [
  s.upi_transaction_id && `Txn ${s.upi_transaction_id}`,
  s.upi_utr && `UTR ${s.upi_utr}`,
  s.account_last4 && `A/C ****${s.account_last4}`,
  s.account_holder_name,
  s.cheque_number && `Cheque #${s.cheque_number}`,
  s.bank_name,
  s.ifsc_code,
].filter(Boolean);

/** The same reference, pulled back out of an activity-log line for the transaction list,
 *  which only ever receives the rendered sentence. Anything before the mode marker is
 *  the description, not a reference, so it's left alone. */
const detailReference = (details) => {
  const m = /·\s*(UPI txn|UTR|A\/C \*\*\*\*|Cheque #)/.exec(details || "");
  return m ? details.slice(m.index + 1).trim() : "";
};

const InfoBox = ({ children, className = INFO_BOX_NEUTRAL }) => (
  <div className={`rounded-md border px-2.5 py-1.5 ${className}`}>
    {children}
  </div>
);

const downloadInvoice = (client, data) => {
  const lines = [
    `Invoice — ${client.name}`,
    client.phone ? `Phone: ${client.phone}` : "",
    client.email ? `Email: ${client.email}` : "",
    client.branch_name ? `Branch: ${client.branch_name}` : "",
    "",
    "Date,Type,Payment Mode,Amount,Receipt No",
    ...(data.transactions || []).map((tx) => `${(tx.date || "").slice(0, 10)},${tx.source},${tx.payment_mode},${tx.amount},${tx.receipt_no || ""}`),
    "",
    `Outstanding Balance,,,${data.balance}`,
  ].filter(Boolean).join("\n");
  const blob = new Blob([lines], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `invoice-${client.name.replace(/\s+/g, "-").toLowerCase()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
};

/**
 * Client Details modal — a client's profile, current outstanding balance, full
 * payment history, and complete activity timeline. Opened via the eye icon from
 * Transactions History, Accountant Manage's Collections tables, and Total Revenue.
 * Two sub-tabs: Overview (client + payment details + completed status) and
 * Timeline (the client's overall activity feed).
 */
export const ClientHistoryModal = ({ leadId, onClose, onChanged }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");
  const [recording, setRecording] = useState(false);
  const [collectDraft, setCollectDraft] = useState(null);

  const load = () => {
    setLoading(true);
    getClientTransactionHistory(leadId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [leadId]);

  const client = data?.client;
  const pd = data?.payment_details || {};
  const schedule = data?.schedule || [];
  const transactions = data?.transactions || [];
  const timeline = data?.timeline || [];
  const status = data?.status || "processing";
  const balanceMeta = BALANCE_STATUS_META[data?.balance_status] || BALANCE_STATUS_META.partial;

  const sendReminder = () => {
    if (!client?.phone) return;
    const digits = client.phone.replace(/[^0-9]/g, "");
    const msg = encodeURIComponent(`Hi ${client.name}, this is a reminder that you have an outstanding balance of ${fmt(data.balance)}. Kindly clear it at your earliest convenience.`);
    // Same-tab handoff, not window.open(..., "_blank") — see caf18a6: the new-tab route
    // leaves mobile browsers on a blank white screen when WhatsApp returns control.
    window.location.href = `https://wa.me/${digits}?text=${msg}`;
  };

  const sendEmailReminder = () => {
    if (!client?.email) return;
    const subject = encodeURIComponent("Outstanding Payment Reminder");
    const body = encodeURIComponent(`Hi ${client.name},\n\nThis is a reminder that you have an outstanding balance of ${fmt(data.balance)}.\n\nKindly clear it at your earliest convenience.`);
    window.location.href = `mailto:${client.email}?subject=${subject}&body=${body}`;
  };

  const callClient = () => {
    if (!client?.phone) return;
    window.location.href = `tel:${client.phone.replace(/[^0-9+]/g, "")}`;
  };

  const nextInstallment = schedule.find((s) => s.installment_number === pd.next_installment_number);

  /** Opens the confirmation popup rather than collecting on the spot. Money changing
   *  hands off a single unguarded click is how a client gets charged twice. */
  const openCollect = () => {
    if (!pd.next_installment_number) return;
    setCollectDraft({ ...emptyCollectDraft, amount: nextInstallment?.amount ? String(nextInstallment.amount) : "" });
  };

  const setDraft = (patch) => setCollectDraft((d) => ({ ...d, ...patch }));

  const submitCollect = async () => {
    const draft = collectDraft;
    const amount = parseFloat(draft.amount);
    if (!(amount > 0)) {
      toast.error("Enter a valid amount");
      return;
    }
    const mode = draft.payment_mode;
    const payload = { payment_mode: mode, amount };
    // Validated here as well as on the server so the popup keeps what was typed —
    // a round trip that fails would otherwise send them back to an empty form.
    if (mode === "upi") {
      payload.upi_transaction_id = draft.upi_transaction_id.trim();
      payload.upi_utr = draft.upi_utr.trim();
    } else if (mode === "card" || mode === "account_transfer") {
      if (!draft.account_number.trim() || !draft.account_holder_name.trim() || !draft.bank_name.trim() || !draft.ifsc_code.trim()) {
        toast.error("Account Number, Account Holder Name, Bank Name and IFSC Code are required");
        return;
      }
      if (mode === "account_transfer" && !draft.transfer_reference.trim()) {
        toast.error("Reference / UTR No. is required for an Account Transfer");
        return;
      }
      payload.account_number = draft.account_number.trim();
      payload.account_holder_name = draft.account_holder_name.trim();
      payload.bank_name = draft.bank_name.trim();
      payload.ifsc_code = draft.ifsc_code.trim();
      if (mode === "account_transfer") payload.transfer_reference = draft.transfer_reference.trim();
    } else if (mode === "cheque") {
      if (!draft.bank_name.trim() || !draft.cheque_number.trim()) {
        toast.error("Bank Name and Cheque Number are required");
        return;
      }
      payload.bank_name = draft.bank_name.trim();
      payload.cheque_number = draft.cheque_number.trim();
    }

    setRecording(true);
    try {
      await markInstallmentPaid(leadId, pd.next_installment_number, payload);
      toast.success(`${fmt(amount)} collected from ${client.name}`);
      setCollectDraft(null);
      load();
      onChanged && onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to record payment");
    }
    setRecording(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="client-history-modal">
      {/* Wider than it was: the Overview now runs two columns side by side, and at the old
          max-w-2xl each one was too narrow to read. Still capped, so it doesn't sprawl on
          a large monitor. */}
      <div className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-slate-900" data-testid="client-history-name">{client?.name || "Loading..."}</h3>
              {client && (
                <span className={`inline-flex items-center gap-1 rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[status]}`} data-testid="client-history-status">
                  <span className={`h-1.5 w-1.5 rounded-full ${status === "done" ? "bg-emerald-500" : "bg-amber-500"}`} />
                  {status === "done" ? "Completed" : "In Progress"}
                </span>
              )}
            </div>
            {client && (
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-slate-500">
                {client.phone && <span className="flex items-center gap-1"><Phone className="h-3 w-3" />{client.phone}</span>}
                {client.email && <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{client.email}</span>}
                {client.branch_name && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{client.branch_name}</span>}
              </div>
            )}
          </div>
          <button onClick={onClose} className="rounded p-1 text-slate-400 hover:bg-slate-100" data-testid="client-history-close"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex gap-2 border-b border-slate-100 px-5 pt-3">
          {[
            { key: "overview", label: "Overview" },
            { key: "transactions", label: "Transaction History" },
            { key: "timeline", label: "Timeline" },
          ].map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-t-md px-3 py-2 text-sm font-medium transition ${tab === t.key ? "border-b-2 border-sky-600 text-sky-700" : "text-slate-500 hover:text-slate-700"}`}
              data-testid={`client-history-tab-${t.key}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-slate-400">Failed to load client details.</p>
          ) : tab === "overview" ? (
            <>
              {/* Two columns from lg up, stacked below it — the money story on the left,
                  what is still owed and how it breaks down on the right. Quick Actions
                  stays full width underneath, since its buttons need the room. */}
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Transaction History</p>
                <TransactionList transactions={transactions} />
              </div>

              <div className="space-y-5">
              <div className={`rounded-xl border p-4 ${data.balance > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Outstanding Balance</p>
                  <Badge meta={balanceMeta} />
                </div>
                <p className={`mt-1 text-2xl font-bold ${data.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(data.balance)}</p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-500">
                  <span>Last Payment: <span className="font-medium text-slate-700">{data.last_payment_date ? fmtDate(data.last_payment_date) : "—"}</span></span>
                  <span>Next Due: <span className="font-medium text-slate-700">{data.next_due_date || "—"}</span></span>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Summary</p>
                {/* The two fee cards sit side by side only where the column is wide enough
                    for them; inside the Overview's right-hand column they stack. */}
                <div className="grid grid-cols-1 gap-3 text-xs xl:grid-cols-2">
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="mb-2 font-semibold text-slate-600">Consultation Fee</p>
                    <div className="space-y-1.5">
                      <InfoBox>Total: {fmt(pd.consultation_fee_total)}</InfoBox>
                      <InfoBox className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">Paid: {fmt(pd.consultation_fee_paid)}</InfoBox>
                      {pd.consultation_status && (
                        <InfoBox className={pd.consultation_status === "paid" ? "border-emerald-200 bg-emerald-50 font-medium text-emerald-700" : "border-amber-200 bg-amber-50 font-medium text-amber-700"}>
                          Status: {pd.consultation_status === "paid" ? "Paid" : "Pending"}
                        </InfoBox>
                      )}
                      {pd.consultation_payment_mode && <InfoBox className={INFO_BOX_NEUTRAL}>{formatMode(pd.consultation_payment_mode)}</InfoBox>}
                    </div>
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="mb-2 font-semibold text-slate-600">{pd.session_package_label && pd.session_package_label !== "—" ? `Session Package (${pd.session_package_label})` : "Treatment Fee"}</p>
                    <div className="space-y-1.5">
                      <InfoBox>Total: {pd.session_total > 0 ? fmt(pd.session_total) : "—"}</InfoBox>
                      <InfoBox className="border-emerald-200 bg-emerald-50 font-medium text-emerald-700">Paid: {pd.session_paid != null ? fmt(pd.session_paid) : "—"}</InfoBox>
                      <InfoBox className={pd.session_due > 0 ? "border-rose-200 bg-rose-50 font-medium text-rose-700" : INFO_BOX_NEUTRAL}>Due: {pd.session_due > 0 ? fmt(pd.session_due) : "Rs.0"}</InfoBox>
                      {pd.treatment_payment_mode && pd.treatment_payment_mode !== "partial" && <InfoBox className={INFO_BOX_NEUTRAL}>{formatMode(pd.treatment_payment_mode)}</InfoBox>}
                      {pd.installments_total != null && (
                        <InfoBox className="border-orange-200 bg-orange-50 font-medium text-orange-700">Installments: {pd.installments_paid}/{pd.installments_total} paid</InfoBox>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {schedule.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Schedule</p>
                  <div className="space-y-1.5">
                    {schedule.map((s) => (
                      <div key={s.installment_number} className="rounded-lg border border-slate-100 px-3 py-1.5 text-xs" data-testid={`client-history-schedule-${s.installment_number}`}>
                        <div className="flex items-center justify-between">
                          <span className="w-8 font-medium text-slate-500">#{s.installment_number}</span>
                          <span className="flex-1"><Badge meta={SCHEDULE_STATUS_META[s.status] || SCHEDULE_STATUS_META.upcoming} /></span>
                          <span className="w-20 text-right font-semibold text-slate-700">{fmt(s.amount)}</span>
                          <span className="w-24 text-right text-slate-400">{s.due_date}</span>
                        </div>
                        {/* How this one was settled, once it has been — the UTR or cheque
                            number is the only way to match it to a bank statement later. */}
                        {s.payment_mode && (
                          <div className="mt-1 flex flex-wrap items-center gap-1 pl-8" data-testid={`client-history-schedule-ref-${s.installment_number}`}>
                            <span className="rounded-[4px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">{formatMode(s.payment_mode)}</span>
                            {paidReference(s).map((chip) => (
                              <span key={chip} className="rounded-[4px] bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{chip}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Actions</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button" onClick={openCollect} disabled={!pd.next_installment_number || recording}
                    title={pd.next_installment_number ? `Collect installment #${pd.next_installment_number}` : "Nothing left to collect on an installment schedule for this client"}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-2 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-white disabled:text-slate-600 disabled:opacity-40"
                    data-testid="client-history-record-payment"
                  >
                    <Wallet className="h-3.5 w-3.5" /> {recording ? "Saving..." : "Collect Payment"}
                  </button>
                  <button type="button" onClick={() => window.print()} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50" data-testid="client-history-print">
                    <Printer className="h-3.5 w-3.5" /> Print Receipt
                  </button>
                  <button type="button" onClick={() => downloadInvoice(client, data)} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50" data-testid="client-history-invoice">
                    <FileText className="h-3.5 w-3.5" /> Download Invoice
                  </button>
                  <button type="button" onClick={sendReminder} disabled={!client?.phone} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" data-testid="client-history-reminder">
                    <MessageCircle className="h-3.5 w-3.5" /> WhatsApp Reminder
                  </button>
                  <button type="button" onClick={sendEmailReminder} disabled={!client?.email} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" data-testid="client-history-email">
                    <Mail className="h-3.5 w-3.5" /> Email Reminder
                  </button>
                  <button type="button" onClick={callClient} disabled={!client?.phone} className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40" data-testid="client-history-call">
                    <PhoneCall className="h-3.5 w-3.5" /> Call Client
                  </button>
                </div>
                {/* A dead grey button tells nobody why. This screen can only collect
                    against an installment schedule; a consultation fee or a one-shot
                    treatment fee is collected from the lead's own Consultations card. */}
                {!pd.next_installment_number && (
                  <p className="mt-2 text-[11px] text-slate-400" data-testid="client-history-collect-note">
                    {data.balance > 0
                      ? "This client's balance isn't on an installment schedule — collect it from their card in Consultations."
                      : "Nothing left to collect — this client is fully paid."}
                  </p>
                )}
              </div>
            </>
          ) : tab === "transactions" ? (
            <TransactionList transactions={transactions} />
          ) : (
            <div className="space-y-2">
              {timeline.length === 0 ? (
                <p className="py-4 text-center text-xs text-slate-400">No activity yet.</p>
              ) : timeline.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-2 text-xs" data-testid={`client-history-event-${ev.id}`}>
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <div>
                    <p className="text-slate-700">{ev.details}</p>
                    <p className="mt-0.5 text-[10px] text-slate-400">{fmtDate(ev.created_at)} · {ev.created_by}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {collectDraft && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-3 backdrop-blur-sm"
          onClick={(e) => { if (e.target === e.currentTarget && !recording) setCollectDraft(null); }}
          data-testid="client-collect-modal"
        >
          <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex shrink-0 items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-3.5 text-white">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5" />
                <p className="text-base font-semibold">Collect Payment</p>
              </div>
              <button onClick={() => !recording && setCollectDraft(null)} className="rounded-full p-1.5 text-white/80 hover:bg-white/20" data-testid="client-collect-close">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* What exactly is being collected, before any of it is typed — the whole
                  point of the confirmation step. */}
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                  Installment #{pd.next_installment_number}{pd.installments_total ? ` of ${pd.installments_total}` : ""}
                </p>
                <p className="mt-0.5 text-2xl font-bold text-emerald-700">{fmt(nextInstallment?.amount)}</p>
                <p className="mt-0.5 text-[11px] text-emerald-700/80">
                  {client?.name}{nextInstallment?.due_date ? ` · due ${nextInstallment.due_date}` : ""}
                </p>
              </div>

              <div className="mt-4 space-y-3">
                <CollectField
                  label="Amount Collected"
                  value={collectDraft.amount}
                  onChange={(e) => setDraft({ amount: e.target.value })}
                  placeholder="0"
                  testid="client-collect-amount"
                />

                <div>
                  <span className="mb-1 block text-[11px] font-semibold text-slate-600">Payment Mode</span>
                  <div className="grid grid-cols-3 gap-1.5">
                    {COLLECT_MODES.map((m) => (
                      <button
                        key={m.value}
                        type="button"
                        onClick={() => setDraft({ payment_mode: m.value })}
                        className={`rounded-md border px-2 py-1.5 text-xs font-semibold transition ${collectDraft.payment_mode === m.value ? m.active : m.classes}`}
                        data-testid={`client-collect-mode-${m.value}`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>

                {collectDraft.payment_mode === "upi" && (
                  <div className="space-y-3 rounded-lg border border-sky-100 bg-sky-50/50 p-3">
                    <CollectField label="UPI Transaction ID" value={collectDraft.upi_transaction_id} onChange={(e) => setDraft({ upi_transaction_id: e.target.value })} placeholder="e.g. 428301947281" testid="client-collect-upi-txn" />
                    <CollectField label="UTR" value={collectDraft.upi_utr} onChange={(e) => setDraft({ upi_utr: e.target.value })} placeholder="e.g. 302411223344" testid="client-collect-upi-utr" />
                  </div>
                )}

                {collectDraft.payment_mode === "card" && (
                  <div className="space-y-3 rounded-lg border border-violet-100 bg-violet-50/50 p-3">
                    <CollectField label="Account Number *" value={collectDraft.account_number} onChange={(e) => setDraft({ account_number: e.target.value })} placeholder="Only the last 4 digits are stored" testid="client-collect-account-number" />
                    <CollectField label="Account Holder Name *" value={collectDraft.account_holder_name} onChange={(e) => setDraft({ account_holder_name: e.target.value })} placeholder="Name on the card" testid="client-collect-account-holder" />
                    <CollectField label="Bank Name *" value={collectDraft.bank_name} onChange={(e) => setDraft({ bank_name: e.target.value })} placeholder="e.g. HDFC Bank" testid="client-collect-bank" />
                    <CollectField label="IFSC Code *" value={collectDraft.ifsc_code} onChange={(e) => setDraft({ ifsc_code: e.target.value })} placeholder="e.g. HDFC0001234" testid="client-collect-ifsc" />
                  </div>
                )}

                {collectDraft.payment_mode === "account_transfer" && (
                  <div className="space-y-3 rounded-lg border border-cyan-100 bg-cyan-50/50 p-3">
                    <CollectField label="Account Number *" value={collectDraft.account_number} onChange={(e) => setDraft({ account_number: e.target.value })} placeholder="Only the last 4 digits are stored" testid="client-collect-transfer-account-number" />
                    <CollectField label="Account Holder Name *" value={collectDraft.account_holder_name} onChange={(e) => setDraft({ account_holder_name: e.target.value })} placeholder="Name on the account" testid="client-collect-transfer-account-holder" />
                    <CollectField label="Bank Name *" value={collectDraft.bank_name} onChange={(e) => setDraft({ bank_name: e.target.value })} placeholder="e.g. HDFC Bank" testid="client-collect-transfer-bank" />
                    <CollectField label="IFSC Code *" value={collectDraft.ifsc_code} onChange={(e) => setDraft({ ifsc_code: e.target.value })} placeholder="e.g. HDFC0001234" testid="client-collect-transfer-ifsc" />
                    <CollectField label="Reference / UTR No. *" value={collectDraft.transfer_reference} onChange={(e) => setDraft({ transfer_reference: e.target.value })} placeholder="e.g. 302411223344" testid="client-collect-transfer-reference" />
                  </div>
                )}

                {collectDraft.payment_mode === "cheque" && (
                  <div className="space-y-3 rounded-lg border border-amber-100 bg-amber-50/50 p-3">
                    <CollectField label="Bank Name *" value={collectDraft.bank_name} onChange={(e) => setDraft({ bank_name: e.target.value })} placeholder="e.g. HDFC Bank" testid="client-collect-cheque-bank" />
                    <CollectField label="Cheque Number *" value={collectDraft.cheque_number} onChange={(e) => setDraft({ cheque_number: e.target.value })} placeholder="e.g. 004512" testid="client-collect-cheque-number" />
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                type="button" onClick={() => setCollectDraft(null)} disabled={recording}
                className="rounded-md border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-white disabled:opacity-50"
                data-testid="client-collect-cancel"
              >
                Cancel
              </button>
              <button
                type="button" onClick={submitCollect} disabled={recording}
                className="rounded-md bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
                data-testid="client-collect-confirm"
              >
                {recording ? "Collecting..." : "Confirm & Collect"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientHistoryModal;
