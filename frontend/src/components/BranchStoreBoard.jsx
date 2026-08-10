import { useEffect, useState } from "react";
import { Eye, Clock, CalendarCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { listStoreItems } from "@/lib/api";
import { TabletInventoryPanel } from "@/components/branch/TabletInventoryPanel";
import {
  TABS,
  CONSULTATIONS_SUBTABS,
  SESSIONS_SUBTABS,
  PlaceholderPanel,
  DURATION_OPTIONS,
  PriceModeBadges,
  SessionPriceBoxes,
  ViewItemModal,
} from "@/components/PackagesBoard";

const BranchItemsPanel = ({ category, itemType, emptyLabel, testidPrefix }) => {
  const [items, setItems] = useState([]);
  const [viewingItem, setViewingItem] = useState(null);
  const isSession = itemType === "session";

  const loadItems = () => listStoreItems(category, itemType).then(setItems).catch(() => {});
  useEffect(() => { loadItems(); }, []);

  const handleBook = (it) => {
    toast.info(`Booking "${it.name}" — coming soon`);
  };

  return (
    <div className="space-y-3" data-testid={`${testidPrefix}-panel`}>
      {items.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-400">{emptyLabel}</CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" data-testid={`${testidPrefix}-items-grid`}>
          {items.map((it) => (
            <Card key={it.id} data-testid={`${testidPrefix}-item-${it.id}`}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="flex-1 font-semibold text-slate-800">{it.name}</p>
                  <button
                    onClick={() => setViewingItem(it)}
                    className="shrink-0 rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-sky-600"
                    data-testid={`${testidPrefix}-item-${it.id}-view`}
                    title="View"
                  >
                    <Eye className="h-3.5 w-3.5" />
                  </button>
                </div>
                {it.image_url && <img src={it.image_url} alt={it.name} className="h-[200px] w-full rounded-lg object-cover" />}
                {it.description && <p className="line-clamp-2 text-xs text-slate-500">{it.description}</p>}

                {isSession ? (
                  <SessionPriceBoxes item={it} testid={`${testidPrefix}-item-${it.id}-highlights`} />
                ) : (
                  <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-3" data-testid={`${testidPrefix}-item-${it.id}-highlights`}>
                    <PriceModeBadges item={it} isSession={false} />
                    {it.duration_minutes && (
                      <div className="mt-1.5 flex items-center justify-between rounded-lg bg-sky-50 px-2.5 py-1.5">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-sky-800">
                          <Clock className="h-3.5 w-3.5" />Consultation Duration
                        </span>
                        <span className="text-sm font-extrabold text-sky-900">
                          {DURATION_OPTIONS.find((d) => d.minutes === it.duration_minutes)?.label || `${it.duration_minutes} mins`}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                <Button
                  onClick={() => handleBook(it)}
                  className="w-full bg-emerald-600 text-white hover:bg-emerald-700"
                  data-testid={`${testidPrefix}-item-${it.id}-book`}
                >
                  <CalendarCheck className="mr-1 h-4 w-4" />Book
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {viewingItem && (
        <ViewItemModal
          item={viewingItem}
          kind={itemType}
          canEdit={false}
          onClose={() => setViewingItem(null)}
        />
      )}
    </div>
  );
};

export const BranchConsultationsPanel = () => {
  const [sub, setSub] = useState("physiotherapy");
  return (
    <div className="space-y-4" data-testid="branch-store-panel-consultations">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-consultations-subtabs">
        {CONSULTATIONS_SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              data-testid={`branch-consultations-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {sub === "physiotherapy" && (
        <BranchItemsPanel
          category="physiotherapy"
          itemType="consultation"
          emptyLabel="No consultations available yet."
          testidPrefix="branch-consultation"
        />
      )}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="branch-consultations-subpanel-fitness" />}
    </div>
  );
};

export const BranchSessionsPanel = () => {
  const [sub, setSub] = useState("physiotherapy");
  return (
    <div className="space-y-4" data-testid="branch-store-panel-sessions">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-sessions-subtabs">
        {SESSIONS_SUBTABS.map((t) => {
          const Icon = t.icon;
          const active = sub === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setSub(t.key)}
              data-testid={`branch-sessions-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-50 text-sky-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {sub === "physiotherapy" && (
        <BranchItemsPanel
          category="physiotherapy"
          itemType="session"
          emptyLabel="No session packages available yet."
          testidPrefix="branch-session"
        />
      )}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="branch-sessions-subpanel-fitness" />}
    </div>
  );
};

const BRANCH_STORE_TABS = TABS.filter((t) => t.key !== "history");

// Which tabs have a panel of their own. The rest fall through to the placeholder, and a
// tab graduates by being added here rather than by another branch in the JSX below.
const PANELS_BUILT = new Set(["consultations", "sessions", "tablet"]);

export const FitsiomaxStorePanel = () => {
  const [tab, setTab] = useState("consultations");

  return (
    <div className="space-y-4" data-testid="branch-store-board">
      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="branch-store-subtabs">
        {BRANCH_STORE_TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`branch-store-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-violet-50 text-violet-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {tab === "consultations" && <BranchConsultationsPanel />}
      {tab === "sessions" && <BranchSessionsPanel />}
      {tab === "tablet" && <TabletInventoryPanel />}
      {!PANELS_BUILT.has(tab) && BRANCH_STORE_TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`branch-store-panel-${t.key}`} />
      ))}
    </div>
  );
};
