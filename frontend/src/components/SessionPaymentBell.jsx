import { useCallback, useEffect, useRef, useState } from "react";
import { IndianRupee } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "@/components/ui/sonner";
import { getSessionPaymentAlerts } from "@/lib/api";

// Fired by the Physio board after a day is completed, so the count moves with the press
// rather than on the next page load.
export const SESSION_PAYMENT_REFRESH_EVENT = "session-payment-alerts:refresh";

const REFRESH_MS = 5 * 60 * 1000;
const rs = (n) => `Rs.${Number(n || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;

/**
 * The header's rupee bell: clients whose paid treatment sessions have been used up (or have
 * one left) while a Treatment Fee balance is still owing. Shown to Branch Admin, Accountant,
 * Physio and Super Admin; the backend narrows the list to each one's own clients.
 *
 * Red with a count when anyone is past what they paid for, amber when it is only heads-ups.
 * The first load of a browser session also says so in a toast, since a bell is easy to miss.
 */
export function SessionPaymentBell() {
  const [data, setData] = useState({ alerts: [], due: 0, last_paid: 0 });
  const [open, setOpen] = useState(false);
  const announced = useRef(false);

  const load = useCallback(() => {
    getSessionPaymentAlerts()
      .then((res) => {
        const next = res || { alerts: [], due: 0, last_paid: 0 };
        setData(next);
        if (announced.current) return;
        announced.current = true;
        let seen = false;
        try { seen = sessionStorage.getItem("session-payment-alerts-announced") === "1"; } catch { /* private window */ }
        if (!seen && next.due > 0) {
          toast.warning(
            `${next.due} client${next.due === 1 ? " has" : "s have"} used up their paid sessions — balance due`,
            { duration: 10000, description: "Open the ₹ bell at the top to see who." },
          );
          try { sessionStorage.setItem("session-payment-alerts-announced", "1"); } catch { /* ignore */ }
        }
      })
      .catch(() => { /* no count; nothing to act on */ });
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    window.addEventListener(SESSION_PAYMENT_REFRESH_EVENT, load);
    return () => {
      clearInterval(timer);
      window.removeEventListener(SESSION_PAYMENT_REFRESH_EVENT, load);
    };
  }, [load]);

  const count = data.due || data.last_paid;
  const urgent = data.due > 0;

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (v) load(); }}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`relative shrink-0 rounded-md p-2 transition ${
            urgent ? "text-rose-600 hover:bg-rose-50" : count ? "text-amber-600 hover:bg-amber-50" : "text-slate-400 hover:bg-slate-50"
          }`}
          title={urgent ? `${data.due} client(s) with payment due` : "Session payments"}
          aria-label={urgent ? `${data.due} client(s) with payment due` : "Session payments"}
          data-testid="session-payment-bell"
        >
          <IndianRupee className="h-4 w-4" />
          {count > 0 && (
            <span
              className={`absolute -right-0.5 -top-0.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${urgent ? "bg-rose-500" : "bg-amber-500"}`}
              data-testid="session-payment-bell-count"
            >
              {count > 99 ? "99+" : count}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0" data-testid="session-payment-popover">
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold text-slate-900">Session payments due</p>
          <p className="text-[11px] text-slate-500">Clients whose paid sessions are used up, with a balance still owing.</p>
        </div>
        <div className="max-h-[60vh] overflow-y-auto">
          {data.alerts.length === 0 ? (
            <p className="px-4 py-6 text-center text-xs text-slate-400">No balances due against completed sessions.</p>
          ) : (
            data.alerts.map((a) => (
              <div key={a.lead_id} className="border-b px-4 py-3 last:border-b-0" data-testid={`session-payment-alert-${a.lead_id}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">{a.name}</p>
                    <p className="truncate text-[10px] text-slate-400">
                      {[a.patient_number, a.branch_name, a.physio_name && `Physio: ${a.physio_name}`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                    a.level === "due" ? "bg-rose-50 text-rose-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    {a.level === "due" ? "Payment due" : "1 paid session left"}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                  <div><p className="text-slate-400">Completed</p><p className="font-semibold text-slate-800">{a.completed_sessions} / {a.total_sessions}</p></div>
                  <div><p className="text-slate-400">Paid for</p><p className="font-semibold text-slate-800">{a.paid_sessions}</p></div>
                  <div><p className="text-slate-400">Balance</p><p className="font-semibold text-rose-600">{rs(a.balance)}</p></div>
                </div>
                <p className="mt-2 text-[11px] leading-snug text-slate-600">{a.message}</p>
                {a.balance_due_date && <p className="mt-1 text-[10px] text-slate-400">Balance installment due {a.balance_due_date}</p>}
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
