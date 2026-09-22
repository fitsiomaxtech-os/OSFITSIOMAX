import { useCallback, useEffect, useRef, useState } from "react";
import {
  Banknote,
  Building2,
  CreditCard,
  Landmark,
  Loader2,
  MapPin,
  Eye,
  Pencil,
  Plus,
  QrCode,
  Trash2,
  Upload,
  User,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { Switch } from "@/components/ui/switch";
import {
  createBankAccount,
  deleteBankAccount,
  listBankAccounts,
  setBankAccountStatus,
  updateBankAccount,
  uploadBankQrImage,
} from "@/lib/api";

// The banks a counter in this group actually collects into, plus the escape hatch. A
// typed-in name would give the same bank three spellings across three cards, which is
// the one thing a list of accounts must not do; "Other" keeps that from becoming a
// reason to refuse an account the list has not heard of.
const BANK_NAMES = [
  "Axis Bank",
  "Bank of Baroda",
  "Bank of India",
  "Canara Bank",
  "Central Bank of India",
  "City Union Bank",
  "Federal Bank",
  "HDFC Bank",
  "ICICI Bank",
  "IDBI Bank",
  "IDFC FIRST Bank",
  "Indian Bank",
  "Indian Overseas Bank",
  "IndusInd Bank",
  "Karur Vysya Bank",
  "Kotak Mahindra Bank",
  "Punjab National Bank",
  "State Bank of India",
  "Tamilnad Mercantile Bank",
  "UCO Bank",
  "Union Bank of India",
  "Yes Bank",
];
const OTHER_BANK = "__other__";

const EMPTY_FORM = {
  bank_name: "",
  account_number: "",
  ifsc_code: "",
  upi_id: "",
  holder_name: "",
  bank_branch_name: "",
  qr_image_url: "",
  is_active: true,
};

// Every field the popup asks for, with the four that Save is refused without starred —
// the same four the backend checks, said here so the refusal arrives before the request
// rather than as a toast after it.
const FieldLabel = ({ icon: Icon, children, required }) => (
  <label className="mb-1.5 flex items-center gap-2 text-sm font-semibold text-slate-800">
    <Icon className="h-4 w-4 text-indigo-500" />
    {children}
    {required && <span className="text-rose-500">*</span>}
  </label>
);

const BankFormDialog = ({ account, branchId, branchName, onClose, onSaved }) => {
  const editing = !!account;
  const [form, setForm] = useState(() => (account ? { ...EMPTY_FORM, ...account } : { ...EMPTY_FORM }));
  // A bank already saved under a name this list does not carry opens on "Other" with
  // that name still in the box, so editing such a card does not silently blank it.
  const [otherBank, setOtherBank] = useState(
    () => !!account?.bank_name && !BANK_NAMES.includes(account.bank_name),
  );
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef(null);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const pickQr = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const { url } = await uploadBankQrImage(file);
      setForm((f) => ({ ...f, qr_image_url: url }));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not upload that image");
    } finally {
      setUploading(false);
    }
  };

  const save = async () => {
    const required = [
      [form.bank_name, "Bank name"],
      [form.account_number, "Account number"],
      [form.upi_id, "UPI ID"],
      [form.holder_name, "Holder name"],
      [form.qr_image_url, "QR image"],
    ];
    const missing = required.find(([value]) => !String(value || "").trim());
    if (missing) { toast.error(`${missing[1]} is required`); return; }
    setSaving(true);
    try {
      const payload = { ...form };
      // Scope travels only on the first save: the pill row picks which book a new
      // account is added to, and re-reading it on an edit would move a card to
      // whichever branch happened to be selected when someone fixed a typo.
      if (!editing) payload.branch_id = branchId || null;
      if (editing) await updateBankAccount(account.id, payload);
      else await createBankAccount(payload);
      toast.success(editing ? "Bank account updated" : "Bank account saved");
      onSaved();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not save this bank account");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-4" data-testid="finance-bank-dialog">
      <div className="my-auto w-full max-w-3xl rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
          <div className="flex items-start gap-4">
            <div className="rounded-xl bg-indigo-50 p-3">
              <Landmark className="h-6 w-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900">Bank Details</h3>
              <p className="text-sm text-slate-500">Please enter your bank account details and QR code for payment.</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="finance-bank-dialog-close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="grid gap-5 px-6 py-5 md:grid-cols-2">
          <div>
            <FieldLabel icon={Landmark} required>Bank Name</FieldLabel>
            <select
              value={otherBank ? OTHER_BANK : form.bank_name}
              onChange={(e) => {
                if (e.target.value === OTHER_BANK) { setOtherBank(true); setForm((f) => ({ ...f, bank_name: "" })); return; }
                setOtherBank(false);
                setForm((f) => ({ ...f, bank_name: e.target.value }));
              }}
              className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700"
              data-testid="finance-bank-name"
            >
              <option value="">Select your bank name</option>
              {BANK_NAMES.map((b) => <option key={b} value={b}>{b}</option>)}
              <option value={OTHER_BANK}>Other</option>
            </select>
            {otherBank && (
              <Input
                className="mt-2"
                placeholder="Enter bank name"
                value={form.bank_name}
                onChange={set("bank_name")}
                data-testid="finance-bank-name-other"
              />
            )}
          </div>

          <div>
            <FieldLabel icon={Building2}>IFSC Code</FieldLabel>
            <Input placeholder="Enter IFSC code" value={form.ifsc_code} onChange={set("ifsc_code")} data-testid="finance-bank-ifsc" />
          </div>

          <div>
            <FieldLabel icon={CreditCard} required>Account Number</FieldLabel>
            <Input placeholder="Enter account number" value={form.account_number} onChange={set("account_number")} data-testid="finance-bank-account-number" />
          </div>

          <div>
            <FieldLabel icon={MapPin}>Bank Branch Name</FieldLabel>
            <Input placeholder="Enter branch name" value={form.bank_branch_name} onChange={set("bank_branch_name")} data-testid="finance-bank-branch-name" />
          </div>

          <div className="space-y-5">
            <div>
              <FieldLabel icon={Banknote} required>UPI ID</FieldLabel>
              <Input placeholder="Enter UPI ID" value={form.upi_id} onChange={set("upi_id")} data-testid="finance-bank-upi-id" />
            </div>
            <div>
              <FieldLabel icon={User} required>Holder Name</FieldLabel>
              <Input placeholder="Enter account holder name" value={form.holder_name} onChange={set("holder_name")} data-testid="finance-bank-holder" />
            </div>
            {/* The same switch the card carries, so an account can be added already
                switched off -- one opened at the bank but not yet put up at a counter. */}
            <div
              className={`flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5 transition ${
                form.is_active ? "border-slate-200 bg-slate-50" : "border-rose-200 bg-rose-50"
              }`}
            >
              <div>
                <p className="text-sm font-semibold text-slate-800">Status</p>
                <p className={`text-xs ${form.is_active ? "text-slate-500" : "text-rose-600"}`}>
                  {form.is_active ? "Active — this account is collecting." : "Inactive — not offered for payment."}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs font-bold ${form.is_active ? "text-emerald-600" : "text-rose-600"}`}>
                  {form.is_active ? "ON" : "OFF"}
                </span>
                {/* Off is red, not grey. Grey reads as "nothing set here yet"; an account
                    switched off is a decision somebody made, and the card should say so
                    as loudly as the one that is collecting does. */}
                <Switch
                  checked={!!form.is_active}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, is_active: v }))}
                  className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-rose-500"
                  data-testid="finance-bank-status-switch"
                />
              </div>
            </div>
          </div>

          <div>
            <FieldLabel icon={QrCode} required>QR Image</FieldLabel>
            <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 text-center">
              <div className="mx-auto flex h-40 w-40 items-center justify-center rounded-lg bg-white p-2">
                {form.qr_image_url ? (
                  <img src={form.qr_image_url} alt="Payment QR" className="h-full w-full object-contain" data-testid="finance-bank-qr-preview" />
                ) : (
                  <QrCode className="h-16 w-16 text-slate-200" />
                )}
              </div>
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={pickQr} data-testid="finance-bank-qr-input" />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={uploading}
                className="mt-3 inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-indigo-100 text-sm font-semibold text-indigo-700 transition hover:bg-indigo-200 disabled:opacity-60"
                data-testid="finance-bank-qr-upload"
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {form.qr_image_url ? "Replace QR Image" : "Upload QR Image"}
              </button>
              <p className="mt-2 text-[11px] text-slate-500">Supported formats: JPG, PNG<br />(Max size: 5MB)</p>
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            className="h-11 rounded-lg border border-slate-200 px-6 text-sm font-semibold text-slate-600 hover:bg-slate-50"
            data-testid="finance-bank-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="inline-flex h-11 items-center gap-2 rounded-lg bg-indigo-600 px-8 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-60"
            data-testid="finance-bank-save"
          >
            {saving && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </button>
        </div>
      </div>
    </div>
  );
};

// The whole card, read-only, at a size a QR can actually be scanned off the screen at.
// Separate from the form rather than the form with its inputs disabled: what this is for
// is holding a phone up to the QR at a counter, and a page of greyed-out boxes around it
// is in the way of that.
const BankViewDialog = ({ account, onClose, onEdit }) => (
  <div className="fixed inset-0 z-40 flex items-center justify-center overflow-y-auto bg-black/40 p-4" data-testid="finance-bank-view-dialog">
    <div className="my-auto w-full max-w-2xl rounded-2xl bg-white shadow-xl">
      <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-6 py-5">
        <div className="flex items-start gap-4">
          <div className="rounded-xl bg-indigo-50 p-3">
            <Landmark className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-slate-900">{account.bank_name}</h3>
            <p className="text-sm text-slate-500">{account.holder_name}</p>
          </div>
        </div>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600" data-testid="finance-bank-view-close">
          <X className="h-5 w-5" />
        </button>
      </div>

      <div className="grid gap-6 px-6 py-5 sm:grid-cols-2">
        <div className="space-y-3">
          <ViewRow icon={Banknote} label="UPI ID" value={account.upi_id} />
          <ViewRow icon={CreditCard} label="Account Number" value={account.account_number} />
          <ViewRow icon={Building2} label="IFSC Code" value={account.ifsc_code} />
          <ViewRow icon={MapPin} label="Bank Branch Name" value={account.bank_branch_name} />
          <ViewRow icon={User} label="Holder Name" value={account.holder_name} />
          <div>
            <p className="text-xs text-slate-400">Status</p>
            <span
              className={`mt-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                account.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-100 text-rose-700"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${account.is_active ? "bg-emerald-500" : "bg-rose-500"}`} />
              {account.is_active ? "Active" : "Inactive"}
            </span>
          </div>
        </div>

        <div className="rounded-xl border border-dashed border-indigo-200 bg-indigo-50/40 p-4 text-center">
          <div className="mx-auto flex h-56 w-56 max-w-full items-center justify-center rounded-lg bg-white p-2">
            {account.qr_image_url ? (
              <img src={account.qr_image_url} alt={`${account.bank_name} QR`} className="h-full w-full object-contain" />
            ) : (
              <QrCode className="h-20 w-20 text-slate-200" />
            )}
          </div>
          <p className="mt-2 text-[11px] text-slate-500">Scan to pay by UPI</p>
        </div>
      </div>

      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onClose}
          className="h-11 rounded-lg border border-slate-200 px-6 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          data-testid="finance-bank-view-done"
        >
          Close
        </button>
        <button
          type="button"
          onClick={onEdit}
          className="inline-flex h-11 items-center gap-2 rounded-lg bg-indigo-600 px-6 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
          data-testid="finance-bank-view-edit"
        >
          <Pencil className="h-4 w-4" /> Edit
        </button>
      </div>
    </div>
  </div>
);

const ViewRow = ({ icon: Icon, label, value }) => (
  <div>
    <p className="flex items-center gap-1.5 text-xs text-slate-400"><Icon className="h-3.5 w-3.5" />{label}</p>
    <p className="break-words text-sm font-semibold text-slate-800">{value || "—"}</p>
  </div>
);

// Asked before the row goes, and asked by name: the grid can hold two cards for the same
// bank under different accounts, and "Delete this bank account?" over a grid of look-alike
// cards is not a question anyone can answer.
const DeleteBankDialog = ({ account, onCancel, onConfirm, busy }) => (
  <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="finance-bank-delete-dialog">
    <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
      <div className="flex items-start gap-4 px-6 py-5">
        <div className="rounded-xl bg-rose-50 p-3">
          <Trash2 className="h-6 w-6 text-rose-600" />
        </div>
        <div>
          <h3 className="text-lg font-bold text-slate-900">Delete this bank account?</h3>
          <p className="mt-1 text-sm text-slate-600">
            {account.bank_name} — {account.holder_name}
            {account.account_number ? ` (A/c ${account.account_number})` : ""}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            This removes the card and its details for good. To stop offering this account
            for payment while keeping it on the board, switch it off instead.
          </p>
        </div>
      </div>
      <div className="flex justify-end gap-3 border-t border-slate-200 px-6 py-4">
        <button
          type="button"
          onClick={onCancel}
          className="h-10 rounded-lg border border-slate-200 px-5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          data-testid="finance-bank-delete-cancel"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-rose-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-rose-700 disabled:opacity-60"
          data-testid="finance-bank-delete-confirm"
        >
          {busy && <Loader2 className="h-4 w-4 animate-spin" />}
          Delete
        </button>
      </div>
    </div>
  </div>
);

const Row = ({ label, value }) => (
  <div className="flex items-baseline justify-between gap-2 text-xs">
    <span className="text-slate-400">{label}</span>
    <span className="truncate font-semibold text-slate-700" title={value}>{value || "—"}</span>
  </div>
);

/**
 * Finance > UPI: the bank accounts this group collects into, four to a row, each with
 * the QR a patient scans on it.
 *
 * Scoped by the branch pill row above the board, the same way Expense is: a branch
 * picked shows that branch's own accounts and adds to them, All Branches shows every
 * account there is and adds one that belongs to the group rather than to a counter.
 */
export const BankAccountsBoard = ({ branchId, branchName }) => {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(null); // { account } — the Add/Edit popup
  const [viewing, setViewing] = useState(null); // the card being read, full size
  const [deleting, setDeleting] = useState(null); // the card awaiting its confirmation
  const [removing, setRemoving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listBankAccounts(branchId ? { branch_id: branchId } : {}));
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not load bank accounts");
    } finally {
      setLoading(false);
    }
  }, [branchId]);

  useEffect(() => { load(); }, [load]);

  // Flipped on the card first, then sent: the switch is the one control here that is a
  // whole action on its own, and a switch that waits on a round trip to move reads as a
  // switch that did not take. Put back if the server refuses it.
  const toggleStatus = async (acc) => {
    const next = !acc.is_active;
    setRows((prev) => prev.map((r) => (r.id === acc.id ? { ...r, is_active: next } : r)));
    try {
      await setBankAccountStatus(acc.id, next);
      toast.success(next ? `${acc.bank_name} is active` : `${acc.bank_name} is inactive`);
    } catch (err) {
      setRows((prev) => prev.map((r) => (r.id === acc.id ? { ...r, is_active: acc.is_active } : r)));
      toast.error(err?.response?.data?.detail || "Could not change that account's status");
    }
  };

  const remove = async () => {
    setRemoving(true);
    try {
      const { message } = await deleteBankAccount(deleting.id);
      toast.success(message || "Bank account removed");
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Could not delete this bank account");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div className="space-y-4" data-testid="finance-bank-accounts-root">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3">
        <div>
          <h3 className="text-sm font-bold text-slate-800">Bank Accounts</h3>
          <p className="text-xs text-slate-500">
            {branchId ? `Accounts saved for ${branchName || "this branch"}.` : "Every account saved, across the group."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ account: null })}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700"
          data-testid="finance-bank-add"
        >
          <Plus className="h-4 w-4" /> Add Bank
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-16 text-sm text-slate-500">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading bank accounts…
        </div>
      ) : rows.length === 0 ? (
        <div
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"
          data-testid="finance-bank-empty"
        >
          <QrCode className="h-8 w-8 text-slate-300" />
          <p className="text-sm font-semibold text-slate-700">No bank account yet</p>
          <p className="max-w-sm text-xs text-slate-500">Add the account this counter collects into, with the QR a patient scans to pay.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" data-testid="finance-bank-grid">
          {rows.map((acc) => (
            <div
              key={acc.id}
              className={`flex flex-col rounded-xl border p-4 shadow-sm transition ${
                acc.is_active ? "border-slate-200 bg-white" : "border-rose-200 bg-rose-50/40"
              }`}
              data-testid={`finance-bank-card-${acc.id}`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={`truncate text-sm font-bold ${acc.is_active ? "text-slate-900" : "text-rose-900"}`} title={acc.bank_name}>{acc.bank_name}</p>
                  <p className="truncate text-xs text-slate-500" title={acc.holder_name}>{acc.holder_name}</p>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-center rounded-lg bg-slate-50 p-2">
                {acc.qr_image_url ? (
                  <img
                    src={acc.qr_image_url}
                    alt={`${acc.bank_name} QR`}
                    className={`h-28 w-28 object-contain transition ${acc.is_active ? "" : "opacity-40 grayscale"}`}
                  />
                ) : (
                  <QrCode className="h-16 w-16 text-slate-200" />
                )}
              </div>

              <div className="mt-3 space-y-1.5">
                <Row label="UPI ID" value={acc.upi_id} />
                <Row label="A/c No." value={acc.account_number} />
                <Row label="IFSC" value={acc.ifsc_code} />
                <Row label="Branch" value={acc.bank_branch_name} />
              </div>

              {/* On or off, right on the card: whether this account is being offered for
                  payment is the one thing about it that changes without anything else
                  about it changing, so it does not go behind Edit. */}
              <div className={`mt-3 flex items-center justify-between gap-2 border-t pt-3 ${acc.is_active ? "border-slate-100" : "border-rose-100"}`}>
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    acc.is_active ? "bg-emerald-50 text-emerald-700" : "bg-rose-100 text-rose-700"
                  }`}
                  data-testid={`finance-bank-status-${acc.id}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${acc.is_active ? "bg-emerald-500" : "bg-rose-500"}`} />
                  {acc.is_active ? "Active" : "Inactive"}
                </span>
                <Switch
                  checked={!!acc.is_active}
                  onCheckedChange={() => toggleStatus(acc)}
                  className="data-[state=checked]:bg-emerald-500 data-[state=unchecked]:bg-rose-500"
                  aria-label={acc.is_active ? "Deactivate this account" : "Activate this account"}
                  data-testid={`finance-bank-toggle-${acc.id}`}
                />
              </div>

              {/* Which book this card belongs to. Only where the grid is showing more
                  than one branch's — under a picked branch every card is that branch's
                  and the chip would say the same thing on all of them. */}
              {!branchId && (
                <span className="mt-3 inline-flex w-fit items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                  <Building2 className="h-3 w-3" /> {acc.branch_name || "All Branches"}
                </span>
              )}

              {/* The three things there are to do with a saved card. `mt-auto` holds this
                  row to the foot of every card in the row, so cards of different heights
                  — one with a bank branch typed in, one without — still line their
                  buttons up. Delete last and apart, in red, since it is the one that
                  cannot be taken back. */}
              <div className="mt-auto flex items-center gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setViewing(acc)}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
                  data-testid={`finance-bank-view-${acc.id}`}
                >
                  <Eye className="h-3.5 w-3.5" /> View
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ account: acc })}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-xs font-semibold text-indigo-700 transition hover:bg-indigo-100"
                  data-testid={`finance-bank-edit-${acc.id}`}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  type="button"
                  onClick={() => setDeleting(acc)}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-md border border-rose-200 bg-rose-50 text-xs font-semibold text-rose-700 transition hover:bg-rose-100"
                  data-testid={`finance-bank-delete-${acc.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {viewing && (
        <BankViewDialog
          account={viewing}
          onClose={() => setViewing(null)}
          onEdit={() => { setDialog({ account: viewing }); setViewing(null); }}
        />
      )}

      {deleting && (
        <DeleteBankDialog
          account={deleting}
          busy={removing}
          onCancel={() => setDeleting(null)}
          onConfirm={remove}
        />
      )}

      {dialog && (
        <BankFormDialog
          account={dialog.account}
          branchId={branchId}
          branchName={branchName}
          onClose={() => setDialog(null)}
          onSaved={() => { setDialog(null); load(); }}
        />
      )}
    </div>
  );
};

export default BankAccountsBoard;
