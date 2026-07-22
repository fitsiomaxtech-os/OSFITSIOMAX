import { useEffect, useState } from "react";
import { X, Phone, Mail, MapPin } from "lucide-react";
import { getClientTransactionHistory } from "@/lib/api";

const fmt = (n) => `Rs.${(Number(n) || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * Client Details modal — a client's profile, current outstanding balance, full
 * payment history, and complete activity timeline. Opened via the eye icon from
 * Transactions History and from Accountant Manage's Collections tables.
 */
export const ClientHistoryModal = ({ leadId, onClose }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getClientTransactionHistory(leadId)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [leadId]);

  const client = data?.client;
  const transactions = data?.transactions || [];
  const timeline = data?.timeline || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="client-history-modal">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-100 p-5">
          <div>
            <h3 className="text-base font-semibold text-slate-900" data-testid="client-history-name">{client?.name || "Loading..."}</h3>
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

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {loading ? (
            <p className="py-10 text-center text-sm text-slate-400">Loading...</p>
          ) : !data ? (
            <p className="py-10 text-center text-sm text-slate-400">Failed to load client details.</p>
          ) : (
            <>
              <div className={`rounded-xl border p-4 ${data.balance > 0 ? "border-amber-200 bg-amber-50" : "border-emerald-200 bg-emerald-50"}`}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Outstanding Balance</p>
                <p className={`mt-1 text-2xl font-bold ${data.balance > 0 ? "text-amber-700" : "text-emerald-700"}`}>{fmt(data.balance)}</p>
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

              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Full Timeline</p>
                <div className="space-y-2">
                  {timeline.length === 0 ? (
                    <p className="py-4 text-center text-xs text-slate-400">No activity yet.</p>
                  ) : timeline.map((ev) => (
                    <div key={ev.id} className="rounded-lg bg-slate-50 px-3 py-2 text-xs" data-testid={`client-history-event-${ev.id}`}>
                      <p className="text-slate-700">{ev.details}</p>
                      <p className="mt-0.5 text-[10px] text-slate-400">{(ev.created_at || "").slice(0, 16).replace("T", " ")} · {ev.created_by}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ClientHistoryModal;
