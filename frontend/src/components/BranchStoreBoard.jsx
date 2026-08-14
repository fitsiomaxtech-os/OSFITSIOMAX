import { useCallback, useEffect, useState } from "react";
import { Eye, Clock, CalendarCheck, RefreshCw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { listStoreItems } from "@/lib/api";
import { StoreInventoryPanel } from "@/components/branch/StoreInventoryPanel";
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

const BranchItemsPanel = ({ category, itemType, emptyLabel, testidPrefix, durationLabel = "Consultation Duration", reloadToken }) => {
  const [items, setItems] = useState([]);
  const [viewingItem, setViewingItem] = useState(null);
  const isSession = itemType === "session";

  // useCallback so the effect can name it as a dependency — it was an inline function with
  // an empty dep array, which is what the exhaustive-deps warning here was pointing at, and
  // which also meant the list never refetched for any reason at all.
  const loadItems = useCallback(
    () => listStoreItems(category, itemType).then(setItems).catch(() => {}),
    [category, itemType],
  );
  useEffect(() => { loadItems(); }, [loadItems, reloadToken]);

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
                          <Clock className="h-3.5 w-3.5" />{durationLabel}
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

export const BranchConsultationsPanel = ({ reloadToken }) => {
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
          reloadToken={reloadToken}
        />
      )}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="branch-consultations-subpanel-fitness" />}
    </div>
  );
};

export const BranchSessionsPanel = ({ reloadToken }) => {
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
          reloadToken={reloadToken}
        />
      )}
      {sub === "fitness" && <PlaceholderPanel label="Fitness" testid="branch-sessions-subpanel-fitness" />}
    </div>
  );
};

/**
 * Diet Package — the branch's read-only view of what Super Admin has priced.
 *
 * No Physiotherapy/Fitness sub-tabs, matching Super Admin's own Diet Package tab: a diet
 * package is not split by department the way a consultation is, so a sub-tab bar with one
 * live entry would be a control that never does anything.
 *
 * Otherwise it is the consultation panel exactly — a Diet Consultation is priced and timed
 * the same way, which is why the backend validates it against the same rules.
 */
export const BranchDietPanel = ({ reloadToken }) => (
  <div className="space-y-4" data-testid="branch-store-panel-diet">
    <BranchItemsPanel
      category="physiotherapy"
      itemType="diet"
      durationLabel="Diet Consultation Duration"
      emptyLabel="No diet packages available yet. Super Admin adds them in FITSIO STORE > Diet Package."
      testidPrefix="branch-diet"
      reloadToken={reloadToken}
    />
  </div>
);

const BRANCH_STORE_TABS = TABS.filter((t) => t.key !== "history");

// The three shelves that are stock: a catalogue, a count per branch, and the same add,
// sell and move. One panel serves all of them, told which by its category.
const INVENTORY_TABS = new Set(["tablet", "supplementary", "equipment"]);

// Which tabs have a panel of their own. The rest fall through to the placeholder, and a
// tab graduates by being added here rather than by another branch in the JSX below.
const PANELS_BUILT = new Set(["consultations", "sessions", "diet", ...INVENTORY_TABS]);

export const FitsiomaxStorePanel = () => {
  const [tab, setTab] = useState("consultations");
  // Bumped by Refresh and passed to whichever panel is open, so it refetches in place —
  // rather than remounting it by key, which would also throw away the Physiotherapy /
  // Fitness choice inside Consultations and Sessions.
  const [reloadTick, setReloadTick] = useState(0);

  return (
    <div className="space-y-4" data-testid="branch-store-board">
      {/* A dropdown on a phone, as Accountant Manage uses: seven tabs wrapped to two rows
          and the shelf being browsed was the least prominent thing on screen. Desktop keeps
          the bar. */}
      <div className="flex items-center gap-2 md:hidden">
        <select
          value={tab}
          onChange={(e) => setTab(e.target.value)}
          className="h-11 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700"
          data-testid="branch-store-subtab-select"
        >
          {BRANCH_STORE_TABS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
        <Button
          onClick={() => setReloadTick((n) => n + 1)}
          title="Refresh"
          aria-label="Refresh"
          className="h-11 w-11 shrink-0 bg-slate-500 p-0 text-white hover:bg-slate-600"
          data-testid="branch-store-refresh"
        >
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      <div className="hidden flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1 md:flex" data-testid="branch-store-subtabs">
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

      {tab === "consultations" && <BranchConsultationsPanel reloadToken={reloadTick} />}
      {tab === "sessions" && <BranchSessionsPanel reloadToken={reloadTick} />}
      {tab === "diet" && <BranchDietPanel reloadToken={reloadTick} />}
      {/* Keyed by category: without it React keeps the same instance across a tab switch
          and the previous shelf's rows sit there until the new ones land. */}
      {INVENTORY_TABS.has(tab) && <StoreInventoryPanel key={tab} category={tab} reloadToken={reloadTick} />}
      {!PANELS_BUILT.has(tab) && BRANCH_STORE_TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`branch-store-panel-${t.key}`} />
      ))}
    </div>
  );
};
