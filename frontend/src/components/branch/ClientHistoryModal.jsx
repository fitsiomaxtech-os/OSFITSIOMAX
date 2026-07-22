import { useEffect, useState } from "react";
import { X, Phone, Mail, MapPin, Printer, FileText, MessageCircle, Wallet, PhoneCall } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { getClientTransactionHistory, markInstallmentPaid } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
const fmtDate = (d) => (d ? (d.length > 10 ? d.slice(0, 16).replace("T", " ") : d) : "—");

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
  upcoming: { label: "Upcoming", classes: "bg-slate-100 text-slate-600 border-slate-200" },
};

const Badge = ({ meta }) => (
  <span className={`inline-flex items-center rounded-[5px] border px-2 py-0.5 text-[10px] font-semibold ${meta.classes}`}>
    {meta.label}
  </span>
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
    window.open(`https://wa.me/${digits}?text=${msg}`, "_blank");
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

  const recordPayment = async () => {
    if (!pd.next_installment_number) return;
    setRecording(true);
    try {
      await markInstallmentPaid(leadId, pd.next_installment_number);
      toast.success(`Payment recorded for ${client.name}`);
      load();
      onChanged && onChanged();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to record payment");
    }
    setRecording(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="client-history-modal">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
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
          {[{ key: "overview", label: "Overview" }, { key: "timeline", label: "Timeline" }].map((t) => (
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
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="font-semibold text-slate-600">Consultation Fee</p>
                    <p className="mt-1 text-slate-700">Total: {fmt(pd.consultation_fee_total)}</p>
                    <p className="text-slate-700">Paid: {fmt(pd.consultation_fee_paid)}</p>
                    {pd.consultation_status && (
                      <p className={`mt-0.5 font-medium ${pd.consultation_status === "paid" ? "text-emerald-600" : "text-amber-600"}`}>
                        Status: {pd.consultation_status === "paid" ? "Paid" : "Pending"}
                      </p>
                    )}
                    {pd.consultation_payment_mode && <p className="mt-0.5 capitalize text-slate-400">{pd.consultation_payment_mode}</p>}
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="font-semibold text-slate-600">{pd.session_package_label && pd.session_package_label !== "—" ? `Session Package (${pd.session_package_label})` : "Treatment Fee"}</p>
                    <p className="mt-1 text-slate-700">Total: {pd.session_total > 0 ? fmt(pd.session_total) : "—"}</p>
                    <p className="text-slate-700">Paid: {pd.treatment_fee_paid != null ? fmt(pd.treatment_fee_paid) : "—"}</p>
                    <p className={`font-medium ${pd.session_due > 0 ? "text-rose-600" : "text-slate-500"}`}>Due: {pd.session_due > 0 ? fmt(pd.session_due) : "Rs.0"}</p>
                    {pd.treatment_payment_mode && <p className="mt-0.5 capitalize text-slate-400">{pd.treatment_payment_mode}</p>}
                    {pd.installments_total != null && (
                      <p className="mt-0.5 text-slate-400">Installments: {pd.installments_paid}/{pd.installments_total} paid</p>
                    )}
                  </div>
                </div>
              </div>

              {schedule.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Schedule</p>
                  <div className="space-y-1.5">
                    {schedule.map((s) => (
                      <div key={s.installment_number} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-1.5 text-xs" data-testid={`client-history-schedule-${s.installment_number}`}>
                        <span className="w-8 font-medium text-slate-500">#{s.installment_number}</span>
                        <span className="flex-1"><Badge meta={SCHEDULE_STATUS_META[s.status] || SCHEDULE_STATUS_META.upcoming} /></span>
                        <span className="w-20 text-right font-semibold text-slate-700">{fmt(s.amount)}</span>
                        <span className="w-24 text-right text-slate-400">{s.due_date}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transaction History</p>
                <div className="space-y-2">
                  {transactions.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No transactions yet.</p>
                  ) : transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs" data-testid={`client-history-tx-${tx.id}`}>
                      <div>
                        <p className="font-medium text-slate-700 capitalize">{tx.source} · <span className="capitalize text-slate-500">{tx.payment_mode}</span></p>
                        <p className="text-[10px] text-slate-400">{fmtDate(tx.date)} {tx.receipt_no && `· ${tx.receipt_no}`}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-emerald-700">{fmt(tx.amount)}</p>
                        <p className="text-[10px] font-medium text-emerald-600">Paid</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Quick Actions</p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button" onClick={recordPayment} disabled={!pd.next_installment_number || recording}
                    className="flex items-center justify-center gap-1.5 rounded-md border border-slate-200 px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
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
              </div>
            </>
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
    </div>
  );
};

export default ClientHistoryModal;
