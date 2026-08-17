import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet, Layers, Users, ChevronDown,
  Plus, RefreshCw, Trash2, Archive, ArchiveRestore, Link as LinkIcon, ArrowRightLeft, X, Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  mkGetDistribution, mkPatchDistribution, mkRefreshDistribution,
  mkUnassignedCount, mkDistributeUnassigned,
  mkGetTeam, mkCreateTeamMember, mkAllLeads, mkAssignLead, mkDeleteLead, mkBulkDelete,
  mkGetSources, mkCreateSource, mkUpdateSource, mkSyncSource,
  gsStatus, gsAuthUrl, gsDisconnect, gsPull, gsListTabs,
  getBranches, getVerticals,
} from "@/lib/api";
import { MaskedContact } from "@/components/MaskedContact";
import { SourcePill } from "@/components/marketing/SourcePill";

// "offline_physiotherapy" -> "Offline Physiotherapy". The stored name stays snake_case
// (matched against branches.vertical/verticals.name elsewhere); only the label is prettied.
const prettyVertical = (v) => String(v || "")
  .split("_")
  .filter(Boolean)
  .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
  .join(" ");

// Every default vertical is named "online_.../offline_..." — same helper as
// Branches & Verticals' own mode tag, read off that prefix.
const isOnlineVertical = (v) => String(v || "").startsWith("online_");

// A source with no branch/vertical tag applies everywhere (its leads go to the general
// Pre-Sales pool), so it counts as both Online and Offline rather than neither — a filter
// that hid it from both would make an untagged source look archived. A tagged one is
// classified off whichever mode(s) its own tags actually touch: its own verticals list,
// plus the vertical of each branch it's pinned to.
const sourceModes = (source, branches) => {
  const verticals = [
    ...(source.verticals || []),
    ...(source.branch_ids || []).map((bid) => branches.find((b) => b.id === bid)?.vertical).filter(Boolean),
  ];
  if (verticals.length === 0) return { online: true, offline: true };
  return { online: verticals.some(isOnlineVertical), offline: verticals.some((v) => !isOnlineVertical(v)) };
};

const SUB_TABS = [
  { key: "all_leads", label: "All Leads", icon: Layers },
  { key: "team", label: "Team & Distribution", icon: Users },
  { key: "lead_sources", label: "Lead Sources", icon: FileSpreadsheet },
];

const TabBtn = ({ active, label, Icon, onClick, testid }) => (
  <button
    onClick={onClick}
    data-testid={testid}
    className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-sky-600 text-white shadow" : "text-slate-600 hover:bg-slate-100"}`}
  >
    <Icon className="h-4 w-4" />
    {label}
  </button>
);

// ============ Sources ============

const SourcesTab = ({ branches: branchesProp = [] }) => {
  const [branches, setBranches] = useState(branchesProp);
  const loadBranches = useCallback(() => getBranches().then(setBranches).catch((e) => console.warn("[branches]", e?.message || e)), []);
  useEffect(() => { loadBranches(); }, [loadBranches]);

  const [verticals, setVerticals] = useState([]);
  useEffect(() => { getVerticals().then(setVerticals).catch((e) => console.warn("[verticals]", e?.message || e)); }, []);

  const [sources, setSources] = useState([]);
  // Which of them are shown — archiving hides a source without losing its config or the
  // leads it already brought in, so there has to be somewhere to see it again.
  const [sourceView, setSourceView] = useState("active");
  // Same Online/Offline split as Branches & Verticals and Branch Wise — a source is
  // grouped by whichever branch(es)/vertical(s) it's actually tagged to.
  const [sourceModeFilter, setSourceModeFilter] = useState("all"); // "all" | "offline" | "online"
  const [gs, setGs] = useState({ connected: false });
  const [showAdd, setShowAdd] = useState(false);
  const [showSync, setShowSync] = useState(null);
  const [showMap, setShowMap] = useState(null);
  const [showEdit, setShowEdit] = useState(null);
  const [form, setForm] = useState({ name: "", sheet_url: "", spreadsheet_id: "", sheet_names: ["Sheet1"], source_type: "google_sheets", headers: "", branchIds: [], verticals: [] });
  const [syncRows, setSyncRows] = useState(`[\n  {"name":"Aarav Sharma","phone":"9000000001","email":"aarav@example.com","city":"Chennai","condition":"Lower back pain","age":34}\n]`);
  const [syncResult, setSyncResult] = useState(null);
  const [pullResult, setPullResult] = useState(null);
  const [pullingId, setPullingId] = useState(null);
  // "View" shows the connection and its controls. It used to open locked behind a
  // code; that came off with the rest of the lock system.
  const [showManage, setShowManage] = useState(false);
  const [manageBusy, setManageBusy] = useState(false);

  const load = useCallback(() => mkGetSources().then(setSources).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  const loadGs = useCallback(() => gsStatus().then(setGs).catch((e) => console.warn("[gs status]", e?.message || e)), []);
  useEffect(() => { load(); loadGs(); }, [load, loadGs]);

  const visibleSources = useMemo(() => sources
    .filter((s) => (sourceView === "archived" ? s.is_archived : !s.is_archived))
    .filter((s) => sourceModeFilter === "all" || sourceModes(s, branches)[sourceModeFilter]),
  [sources, sourceView, sourceModeFilter, branches]);

  // OAuth result detection (?sheets_connect=success)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("sheets_connect") === "success") {
      toast.success("Google Sheets connected");
      window.history.replaceState({}, "", window.location.pathname);
      loadGs();
    } else if (params.get("sheets_connect") === "failed") {
      toast.error(`Google connect failed: ${params.get("reason") || "unknown"}`);
      window.history.replaceState({}, "", window.location.pathname);
    }
  }, [loadGs]);

  const connectGoogle = async () => {
    try {
      const r = await gsAuthUrl();
      window.location.href = r.auth_url;
    } catch (e) { toast.error(e?.response?.data?.detail || "Failed to start OAuth"); }
  };


  const closeManage = () => setShowManage(false);

  // Disconnect still confirms. It is the one action on this screen that stops every
  // branch's sheet sync at once and cannot be undone from the app — a misclick guard,
  // not a lock.
  const disconnectFromManage = async () => {
    if (!window.confirm("Disconnect Google Sheets? Every branch's lead sync stops until it is reconnected.")) return;
    setManageBusy(true);
    try {
      await gsDisconnect();
      toast.success("Disconnected");
      closeManage();
      loadGs();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Disconnect failed");
    }
    setManageBusy(false);
  };

  // Extract spreadsheet ID from any Google Sheets URL: /spreadsheets/d/{ID}/...
  const extractSheetId = (url) => {
    if (!url) return "";
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : "";
  };

  const onSheetUrlChange = (url) => {
    setForm({ ...form, sheet_url: url, spreadsheet_id: extractSheetId(url) || form.spreadsheet_id });
  };

  const pullNow = async (s) => {
    setPullResult(null);
    setPullingId(s.id);
    try {
      const res = await gsPull(s.id);
      setPullResult({ source: s, res });
      if (res.imported > 0) toast.success(`Pulled ${res.imported} new leads from ${s.name}`);
      else toast(`No new leads. ${res.skipped_duplicate || 0} duplicates, ${res.skipped_no_phone || 0} missing phone.`);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Pull failed"); }
    setPullingId(null);
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Source name required"); return; }
    const sheetId = form.spreadsheet_id || extractSheetId(form.sheet_url);
    if (form.source_type === "google_sheets" && !sheetId) {
      toast.error("Paste a valid Google Sheet URL (must contain /spreadsheets/d/<ID>/)");
      return;
    }
    const headers = form.headers.split(",").map((h) => h.trim()).filter(Boolean);
    try {
      await mkCreateSource({ name: form.name, sheet_url: form.sheet_url, source_type: form.source_type, headers, spreadsheet_id: sheetId, sheet_names: form.sheet_names.length ? form.sheet_names : ["Sheet1"], branch_ids: form.branchIds, verticals: form.verticals });
      toast.success("Source added");
      setForm({ name: "", sheet_url: "", spreadsheet_id: "", sheet_names: ["Sheet1"], source_type: "google_sheets", headers: "", branchIds: [], verticals: [] });
      setShowAdd(false);
      load();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };

  const runSync = async () => {
    try {
      const rows = JSON.parse(syncRows);
      if (!Array.isArray(rows)) { toast.error("JSON must be an array of objects"); return; }
      const res = await mkSyncSource(showSync.id, rows);
      setSyncResult(res);
      if (res.imported > 0) {
        toast.success(`Imported ${res.imported} · skipped ${res.skipped} (received ${res.rows_received}). Refresh Pre Sales to see them.`);
      } else {
        toast.error(`No leads imported. ${res.skipped_no_phone || 0} missing phone · ${res.skipped_duplicate || 0} duplicate. See details panel.`);
      }
      load();
    } catch (e) {
      if (e instanceof SyntaxError) { toast.error("Invalid JSON. Paste rows as a [ { ... }, ... ] array."); return; }
      toast.error(e?.response?.data?.detail || "Sync failed");
    }
  };

  const toggleActive = async (s) => {
    await mkUpdateSource(s.id, { is_active: !s.is_active });
    load();
  };

  // No gate on editing. Reaching this screen already means a Super Admin session,
  // and that is the check now — the one-time code that used to sit here was removed
  // at the branch's request.
  //
  // Archive, not delete — nothing here destroys a configured source or the leads it
  // already brought in, so there's nothing a confirm dialog needs to guard against.
  // It's reversible from the Archived tab.
  const toggleArchive = async (s) => {
    await mkUpdateSource(s.id, { is_archived: !s.is_archived });
    load();
  };

  return (
    <div className="space-y-4" data-testid="mk-sources-tab">
      <Card data-testid="gs-bar" className="border-slate-200 bg-white">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 48 48" className="h-8 w-8">
              <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
              <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
              <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
              <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
            </svg>
            <div>
              <p className="text-sm font-semibold text-slate-800">Google Sheets</p>
              {gs.connected ? (
                <p className="text-xs text-emerald-600">Connected · <span className="text-slate-500">Sheets read-only access only</span></p>
              ) : (
                <p className="text-xs text-slate-500">Connect Google to auto-pull leads (Sheets read-only — no Drive, no email).</p>
              )}
            </div>
          </div>
          <div className="flex gap-2">
            {gs.connected ? (
              <Button variant="outline" size="sm" onClick={() => setShowManage(true)} data-testid="gs-view-btn">View</Button>
            ) : (
              <Button onClick={connectGoogle} className="bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm" data-testid="gs-connect-btn">
                <svg viewBox="0 0 48 48" className="mr-2 h-4 w-4">
                  <path fill="#4285F4" d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"/>
                  <path fill="#34A853" d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"/>
                  <path fill="#FBBC05" d="M11.69 28.18C11.25 26.86 11 25.45 11 24s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24c0 3.55.85 6.91 2.34 9.88l7.35-5.7z"/>
                  <path fill="#EA4335" d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"/>
                </svg>
                Continue with Google
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-600">Connect data feeds. Paste sheet headers to auto-detect column mappings.</p>
        <Button onClick={() => setShowAdd(true)} data-testid="mk-add-source-btn"><Plus className="mr-1 h-4 w-4" />Add Source</Button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setSourceView("active")} className={`rounded-md px-3 py-2 text-sm font-medium ${sourceView === "active" ? "bg-sky-600 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="mk-source-tab-active">
          Active ({sources.filter((s) => !s.is_archived && (sourceModeFilter === "all" || sourceModes(s, branches)[sourceModeFilter])).length})
        </button>
        <button onClick={() => setSourceView("archived")} className={`rounded-md px-3 py-2 text-sm font-medium ${sourceView === "archived" ? "bg-slate-700 text-white" : "bg-slate-100 text-slate-600"}`} data-testid="mk-source-tab-archived">
          Archived ({sources.filter((s) => s.is_archived && (sourceModeFilter === "all" || sourceModes(s, branches)[sourceModeFilter])).length})
        </button>
      </div>

      {/* Pills, not a dropdown — same pattern as Branches & Verticals' own mode filter.
          An untagged ("All Branches") source counts as both, so it never disappears here. */}
      <div className="flex flex-wrap items-center gap-2" data-testid="mk-source-mode-filter">
        {[["all", "All"], ["offline", "Offline"], ["online", "Online"]].map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSourceModeFilter(key)}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition ${
              sourceModeFilter === key ? "border-sky-600 bg-sky-600 text-white shadow-sm" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:text-sky-600"
            }`}
            data-testid={`mk-source-mode-filter-${key}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid min-w-0 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {visibleSources.map((s) => (
          <Card key={s.id} data-testid={`mk-source-card-${s.id}`} className="min-w-0 border-slate-200">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{s.name}</CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <SourcePill source={s.source_type} />
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${s.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.is_active ? "Active" : "Inactive"}</span>
                  {(s.branch_ids || []).length === 0 && (s.verticals || []).length === 0 && (
                    <span className="inline-flex h-5 items-center rounded-full bg-slate-100 px-2 text-[10px] font-semibold text-slate-500" data-testid={`mk-source-branch-${s.id}`}>All Branches</span>
                  )}
                  {(s.branch_ids || []).map((bid) => (
                    <span key={bid} className="inline-flex h-5 items-center rounded-full bg-violet-100 px-2 text-[10px] font-semibold text-violet-700" data-testid={`mk-source-branch-${s.id}`}>
                      {branches.find((b) => b.id === bid)?.branch_name || "Unknown branch"}
                    </span>
                  ))}
                  {(s.verticals || []).map((v) => (
                    <span key={v} className="inline-flex h-5 items-center rounded-full bg-indigo-100 px-2 text-[10px] font-semibold text-indigo-700" data-testid={`mk-source-vertical-${s.id}`}>
                      {prettyVertical(v)}
                    </span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowEdit(s)} className="text-slate-400 hover:text-sky-600" data-testid={`mk-source-edit-${s.id}`} title="Edit source"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => toggleArchive(s)} className="text-slate-400 hover:text-amber-600" data-testid={`mk-source-archive-${s.id}`} title={s.is_archived ? "Unarchive source" : "Archive source"}>
                  {s.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
                </button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-600">
              {s.sheet_url && <p className="flex items-center gap-1 text-slate-400"><LinkIcon className="h-3 w-3 shrink-0" />Google Sheet linked</p>}
              {s.spreadsheet_id && <p className="text-[10px] text-slate-400">ID: <code>{s.spreadsheet_id.slice(0, 24)}…</code></p>}
              <p>Rows: <span className="font-semibold">{s.row_count || 0}</span> · Last sync: {s.last_synced ? s.last_synced.slice(0, 16).replace("T", " ") : "Never"}</p>
              <p>Mappings: <span className="font-semibold">{Object.keys(s.column_mapping || {}).length}</span> · Custom fields: {(s.custom_fields || []).length}</p>

              <div className="flex flex-wrap gap-2 pt-2">
                {s.source_type === "google_sheets" && s.spreadsheet_id && gs.connected && (
                  <Button
                    size="sm"
                    onClick={() => pullNow(s)}
                    disabled={pullingId === s.id}
                    className="bg-emerald-600 hover:bg-emerald-700"
                    data-testid={`gs-pull-${s.id}`}
                  >
                    <RefreshCw className={`mr-1 h-3 w-3 ${pullingId === s.id ? "animate-spin" : ""}`} />
                    {pullingId === s.id ? "Pulling..." : "Pull from Sheet"}
                  </Button>
                )}
                <Button size="sm" variant="outline" onClick={() => setShowSync(s)} data-testid={`mk-source-sync-${s.id}`}><RefreshCw className="mr-1 h-3 w-3" />Manual Sync (JSON)</Button>
                <Button size="sm" variant="outline" onClick={() => setShowMap(s)} data-testid={`mk-source-map-${s.id}`}>Edit Mapping</Button>
                <Button size="sm" variant="outline" onClick={() => toggleActive(s)} data-testid={`mk-source-toggle-${s.id}`}>{s.is_active ? "Deactivate" : "Activate"}</Button>
              </div>
              {pullResult && pullResult.source.id === s.id && (
                <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-[11px] text-emerald-800" data-testid={`gs-pull-result-${s.id}`}>
                  Imported <span className="font-bold">{pullResult.res.imported}</span> of {pullResult.res.rows_received} rows · {pullResult.res.skipped_duplicate || 0} dup · {pullResult.res.skipped_no_phone || 0} no phone
                </div>
              )}
            </CardContent>
          </Card>
        ))}
        {visibleSources.length === 0 && (
          <p className="col-span-full text-sm text-slate-400">
            {sourceModeFilter !== "all"
              ? "No sources match this filter."
              : sourceView === "archived" ? "No archived sources." : <>No sources yet. Click <span className="font-semibold">Add Source</span> to begin.</>}
          </p>
        )}
      </div>

      {showAdd && (
        <DialogShell title="Add Lead Source" onClose={() => setShowAdd(false)} testid="mk-add-source-dialog">
          <Input placeholder="Source name (e.g. Meta Ads, Walk-ins)" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} data-testid="mk-add-source-name" />
          <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })} data-testid="mk-add-source-type">
            {["meta", "seo", "referral", "walk_in", "website", "csv_import", "google_sheets", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          {form.source_type === "google_sheets" && (
            <>
              <Input placeholder="Paste Google Sheet URL (https://docs.google.com/spreadsheets/d/...)" value={form.sheet_url} onChange={(e) => onSheetUrlChange(e.target.value)} data-testid="mk-add-source-url" />
              {form.spreadsheet_id && (
                <p className="text-[10px] text-emerald-600">✓ Sheet ID detected: <code className="rounded bg-emerald-50 px-1">{form.spreadsheet_id.slice(0, 24)}…</code></p>
              )}
              <SheetTabPicker spreadsheetId={form.spreadsheet_id} values={form.sheet_names} onChange={(v) => setForm({ ...form, sheet_names: v })} testid="mk-add-source-sheetname" />
              <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
                <strong>Important:</strong> the sheet must be either accessible to the Google account you connected, OR shared as “Anyone with the link can view”.
              </p>
            </>
          )}
          {form.source_type !== "google_sheets" && (
            <Input placeholder="Source URL (optional, for reference)" value={form.sheet_url} onChange={(e) => setForm({ ...form, sheet_url: e.target.value })} data-testid="mk-add-source-url" />
          )}
          <Input placeholder="Headers (comma separated, e.g. Lead Name, Mobile, Email) — optional" value={form.headers} onChange={(e) => setForm({ ...form, headers: e.target.value })} data-testid="mk-add-source-headers" />
          <p className="text-xs text-slate-400">Headers auto-map to: name, phone, email, vertical, condition, age, preferred_branch, budget, notes.</p>
          <TargetPicker
            branches={branches}
            verticals={verticals}
            branchIds={form.branchIds}
            onBranchIdsChange={(v) => setForm({ ...form, branchIds: v })}
            sourceVerticals={form.verticals}
            onVerticalsChange={(v) => setForm({ ...form, verticals: v })}
            testid="mk-add-source-target"
          />
          <p className="text-xs text-slate-400">
            Leave both empty for All Branches (leads go to Pre-Sales as usual). Pick exactly ONE branch to auto-assign every lead pulled from it straight there. Picking several branches and/or verticals just tags this source for filtering — leads still land in the general Pre-Sales pool.
          </p>
          <Button onClick={submit} className="w-full" data-testid="mk-add-source-submit">Create Source</Button>
        </DialogShell>
      )}

      {showSync && (
        <DialogShell title={`Sync: ${showSync.name}`} onClose={() => { setShowSync(null); setSyncResult(null); }} testid="mk-sync-dialog">
          <p className="text-xs text-slate-500">Paste JSON rows from your Google Sheet (each row = one object). Phones are deduped by last 10 digits. New leads land in <span className="font-semibold">Pre Sales</span> + Marketing Source → All Leads with auto round-robin if enabled.</p>
          <textarea
            value={syncRows}
            onChange={(e) => setSyncRows(e.target.value)}
            className="h-48 w-full rounded-md border border-slate-200 p-2 font-mono text-xs"
            data-testid="mk-sync-rows-textarea"
          />
          <Button onClick={runSync} className="w-full" data-testid="mk-sync-submit"><RefreshCw className="mr-1 h-4 w-4" />Run Sync</Button>
          {syncResult && (
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-xs space-y-1" data-testid="mk-sync-result">
              <p><span className="font-semibold text-emerald-600">{syncResult.imported}</span> imported · <span className="font-semibold text-amber-600">{syncResult.skipped_no_phone || 0}</span> missing phone · <span className="font-semibold text-slate-600">{syncResult.skipped_duplicate || 0}</span> duplicates (of <span className="font-semibold">{syncResult.rows_received}</span> rows)</p>
              <p className="text-slate-500">Phone column used: <code className="rounded bg-slate-200 px-1 text-[10px]">{syncResult.phone_column_used}</code></p>
              {syncResult.mapping_used && Object.keys(syncResult.mapping_used).length > 0 && (
                <p className="text-slate-500">Field mapping: {Object.entries(syncResult.mapping_used).map(([k, v]) => <code key={k} className="mr-1 rounded bg-slate-200 px-1 text-[10px]">{k}={v}</code>)}</p>
              )}
              {(syncResult.sample_errors || []).length > 0 && (
                <ul className="ml-3 list-disc text-red-600">
                  {syncResult.sample_errors.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              )}
            </div>
          )}
        </DialogShell>
      )}

      {showMap && (
        <MappingEditor source={showMap} onClose={() => setShowMap(null)} onSaved={() => { setShowMap(null); load(); }} />
      )}

      {showEdit && (
        <EditSourceDialog source={showEdit} branches={branches} verticals={verticals} onClose={() => setShowEdit(null)} onSaved={() => { setShowEdit(null); load(); }} />
      )}

      {showManage && (
        <DialogShell title="Google Sheets Connection" onClose={closeManage} testid="gs-manage-dialog">
              <p className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-700">
                {gs.connected ? "Currently connected." : "Not connected."}
              </p>
              <Button onClick={connectGoogle} className="w-full bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 shadow-sm" data-testid="gs-manage-connect">
                {gs.connected ? "Reconnect / Switch Account" : "Connect Google"}
              </Button>
              {gs.connected && (
                <Button
                  onClick={disconnectFromManage}
                  disabled={manageBusy}
                  className="w-full bg-red-600 text-white hover:bg-red-700"
                  data-testid="gs-manage-disconnect"
                >
                  {manageBusy ? "Disconnecting..." : "Disconnect"}
                </Button>
              )}
        </DialogShell>
      )}
    </div>
  );
};

// Lead Control (Pre-Sales vs Branch Admin) used to have a switch on this card, but the
// setting lives on the branch, not the source — it's now only changed from Branch Wise /
// Branch Management, where a branch's own state is the thing on screen while you decide.

/**
 * Which worksheet/tab(s) get pulled, upgraded from a typed guess to a pick.
 *
 * Once a spreadsheet ID is known, this loads that sheet's actual tabs (debounced, so it
 * doesn't fire on every keystroke of the URL) and swaps the free-text input for a checklist
 * of real tab names — one or several can be picked, and only those are ever pulled (a
 * spreadsheet with one lead-form tab per branch, say, can be pulled as one source). If the
 * lookup fails (not connected yet, sheet not shared), it falls back to a comma-separated
 * text input rather than blocking entry.
 */
const SheetTabPicker = ({ spreadsheetId, values, onChange, testid }) => {
  const [tabs, setTabs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!spreadsheetId) { setTabs([]); setFailed(false); return; }
    let alive = true;
    setLoading(true);
    setFailed(false);
    const timer = setTimeout(() => {
      gsListTabs(spreadsheetId)
        .then((r) => { if (alive) { setTabs(r.tabs || []); setLoading(false); } })
        .catch(() => { if (alive) { setTabs([]); setFailed(true); setLoading(false); } });
    }, 500);
    return () => { alive = false; clearTimeout(timer); };
  }, [spreadsheetId]);

  const toggle = (tab) => onChange(values.includes(tab) ? values.filter((t) => t !== tab) : [...values, tab]);

  if (tabs.length > 0) {
    // Whatever was already picked stays checkable even if it fell out of the freshly
    // loaded list (a tab renamed since this source was last saved, say).
    const extra = values.filter((v) => !tabs.includes(v));
    return (
      <div>
        <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2" data-testid={testid}>
          {[...tabs, ...extra].map((t) => (
            <label key={t} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
              <input type="checkbox" checked={values.includes(t)} onChange={() => toggle(t)} data-testid={`${testid}-${t}`} />
              {t}
            </label>
          ))}
        </div>
        <p className="mt-1 text-[10px] text-emerald-600">✓ {tabs.length} tab{tabs.length === 1 ? "" : "s"} found — pick one or more; only those are pulled.</p>
      </div>
    );
  }

  return (
    <div>
      <Input
        placeholder="Worksheet/Tab name(s), comma separated (default: Sheet1)"
        value={values.join(", ")}
        onChange={(e) => onChange(e.target.value.split(",").map((t) => t.trim()).filter(Boolean))}
        data-testid={testid}
      />
      {loading && <p className="mt-1 text-[10px] text-slate-400">Loading tabs…</p>}
      {failed && <p className="mt-1 text-[10px] text-amber-600">Couldn't load tabs automatically — type tab name(s) comma-separated, or check the sheet is shared.</p>}
    </div>
  );
};

/**
 * Which branches/verticals a source is tagged to. Several of either can be picked on one
 * card — with more than one branch there's no single branch a row obviously belongs to, so
 * beyond exactly one selected branch this is a tag for organizing/filtering only (see the
 * backend's _internal_pull_source for the one-branch-still-auto-assigns rule).
 */
const TargetPicker = ({ branches, verticals, branchIds, onBranchIdsChange, sourceVerticals, onVerticalsChange, testid }) => (
  <div className="grid gap-3 sm:grid-cols-2">
    <div>
      <label className="text-xs font-medium text-slate-600">Branches</label>
      <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2" data-testid={`${testid}-branches`}>
        {branches.map((b) => {
          const checked = branchIds.includes(b.id);
          return (
            <label key={b.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onBranchIdsChange(e.target.checked ? [...branchIds, b.id] : branchIds.filter((id) => id !== b.id))}
                data-testid={`${testid}-branch-${b.id}`}
              />
              {b.branch_name}
            </label>
          );
        })}
        {branches.length === 0 && <p className="px-1.5 py-1 text-[11px] text-slate-400">No branches yet</p>}
      </div>
    </div>
    <div>
      <label className="text-xs font-medium text-slate-600">Verticals</label>
      <div className="mt-1 max-h-36 space-y-1 overflow-y-auto rounded-md border border-slate-200 p-2" data-testid={`${testid}-verticals`}>
        {verticals.map((v) => {
          const checked = sourceVerticals.includes(v.name);
          return (
            <label key={v.id} className="flex items-center gap-2 rounded px-1.5 py-1 text-xs hover:bg-slate-50">
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onVerticalsChange(e.target.checked ? [...sourceVerticals, v.name] : sourceVerticals.filter((n) => n !== v.name))}
                data-testid={`${testid}-vertical-${v.id}`}
              />
              {prettyVertical(v.name)}
            </label>
          );
        })}
        {verticals.length === 0 && <p className="px-1.5 py-1 text-[11px] text-slate-400">No verticals yet</p>}
      </div>
    </div>
  </div>
);

const EditSourceDialog = ({ source, branches = [], verticals = [], onClose, onSaved }) => {
  const initialHeaders = (source.headers_detected || []).join(", ");
  const [name, setName] = useState(source.name || "");
  const [sourceType, setSourceType] = useState(source.source_type || "google_sheets");
  const [sheetUrl, setSheetUrl] = useState(source.sheet_url || "");
  const [spreadsheetId, setSpreadsheetId] = useState(source.spreadsheet_id || "");
  const [sheetNames, setSheetNames] = useState(source.sheet_names || (source.sheet_name ? [source.sheet_name] : ["Sheet1"]));
  const [headers, setHeaders] = useState(initialHeaders);
  const [branchIds, setBranchIds] = useState(source.branch_ids || (source.branch_id ? [source.branch_id] : []));
  const [sourceVerticals, setSourceVerticals] = useState(source.verticals || []);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(!!source.auto_sync_enabled);
  const [autoSyncInterval, setAutoSyncInterval] = useState(String(source.auto_sync_interval_minutes || 60));

  const extractSheetId = (url) => {
    if (!url) return "";
    const m = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return m ? m[1] : "";
  };

  const onUrlChange = (url) => {
    setSheetUrl(url);
    setSpreadsheetId(extractSheetId(url) || spreadsheetId);
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Source name required"); return; }
    const payload = {
      name: name.trim(),
      source_type: sourceType,
      sheet_url: sheetUrl,
      branch_ids: branchIds,
      verticals: sourceVerticals,
      auto_sync_enabled: autoSyncEnabled,
      auto_sync_interval_minutes: Number(autoSyncInterval) || 60,
    };
    if (sourceType === "google_sheets") {
      payload.spreadsheet_id = spreadsheetId || extractSheetId(sheetUrl);
      payload.sheet_names = sheetNames.length ? sheetNames : ["Sheet1"];
    }
    // Only touch headers/mapping if the user actually changed them — avoids
    // silently wiping any manual "Edit Mapping" customization on every save.
    if (headers !== initialHeaders) {
      payload.headers = headers.split(",").map((h) => h.trim()).filter(Boolean);
    }
    try {
      await mkUpdateSource(source.id, payload);
      toast.success("Source updated");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Update failed"); }
  };

  return (
    <DialogShell title="Edit Source" onClose={onClose} testid="mk-edit-source-dialog">
      <Input placeholder="Source name (e.g. Meta Ads, Walk-ins)" value={name} onChange={(e) => setName(e.target.value)} data-testid="mk-edit-source-name" />
      <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={sourceType} onChange={(e) => setSourceType(e.target.value)} data-testid="mk-edit-source-type">
        {["meta", "seo", "referral", "walk_in", "website", "csv_import", "google_sheets", "other"].map((t) => <option key={t} value={t}>{t}</option>)}
      </select>
      {sourceType === "google_sheets" ? (
        <>
          <Input placeholder="Paste Google Sheet URL (https://docs.google.com/spreadsheets/d/...)" value={sheetUrl} onChange={(e) => onUrlChange(e.target.value)} data-testid="mk-edit-source-url" />
          {spreadsheetId && (
            <p className="text-[10px] text-emerald-600">✓ Sheet ID detected: <code className="rounded bg-emerald-50 px-1">{spreadsheetId.slice(0, 24)}…</code></p>
          )}
          <SheetTabPicker spreadsheetId={spreadsheetId} values={sheetNames} onChange={setSheetNames} testid="mk-edit-source-sheetname" />
          <p className="text-xs text-amber-700 bg-amber-50 rounded p-2">
            <strong>Important:</strong> the sheet must be either accessible to the Google account you connected, OR shared as “Anyone with the link can view”.
          </p>
          <label className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={autoSyncEnabled} onChange={(e) => setAutoSyncEnabled(e.target.checked)} data-testid="mk-edit-source-autosync" />
            Auto-sync this sheet
          </label>
          {autoSyncEnabled && (
            <div className="flex items-center gap-2">
              <label className="text-xs font-medium text-slate-600">Every</label>
              <Input type="number" min="5" className="w-24" value={autoSyncInterval} onChange={(e) => setAutoSyncInterval(e.target.value)} data-testid="mk-edit-source-interval" />
              <span className="text-xs text-slate-500">minutes</span>
            </div>
          )}
        </>
      ) : (
        <Input placeholder="Source URL (optional, for reference)" value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} data-testid="mk-edit-source-url" />
      )}
      <Input placeholder="Headers (comma separated, e.g. Lead Name, Mobile, Email) — optional" value={headers} onChange={(e) => setHeaders(e.target.value)} data-testid="mk-edit-source-headers" />
      <p className="text-xs text-slate-400">Changing headers re-detects the column mapping. Leave as-is to keep your current mapping.</p>
      <TargetPicker
        branches={branches}
        verticals={verticals}
        branchIds={branchIds}
        onBranchIdsChange={setBranchIds}
        sourceVerticals={sourceVerticals}
        onVerticalsChange={setSourceVerticals}
        testid="mk-edit-source-target"
      />
      <p className="text-xs text-slate-400">
        Leave both empty for All Branches (leads go to Pre-Sales as usual). Pick exactly ONE branch to auto-assign every lead pulled from it straight there. Picking several branches and/or verticals just tags this source for filtering — leads still land in the general Pre-Sales pool.
      </p>
      <Button onClick={save} className="w-full" data-testid="mk-edit-source-save">Save Changes</Button>
    </DialogShell>
  );
};

const STANDARD_FIELDS = ["name", "phone", "email", "vertical", "condition", "age", "preferred_branch", "budget", "notes"];

const MappingEditor = ({ source, onClose, onSaved }) => {
  const [mapping, setMapping] = useState(source.column_mapping || {});
  const headers = source.headers_detected || [];

  const setStd = (std, header) => {
    const next = { ...mapping };
    if (header === "__skip__") delete next[std]; else next[std] = header;
    setMapping(next);
  };

  const save = async () => {
    try {
      await mkUpdateSource(source.id, { column_mapping: mapping });
      toast.success("Mapping saved");
      onSaved();
    } catch (e) { toast.error(e?.response?.data?.detail || "Save failed"); }
  };

  return (
    <DialogShell title={`Mapping: ${source.name}`} onClose={onClose} testid="mk-map-dialog">
      {headers.length === 0 && <p className="text-xs text-amber-600">No headers detected — add them when creating the source.</p>}
      {STANDARD_FIELDS.map((std) => (
        <div key={std} className="flex items-center gap-2">
          <label className="w-32 text-xs font-medium text-slate-600">{std}</label>
          <select
            className="h-9 flex-1 rounded-md border border-slate-200 px-3 text-sm"
            value={mapping[std] || "__skip__"}
            onChange={(e) => setStd(std, e.target.value)}
            data-testid={`mk-map-${std}`}
          >
            <option value="__skip__">— Skip —</option>
            {headers.map((h) => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>
      ))}
      <Button onClick={save} className="w-full" data-testid="mk-map-save">Save Mapping</Button>
    </DialogShell>
  );
};

// ============ All Leads ============

const STAGE_TYPE_META = {
  all: { label: "All Stages", classes: "border-slate-200 bg-white text-slate-700" },
  pre_sales: { label: "Pre-Sales", classes: "border-indigo-300 bg-indigo-50 text-indigo-700" },
  sales: { label: "Sales", classes: "border-emerald-300 bg-emerald-50 text-emerald-700" },
};

// A fixed color per assignee would need a stable id->color map that survives
// the list changing; cycling a palette by list position is simpler and still
// gives each assignee its own distinct color in the open dropdown.
const ASSIGNEE_COLOR_PALETTE = [
  "border-purple-300 bg-purple-50 text-purple-700",
  "border-indigo-300 bg-indigo-50 text-indigo-700",
  "border-emerald-300 bg-emerald-50 text-emerald-700",
  "border-amber-300 bg-amber-50 text-amber-700",
  "border-cyan-300 bg-cyan-50 text-cyan-700",
  "border-pink-300 bg-pink-50 text-pink-700",
  "border-orange-300 bg-orange-50 text-orange-700",
  "border-sky-300 bg-sky-50 text-sky-700",
];

// Native <select> can't reliably color individual dropdown-list items across
// browsers — only the closed box. This renders each option as its own colored,
// rounded row in a custom open list instead (same pattern as HRBoard's role filter).
const ColorFilterDropdown = ({ value, options, onChange, testId, compact = false }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onDocClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const current = options.find((o) => o.value === value) || options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-2 rounded-md border font-semibold ${
          compact ? "h-7 px-2 text-[11px]" : "h-9 px-3 text-sm"
        } ${current?.classes || "border-slate-200 bg-white text-slate-700"}`}
        data-testid={testId}
      >
        <span className="truncate">{current?.label}</span>
        <ChevronDown className={`shrink-0 opacity-60 ${compact ? "h-3 w-3" : "h-3.5 w-3.5"}`} />
      </button>
      {open && (
        <div className={`absolute left-0 z-20 mt-1 max-h-64 w-full overflow-y-auto space-y-1 rounded-md border border-slate-200 bg-white p-1.5 shadow-lg ${compact ? "min-w-[150px]" : "min-w-[170px]"}`} data-testid={`${testId}-list`}>
          {options.map((o) => (
            <button
              key={o.value || "empty"}
              type="button"
              onClick={() => { onChange(o.value); setOpen(false); }}
              className={`block w-full rounded-md border px-3 py-1.5 text-left text-xs font-semibold ${o.classes}`}
              data-testid={`${testId}-option-${o.value || "empty"}`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const AllLeadsTab = ({ team }) => {
  const [filter, setFilter] = useState({ stage_type: "all", source: "", assigned_to: "", search: "" });
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, page: 1, page_size: 50 });
  const [selected, setSelected] = useState({});

  const load = useCallback(async () => {
    const res = await mkAllLeads({ ...filter, page, page_size: 50 });
    setData(res);
    setSelected({});
  }, [filter, page]);

  useEffect(() => { load(); }, [load]);

  const selectedIds = useMemo(() => Object.entries(selected).filter(([, v]) => v).map(([k]) => k), [selected]);

  const reassign = async (leadId, userId) => {
    if (!userId) return;
    try { await mkAssignLead(leadId, userId); toast.success("Reassigned"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Reassign failed"); }
  };

  const remove = async (leadId) => {
    if (!window.confirm("Delete this lead?")) return;
    try { await mkDeleteLead(leadId); toast.success("Lead deleted"); load(); }
    catch (e) { toast.error(e?.response?.data?.detail || "Delete failed"); }
  };

  const bulkRemove = async () => {
    if (selectedIds.length === 0) return;
    if (!window.confirm(`Delete ${selectedIds.length} leads?`)) return;
    await mkBulkDelete(selectedIds);
    toast.success(`Deleted ${selectedIds.length}`);
    load();
  };

  const everyone = [...(team.pre_sales || []), ...(team.sales || [])];

  const stageOptions = [STAGE_TYPE_META.all, STAGE_TYPE_META.pre_sales, STAGE_TYPE_META.sales].map((meta, idx) => ({
    value: ["all", "pre_sales", "sales"][idx], label: meta.label, classes: meta.classes,
  }));
  const assigneeOptions = [
    { value: "", label: "All Assignees", classes: "border-slate-200 bg-white text-slate-700" },
    ...everyone.map((u, i) => ({ value: u.id, label: u.full_name, classes: ASSIGNEE_COLOR_PALETTE[i % ASSIGNEE_COLOR_PALETTE.length] })),
  ];

  return (
    <div className="space-y-3" data-testid="mk-all-leads-tab">
      <div className="grid gap-2 sm:grid-cols-5">
        <ColorFilterDropdown
          value={filter.stage_type}
          options={stageOptions}
          onChange={(v) => { setPage(1); setFilter({ ...filter, stage_type: v }); }}
          testId="mk-filter-stage"
        />
        <Input placeholder="Source name" value={filter.source} onChange={(e) => { setPage(1); setFilter({ ...filter, source: e.target.value }); }} data-testid="mk-filter-source" />
        <ColorFilterDropdown
          value={filter.assigned_to}
          options={assigneeOptions}
          onChange={(v) => { setPage(1); setFilter({ ...filter, assigned_to: v }); }}
          testId="mk-filter-assigned"
        />
        <Input placeholder="Search name/phone/email" value={filter.search} onChange={(e) => { setPage(1); setFilter({ ...filter, search: e.target.value }); }} data-testid="mk-filter-search" />
        <div className="flex gap-2">
          <Button variant="outline" onClick={load} data-testid="mk-leads-refresh"><RefreshCw className="h-4 w-4" /></Button>
          {selectedIds.length > 0 && <Button variant="outline" className="border-red-200 text-red-600" onClick={bulkRemove} data-testid="mk-leads-bulk-delete"><Trash2 className="mr-1 h-4 w-4" />Delete ({selectedIds.length})</Button>}
        </div>
      </div>

      {/* Mobile: full-width cards, all the row's details folded into one card instead
          of spread across columns you'd otherwise have to scroll sideways to read. */}
      <div className="space-y-2 md:hidden" data-testid="mk-leads-mobile-cards">
        {data.rows.map((l) => (
          <div key={l.id} className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm" data-testid={`mk-lead-card-${l.id}`}>
            <div className="flex items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!selected[l.id]}
                  onChange={(e) => setSelected({ ...selected, [l.id]: e.target.checked })}
                  data-testid={`mk-lead-select-mobile-${l.id}`}
                />
                <p className="truncate text-sm font-semibold text-slate-800">{l.name}</p>
              </div>
              <button onClick={() => remove(l.id)} className="shrink-0 text-red-500 hover:text-red-700" data-testid={`mk-lead-delete-mobile-${l.id}`}>
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-2">
              <MaskedContact phone={l.phone} email={l.email} locked={l.stage === "Lost"} />
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <SourcePill source={l.source_tab || l.source_type} />
              <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">{l.stage}</span>
              <span className="text-xs text-slate-400">{(l.created_at || "").slice(0, 10)}</span>
            </div>
            <div className="mt-2">
              <ColorFilterDropdown
                compact
                value={l.assigned_user_id || ""}
                options={[
                  { value: "", label: "— Unassigned —", classes: "border-slate-200 bg-white text-slate-700" },
                  ...everyone.map((u, i) => ({ value: u.id, label: u.full_name, classes: ASSIGNEE_COLOR_PALETTE[i % ASSIGNEE_COLOR_PALETTE.length] })),
                ]}
                onChange={(v) => reassign(l.id, v)}
                testId={`mk-lead-reassign-mobile-${l.id}`}
              />
            </div>
          </div>
        ))}
        {data.rows.length === 0 && (
          <p className="rounded-lg border border-dashed border-slate-200 py-8 text-center text-sm text-slate-400">No leads match these filters.</p>
        )}
      </div>

      <div className="hidden overflow-auto rounded-lg border border-slate-200 md:block">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-2 py-2 w-8"><input type="checkbox" onChange={(e) => { const v = e.target.checked; const next = {}; data.rows.forEach((r) => { next[r.id] = v; }); setSelected(next); }} data-testid="mk-leads-select-all" /></th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Contact</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Assigned</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((l) => (
              <tr key={l.id} className="border-t border-slate-100" data-testid={`mk-lead-row-${l.id}`}>
                <td className="px-2 py-2"><input type="checkbox" checked={!!selected[l.id]} onChange={(e) => setSelected({ ...selected, [l.id]: e.target.checked })} data-testid={`mk-lead-select-${l.id}`} /></td>
                <td className="px-3 py-2 font-medium text-slate-800">{l.name}</td>
                <td className="px-3 py-2"><MaskedContact phone={l.phone} email={l.email} locked={l.stage === "Lost"} /></td>
                <td className="px-3 py-2"><SourcePill source={l.source_tab || l.source_type} /></td>
                <td className="px-3 py-2 text-slate-600">{l.stage}</td>
                <td className="px-3 py-2">
                  <ColorFilterDropdown
                    compact
                    value={l.assigned_user_id || ""}
                    options={[
                      { value: "", label: "— Unassigned —", classes: "border-slate-200 bg-white text-slate-700" },
                      ...everyone.map((u, i) => ({ value: u.id, label: u.full_name, classes: ASSIGNEE_COLOR_PALETTE[i % ASSIGNEE_COLOR_PALETTE.length] })),
                    ]}
                    onChange={(v) => reassign(l.id, v)}
                    testId={`mk-lead-reassign-${l.id}`}
                  />
                </td>
                <td className="px-3 py-2 text-slate-400">{(l.created_at || "").slice(0, 10)}</td>
                <td className="px-3 py-2"><button onClick={() => remove(l.id)} className="text-red-500 hover:text-red-700" data-testid={`mk-lead-delete-${l.id}`}><Trash2 className="h-4 w-4" /></button></td>
              </tr>
            ))}
            {data.rows.length === 0 && <tr><td colSpan="8" className="px-3 py-6 text-center text-slate-400">No leads match these filters.</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>Showing {data.rows.length} of {data.total}</span>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} data-testid="mk-leads-prev">Prev</Button>
          <span className="px-2 py-1">Page {data.page}</span>
          <Button size="sm" variant="outline" disabled={data.rows.length < data.page_size} onClick={() => setPage((p) => p + 1)} data-testid="mk-leads-next">Next</Button>
        </div>
      </div>
    </div>
  );
};

// ============ Team & Distribution ============

const TeamTab = ({ team, reloadTeam, branches }) => {
  const [settings, setSettings] = useState(null);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ full_name: "", email: "", password: "", team_type: "pre_sales", branch_id: "" });
  const [unassigned, setUnassigned] = useState(0);
  const [distributing, setDistributing] = useState(false);

  const loadSettings = useCallback(() => mkGetDistribution().then(setSettings).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { loadSettings(); }, [loadSettings]);

  const loadUnassigned = useCallback(
    () => mkUnassignedCount().then((r) => setUnassigned(r?.count || 0)).catch(() => setUnassigned(0)),
    [],
  );
  useEffect(() => { loadUnassigned(); }, [loadUnassigned]);

  const patch = async (updates) => {
    const next = await mkPatchDistribution(updates);
    setSettings(next);
  };

  const refresh = async () => {
    const next = await mkRefreshDistribution();
    setSettings(next);
    toast.success("Teams refreshed");
    reloadTeam();
  };

  // Assigning a few thousand leads is not something to do by mis-click, and there is no
  // undo — the previous owner of each lead was nobody, so there is nothing to restore to.
  const distribute = async () => {
    if (!window.confirm(
      `Assign ${unassigned.toLocaleString("en-IN")} unassigned leads across the Pre-Sales team?\n\n`
      + "Leads that already have an agent are left alone. This cannot be undone."
    )) return;
    setDistributing(true);
    try {
      const res = await mkDistributeUnassigned();
      toast.success(`${(res.assigned || 0).toLocaleString("en-IN")} leads assigned`);
      await Promise.all([loadUnassigned(), reloadTeam()]);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Could not distribute the leads");
    }
    setDistributing(false);
  };

  const submit = async () => {
    if (!form.full_name || !form.email || !form.password) { toast.error("Name, email, password required"); return; }
    const payload = { full_name: form.full_name, email: form.email, password: form.password, team_type: form.team_type };
    if (form.team_type === "branch_admin" && form.branch_id) payload.branch_id = form.branch_id;
    try {
      await mkCreateTeamMember(payload);
      toast.success("Team member created");
      setShowAdd(false);
      setForm({ full_name: "", email: "", password: "", team_type: "pre_sales", branch_id: "" });
      reloadTeam();
    } catch (e) { toast.error(e?.response?.data?.detail || "Create failed"); }
  };

  if (!settings) return <p className="text-sm text-slate-500">Loading...</p>;

  return (
    <div className="space-y-5" data-testid="mk-team-tab">
      <Card data-testid="mk-distribution-card">
        <CardHeader><CardTitle className="text-base">Distribution Settings</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Auto-Distribute New Leads</p>
              <p className="text-xs text-slate-500">Apply round-robin to leads synced from any source.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2" data-testid="mk-dist-enabled">
              <input type="checkbox" checked={!!settings.enabled} onChange={(e) => patch({ enabled: e.target.checked })} className="h-4 w-4" />
              <span className="text-xs font-medium">{settings.enabled ? "ON" : "OFF"}</span>
            </label>
          </div>
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-slate-700">Type:</label>
            <label className="inline-flex items-center gap-1 text-xs"><input type="radio" checked={settings.distribution_type === "round_robin"} onChange={() => patch({ distribution_type: "round_robin" })} data-testid="mk-dist-round-robin" />Round Robin</label>
            <label className="inline-flex items-center gap-1 text-xs"><input type="radio" checked={settings.distribution_type === "manual"} onChange={() => patch({ distribution_type: "manual" })} data-testid="mk-dist-manual" />Manual Only</label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={refresh} data-testid="mk-dist-refresh"><RefreshCw className="mr-1 h-4 w-4" />Refresh Team from Users</Button>
            <Button size="sm" onClick={() => setShowAdd(true)} data-testid="mk-add-team-btn"><Plus className="mr-1 h-4 w-4" />Add Team Member</Button>
          </div>

          {/* Round-robin only ever runs at the moment a lead arrives from a source sync,
              and only if distribution was already on with a team set. Everything that
              predates that has no agent and no way to get one — which is what makes every
              per-agent figure read zero. This is the only thing that can assign them
              after the fact. */}
          {unassigned > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3" data-testid="mk-unassigned-banner">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-amber-800">
                  {unassigned.toLocaleString("en-IN")} leads have no Pre-Sales agent
                </p>
                <p className="text-xs text-amber-700">
                  They arrived before auto-distribute was on, so nothing counts them against anyone. Leads that already have an agent are left alone.
                </p>
              </div>
              <Button size="sm" onClick={distribute} disabled={distributing} className="shrink-0 bg-amber-600 text-white hover:bg-amber-700" data-testid="mk-distribute-unassigned">
                <ArrowRightLeft className="mr-1 h-4 w-4" />
                {distributing ? "Distributing..." : "Distribute Them"}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {showAdd && (
        <DialogShell title="Add Team Member" onClose={() => setShowAdd(false)} testid="mk-add-team-dialog">
          <Input placeholder="Full name" value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} data-testid="mk-add-team-name" />
          <Input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} data-testid="mk-add-team-email" />
          <Input type="password" placeholder="Password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} data-testid="mk-add-team-pwd" />
          <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.team_type} onChange={(e) => setForm({ ...form, team_type: e.target.value })} data-testid="mk-add-team-type">
            <option value="pre_sales">Pre-Sales</option>
            <option value="branch_admin">Branch Admin (Sales)</option>
          </select>
          {form.team_type === "branch_admin" && (
            <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} data-testid="mk-add-team-branch">
              <option value="">Select branch</option>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
            </select>
          )}
          <Button onClick={submit} className="w-full" data-testid="mk-add-team-submit">Create</Button>
        </DialogShell>
      )}
    </div>
  );
};

// The Pre-Sales Team and Sales Team panels are gone from here. The Super Admin Dashboard
// carries them as its own tabs now, and two screens showing the same figures is one
// screen too many — this tab is for configuring distribution, not reading it back.
// TeamCard itself lives in components/marketing/TeamCard.jsx.

// ============ Dialog shell ============

const DialogShell = ({ title, onClose, children, testid }) => (
  <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" data-testid={testid}>
    <div className="w-full max-w-md space-y-3 rounded-lg bg-white p-5 shadow-xl">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">{title}</h3>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="mk-dialog-close"><X className="h-4 w-4" /></button>
      </div>
      {children}
    </div>
  </div>
);

// ============ Root ============

export const MarketingBoard = ({ branches = [] }) => {
  const [tab, setTab] = useState("all_leads");
  const [team, setTeam] = useState({ pre_sales: [], sales: [] });
  const reloadTeam = useCallback(() => mkGetTeam().then(setTeam).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { reloadTeam(); }, [reloadTeam]);

  return (
    <div className="space-y-4" data-testid="marketing-board">
      {/* No heading. The nav tab above already reads Marketing Source. */}
      <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-2" data-testid="mk-subtabs">
        {SUB_TABS.map((t) => (
          <TabBtn key={t.key} active={tab === t.key} label={t.label} Icon={t.icon} onClick={() => setTab(t.key)} testid={`mk-subtab-${t.key}`} />
        ))}
      </div>
      {tab === "lead_sources" && <SourcesTab branches={branches} />}
      {tab === "all_leads" && <AllLeadsTab team={team} />}
      {tab === "team" && <TeamTab team={team} reloadTeam={reloadTeam} branches={branches} />}
    </div>
  );
};

export default MarketingBoard;
