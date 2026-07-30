import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FileSpreadsheet, Layers, Users, ChevronDown,
  Plus, RefreshCw, Trash2, Link as LinkIcon, ArrowRightLeft, X, Pencil,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  mkGetDistribution, mkPatchDistribution, mkRefreshDistribution,
  mkGetTeam, mkCreateTeamMember, mkAllLeads, mkAssignLead, mkDeleteLead, mkBulkDelete,
  mkGetSources, mkCreateSource, mkUpdateSource, mkDeleteSource, mkSyncSource,
  gsStatus, gsAuthUrl, gsDisconnect, gsPull,
} from "@/lib/api";
import { MaskedContact } from "@/components/MaskedContact";
import { SourcePill } from "@/components/marketing/SourcePill";

const SUB_TABS = [
  { key: "lead_sources", label: "Lead Sources", icon: FileSpreadsheet },
  { key: "all_leads", label: "All Leads", icon: Layers },
  { key: "team", label: "Team & Distribution", icon: Users },
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

const SourcesTab = ({ branches = [] }) => {
  const [sources, setSources] = useState([]);
  const [gs, setGs] = useState({ connected: false });
  const [showAdd, setShowAdd] = useState(false);
  const [showSync, setShowSync] = useState(null);
  const [showMap, setShowMap] = useState(null);
  const [showEdit, setShowEdit] = useState(null);
  const [form, setForm] = useState({ name: "", sheet_url: "", spreadsheet_id: "", sheet_name: "Sheet1", source_type: "google_sheets", headers: "", branch_id: "" });
  const [syncRows, setSyncRows] = useState(`[\n  {"name":"Aarav Sharma","phone":"9000000001","email":"aarav@example.com","city":"Chennai","condition":"Lower back pain","age":34}\n]`);
  const [syncResult, setSyncResult] = useState(null);
  const [pullResult, setPullResult] = useState(null);
  const [pullingId, setPullingId] = useState(null);

  const load = useCallback(() => mkGetSources().then(setSources).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  const loadGs = useCallback(() => gsStatus().then(setGs).catch((e) => console.warn("[gs status]", e?.message || e)), []);
  useEffect(() => { load(); loadGs(); }, [load, loadGs]);

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

  const disconnectGoogle = async () => {
    if (!window.confirm("Disconnect Google? All synced sources will need to reconnect.")) return;
    await gsDisconnect();
    toast.success("Disconnected");
    loadGs();
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
      await mkCreateSource({ name: form.name, sheet_url: form.sheet_url, source_type: form.source_type, headers, spreadsheet_id: sheetId, sheet_name: form.sheet_name || "Sheet1", branch_id: form.branch_id || null });
      toast.success("Source added");
      setForm({ name: "", sheet_url: "", spreadsheet_id: "", sheet_name: "Sheet1", source_type: "google_sheets", headers: "", branch_id: "" });
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
        toast.success(`Imported ${res.imported} · skipped ${res.skipped} (received ${res.rows_received}). Refresh Pre-Sales CRM to see them.`);
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

  const remove = async (id) => {
    if (!window.confirm("Delete this source?")) return;
    await mkDeleteSource(id);
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
              <Button variant="outline" size="sm" onClick={disconnectGoogle} className="text-red-600 hover:bg-red-50" data-testid="gs-disconnect-btn">Disconnect</Button>
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

      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">Connect data feeds. Paste sheet headers to auto-detect column mappings.</p>
        <Button onClick={() => setShowAdd(true)} data-testid="mk-add-source-btn"><Plus className="mr-1 h-4 w-4" />Add Source</Button>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sources.map((s) => (
          <Card key={s.id} data-testid={`mk-source-card-${s.id}`} className="border-slate-200">
            <CardHeader className="flex flex-row items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">{s.name}</CardTitle>
                <div className="mt-1 flex flex-wrap items-center gap-2">
                  <SourcePill source={s.source_type} />
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${s.is_active ? "bg-green-100 text-green-700" : "bg-slate-200 text-slate-600"}`}>{s.is_active ? "Active" : "Inactive"}</span>
                  <span className={`inline-flex h-5 items-center rounded-full px-2 text-[10px] font-semibold ${s.branch_id ? "bg-violet-100 text-violet-700" : "bg-slate-100 text-slate-500"}`} data-testid={`mk-source-branch-${s.id}`}>
                    {s.branch_id ? (branches.find((b) => b.id === s.branch_id)?.branch_name || "Unknown branch") : "All Branches"}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowEdit(s)} className="text-slate-400 hover:text-sky-600" data-testid={`mk-source-edit-${s.id}`} title="Edit source"><Pencil className="h-4 w-4" /></button>
                <button onClick={() => remove(s.id)} className="text-slate-400 hover:text-red-500" data-testid={`mk-source-delete-${s.id}`} title="Delete source"><Trash2 className="h-4 w-4" /></button>
              </div>
            </CardHeader>
            <CardContent className="space-y-2 text-xs text-slate-600">
              {s.sheet_url && <p className="truncate"><LinkIcon className="mr-1 inline h-3 w-3" />{s.sheet_url}</p>}
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
        {sources.length === 0 && <p className="col-span-full text-sm text-slate-400">No sources yet. Click <span className="font-semibold">Add Source</span> to begin.</p>}
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
              <Input placeholder="Worksheet/Tab name (default: Sheet1)" value={form.sheet_name} onChange={(e) => setForm({ ...form, sheet_name: e.target.value })} data-testid="mk-add-source-sheetname" />
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
          <label className="text-xs font-medium text-slate-600">Branch</label>
          <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={form.branch_id} onChange={(e) => setForm({ ...form, branch_id: e.target.value })} data-testid="mk-add-source-branch">
            <option value="">All Branches (leads go to Pre-Sales as usual)</option>
            {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
          </select>
          <p className="text-xs text-slate-400">Pick a branch if this sheet only ever has leads for ONE branch — every lead pulled from it will auto-assign straight there.</p>
          <Button onClick={submit} className="w-full" data-testid="mk-add-source-submit">Create Source</Button>
        </DialogShell>
      )}

      {showSync && (
        <DialogShell title={`Sync: ${showSync.name}`} onClose={() => { setShowSync(null); setSyncResult(null); }} testid="mk-sync-dialog">
          <p className="text-xs text-slate-500">Paste JSON rows from your Google Sheet (each row = one object). Phones are deduped by last 10 digits. New leads land in <span className="font-semibold">Pre-Sales CRM</span> + Marketing Board → All Leads with auto round-robin if enabled.</p>
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
        <EditSourceDialog source={showEdit} branches={branches} onClose={() => setShowEdit(null)} onSaved={() => { setShowEdit(null); load(); }} />
      )}
    </div>
  );
};

const EditSourceDialog = ({ source, branches = [], onClose, onSaved }) => {
  const initialHeaders = (source.headers_detected || []).join(", ");
  const [name, setName] = useState(source.name || "");
  const [sourceType, setSourceType] = useState(source.source_type || "google_sheets");
  const [sheetUrl, setSheetUrl] = useState(source.sheet_url || "");
  const [spreadsheetId, setSpreadsheetId] = useState(source.spreadsheet_id || "");
  const [sheetName, setSheetName] = useState(source.sheet_name || "Sheet1");
  const [headers, setHeaders] = useState(initialHeaders);
  const [branchId, setBranchId] = useState(source.branch_id || "");
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
      branch_id: branchId || "",
      auto_sync_enabled: autoSyncEnabled,
      auto_sync_interval_minutes: Number(autoSyncInterval) || 60,
    };
    if (sourceType === "google_sheets") {
      payload.spreadsheet_id = spreadsheetId || extractSheetId(sheetUrl);
      payload.sheet_name = sheetName || "Sheet1";
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
          <Input placeholder="Worksheet/Tab name (default: Sheet1)" value={sheetName} onChange={(e) => setSheetName(e.target.value)} data-testid="mk-edit-source-sheetname" />
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
      <label className="text-xs font-medium text-slate-600">Branch</label>
      <select className="h-9 w-full rounded-md border border-slate-200 px-3 text-sm" value={branchId} onChange={(e) => setBranchId(e.target.value)} data-testid="mk-edit-source-branch">
        <option value="">All Branches (leads go to Pre-Sales as usual)</option>
        {branches.map((b) => <option key={b.id} value={b.id}>{b.branch_name}</option>)}
      </select>
      <p className="text-xs text-slate-400">Pick a branch if this sheet only ever has leads for ONE branch — every lead pulled from it will auto-assign straight there.</p>
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

      <div className="overflow-auto rounded-lg border border-slate-200">
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

  const loadSettings = useCallback(() => mkGetDistribution().then(setSettings).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { loadSettings(); }, [loadSettings]);

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
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={refresh} data-testid="mk-dist-refresh"><RefreshCw className="mr-1 h-4 w-4" />Refresh Team from Users</Button>
            <Button size="sm" onClick={() => setShowAdd(true)} data-testid="mk-add-team-btn"><Plus className="mr-1 h-4 w-4" />Add Team Member</Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <TeamCard title="Pre-Sales (Tier 1)" members={team.pre_sales || []} kind="pre_sales" />
        <TeamCard title="Sales — Branch Admins (Tier 2)" members={team.sales || []} kind="sales" />
      </div>

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

const TeamCard = ({ title, members, kind }) => (
  <Card data-testid={`mk-team-${kind}-card`}>
    <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
    <CardContent className="space-y-2">
      {members.length === 0 ? <p className="text-xs text-slate-400">No members.</p> : members.map((m) => (
        <div key={m.id} className="flex items-center justify-between rounded-md border border-slate-200 p-2" data-testid={`mk-team-row-${m.id}`}>
          <div>
            <p className="text-sm font-medium text-slate-800">{m.full_name}</p>
            <p className="text-[11px] text-slate-500">{m.email}</p>
          </div>
          <div className="text-right text-[11px] text-slate-600">
            <p><span className="font-semibold">{m.current_leads}</span> current · <span className="font-semibold">{m.deals_closed}</span> closed</p>
            <p className="text-emerald-600">{m.conversion_rate}% conv.</p>
          </div>
        </div>
      ))}
    </CardContent>
  </Card>
);

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
  const [tab, setTab] = useState("lead_sources");
  const [team, setTeam] = useState({ pre_sales: [], sales: [] });
  const reloadTeam = useCallback(() => mkGetTeam().then(setTeam).catch((e) => console.warn("[load failed]", e?.message || e)), []);
  useEffect(() => { reloadTeam(); }, [reloadTeam]);

  return (
    <div className="space-y-4" data-testid="marketing-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">Marketing Board</h2>
        <p className="text-sm text-slate-500">Source leads, distribute them, and track team performance.</p>
      </div>
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
