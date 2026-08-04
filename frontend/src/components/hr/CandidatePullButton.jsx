import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { recruitmentSheetStatus, recruitmentSources, recruitmentPullSource } from "@/lib/api";

/**
 * Pull every connected candidate sheet in one go, from the Candidates tab — the same
 * gesture as Branch Admin's Pull from Sheet, and deliberately the same green so it reads
 * as the same action.
 *
 * It is NOT that component reused. PullFromSheetButton pulls `marketing_sources` into
 * `leads`; pointing HR at it would import patients into the recruitment board and
 * candidates would never appear. Same button, different pipe.
 */
export const CandidatePullButton = ({ onPulled }) => {
  const [busy, setBusy] = useState(false);

  const pullAll = async () => {
    setBusy(true);
    try {
      const [status, sources] = await Promise.all([recruitmentSheetStatus(), recruitmentSources()]);
      if (!status.connected) {
        toast.error("Google Sheets is not connected. Ask Super Admin to connect it under Marketing Source.");
        return;
      }
      const usable = (sources || []).filter((s) => s.spreadsheet_id && s.is_active !== false);
      if (usable.length === 0) {
        toast.error("No candidate sheets connected yet. Add one under Source Manage.");
        return;
      }

      let imported = 0;
      let duplicate = 0;
      let noPhone = 0;
      const errors = [];
      // In parallel — one slow sheet shouldn't hold up the rest, and a failure on one
      // must not abandon the others.
      const results = await Promise.allSettled(usable.map((s) => recruitmentPullSource(s.id)));
      results.forEach((res, i) => {
        if (res.status === "fulfilled") {
          const r = res.value || {};
          imported += r.imported || 0;
          duplicate += r.skipped_duplicate || 0;
          noPhone += r.skipped_no_phone || 0;
        } else {
          const detail = res.reason?.response?.data?.detail || res.reason?.message || "failed";
          errors.push(`${usable[i].name}: ${String(detail).slice(0, 80)}`);
        }
      });

      if (errors.length) toast.error(`Some sheets failed: ${errors.join(" | ")}`);
      if (imported > 0) {
        toast.success(`Pulled ${imported} new candidate${imported === 1 ? "" : "s"} from ${usable.length} sheet${usable.length === 1 ? "" : "s"}`);
      } else if (!errors.length) {
        toast(`No new candidates. ${duplicate} already in the pipeline, ${noPhone} rows missing a phone.`);
      }
      if (onPulled) onPulled();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Pull failed");
    }
    setBusy(false);
  };

  return (
    <Button
      onClick={pullAll}
      disabled={busy}
      className="h-10 shrink-0 border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
      data-testid="hr-pull-from-sheet-btn"
    >
      <RefreshCw className={`mr-1 h-4 w-4 ${busy ? "animate-spin" : ""}`} />
      {busy ? "Pulling..." : "Pull from Sheet"}
    </Button>
  );
};

export default CandidatePullButton;
