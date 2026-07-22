import { useEffect, useState } from "react";
import { X, Phone, Mail, MapPin } from "lucide-react";
import { getClientTransactionHistory } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

const STATUS_STYLES = {
  done: "bg-emerald-50 text-emerald-700 border-emerald-200",
  processing: "bg-amber-50 text-amber-700 border-amber-200",
};

/**
 * Client Details modal — a client's profile, current outstanding balance, full
 * payment history, and complete activity timeline. Opened via the eye icon from
 * Transactions History, Accountant Manage's Collections tables, and Total Revenue.
 * Two sub-tabs: Overview (client + payment details + completed status) and
 * Timeline (the client's overall activity feed).
 */
export const ClientHistoryModal = ({ leadId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("overview");

  useEffect(() => {
    setLoading(true);
    getClientTransactionHistory(leadId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [leadId]);

  const client = data?.client;
  const pd = data?.payment_details || {};
  const transactions = data?.transactions || [];
  const timeline = data?.timeline || [];
  const status = data?.status || "processing";

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
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Outstanding Balance</p>
                <p className={`mt-1 text-2xl font-bold ${data.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(data.balance)}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Payment Details</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="font-semibold text-slate-600">Consultation Fee</p>
                    <p className="mt-1 text-slate-700">{fmt(pd.consultation_fee_paid)} / {fmt(pd.consultation_fee_total)}</p>
                    {pd.consultation_payment_mode && <p className="mt-0.5 capitalize text-slate-400">{pd.consultation_payment_mode}</p>}
                  </div>
                  <div className="rounded-lg border border-slate-100 p-3">
                    <p className="font-semibold text-slate-600">Treatment Fee</p>
                    <p className="mt-1 text-slate-700">{pd.treatment_fee_paid != null ? fmt(pd.treatment_fee_paid) : "—"}</p>
                    {pd.treatment_payment_mode && <p className="mt-0.5 capitalize text-slate-400">{pd.treatment_payment_mode}</p>}
                    {pd.installments_total != null && (
                      <p className="mt-0.5 text-slate-400">{pd.installments_paid}/{pd.installments_total} installments paid</p>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transactions</p>
                <div className="space-y-2">
                  {transactions.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No transactions yet.</p>
                  ) : transactions.map((tx) => (
                    <div key={tx.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2 text-xs" data-testid={`client-history-tx-${tx.id}`}>
                      <div>
                        <p className="font-medium text-slate-700 capitalize">{tx.source} · <span className="capitalize text-slate-500">{tx.payment_mode}</span></p>
                        <p className="text-[10px] text-slate-400">{(tx.date || "").slice(0, 16).replace("T", " ")}</p>
                      </div>
                      <p className="font-semibold text-emerald-700">{fmt(tx.amount)}</p>
                    </div>
                  ))}
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
                    <p className="mt-0.5 text-[10px] text-slate-400">{(ev.created_at || "").slice(0, 16).replace("T", " ")} · {ev.created_by}</p>
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
