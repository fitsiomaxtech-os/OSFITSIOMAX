import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { gsAutoSyncSources, gsPull } from "@/lib/api";

/**
 * PullFromSheetButton
 * Manually pulls latest leads from ALL connected Google Sheet sources using the
 * same backend function as the "Pull from Sheet" button in Source Connection.
 * Props:
 *  - onPulled: () => void  — called after a successful pull, used to refresh leads list
 */
export const PullFromSheetButton = ({ onPulled }) => {
  const [busy, setBusy] = useState(false);

  const pullAll = async () => {
    setBusy(true);
    try {
      const status = await gsAutoSyncSources();
      if (!status.connected) {
        toast.error("Google Sheets not connected. Connect from Marketing Board → Lead Sources first.");
        return;
      }
      const sources = (status.sources || []).filter((s) => s.spreadsheet_id);
      if (sources.length === 0) {
        toast.error("No Google Sheet sources configured yet.");
        return;
      }
      let totalImported = 0;
      let totalDup = 0;
      let totalNoPhone = 0;
      const errors = [];
      for (const s of sources) {
        try {
          const r = await gsPull(s.id);
          totalImported += r.imported || 0;
          totalDup += r.skipped_duplicate || 0;
          totalNoPhone += r.skipped_no_phone || 0;
        } catch (e) {
          errors.push(`${s.name}: ${e?.response?.data?.detail || e?.message || "failed"}`);
        }
      }
      if (errors.length) {
        toast.error(`Some sources failed: ${errors.join(" | ")}`);
      }
      if (totalImported > 0) {
        toast.success(`Pulled ${totalImported} new lead${totalImported === 1 ? "" : "s"} from ${sources.length} sheet${sources.length === 1 ? "" : "s"}`);
      } else if (!errors.length) {
        toast(`No new leads. ${totalDup} duplicates skipped, ${totalNoPhone} rows missing phone.`);
      }
      onPulled && onPulled();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Pull failed");
    }
    setBusy(false);
  };

  return (
    <Button
      onClick={pullAll}
      disabled={busy}
      className="h-10 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
      data-testid="presales-pull-from-sheet-btn"
    >
      <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Pulling..." : "Pull from Sheet"}
    </Button>
  );
};
