import { useMemo, useState } from "react";
import { Building2, Search, Users, X } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { roleLabel, roleClasses } from "@/lib/roles";

/**
 * Dashboard > Team — who actually works here.
 *
 * The two panels below this one measure the sales chain: Pre-Sales agents and the branch
 * accounts, and only those, because they are the two rosters that carry a conversion rate.
 * Everybody else — the consultants, the physios, the nutritionists, HR, Finance — has held
 * a login the whole time and appeared on no screen a Super Admin opens to ask "who works
 * here, and where". That question is this card.
 *
 * It reads /hr/users and /hr/employees, the two lists HR Admin already renders, rather
 * than a new endpoint: those records ARE the staff list, and a third source would let the
 * screens disagree about who is employed. Role names and colours come from lib/roles.js
 * for the same reason.
 *
 * Both lists, because neither is the whole payroll on its own. An account is how somebody
 * gets into the OS, and plenty of people who work here — the ones whose job never needs a
 * login — have only the employee record. Listing accounts alone would have answered "who
 * works at Fitsiomax" with "everyone we issued a password to".
 *
 * Grouped by branch, because "who works in the branches" is the half of the question the
 * rest of the Dashboard cannot answer, and because a flat list of every account sorted by
 * name says nothing about where anyone sits.
 */

const num = (n) => (Number.isFinite(Number(n)) ? Number(n) : 0);

/** Live branch ids an account is posted to. An account carries either `branches` — the
 *  enriched list /hr/users builds from branch_ids or branch_id — or nothing at all. Ids
 *  pointing at a branch that no longer exists are dropped, so a deleted branch leaves the
 *  person unposted rather than filed under a heading nothing can draw. */
const postedIds = (u, liveIds) => (u.branches || []).map((b) => b.id).filter((id) => id && liveIds.has(id));

/** Somebody with an employee record and no account, in the shape the rest of this card
 *  reads. Their job title stands in for the role they were never given, and no_login says
 *  why the badge is a designation rather than one of the coloured role names. */
const fromEmployee = (e) => ({
  id: `emp-${e.id}`,
  full_name: e.full_name,
  email: e.email || e.employee_code || "",
  role: "",
  no_login: true,
  linked_employee: { designation: e.designation, department: e.department, employee_code: e.employee_code },
  // branch_ids for a desk that covers several, otherwise the single branch_id the endpoint
  // has already resolved (falling back to the linked account's, where the record itself
  // carries none).
  branches: ((e.branch_ids || []).length ? e.branch_ids : [e.branch_id]).filter(Boolean).map((id) => ({ id })),
});

/** What the badge on a row says: the role for an account, the job title for somebody who
 *  has no account to carry one. */
const badgeOf = (u) => (u.role ? roleLabel(u.role) : String(u.linked_employee?.designation || "").toUpperCase() || "NO ROLE SET");

/** Which chip a person is counted under. Designations are namespaced so a job title can
 *  never collide with a role slug that happens to read the same. */
const groupKeyOf = (u) => (u.role ? u.role : `job:${String(u.linked_employee?.designation || "").toLowerCase()}`);

const designationOf = (u) => {
  const d = u.linked_employee?.designation;
  if (!d) return "";
  // Dropped when it only repeats the badge beside it — "PHYSIOTHERAPIST" twice on one row
  // is noise, not detail. That is always the case for a login-less person, whose badge IS
  // the designation.
  return String(d).trim().toLowerCase() === String(badgeOf(u) || "").trim().toLowerCase() ? "" : d;
};

const matches = (u, q) => {
  if (!q) return true;
  const hay = [u.full_name, u.email, badgeOf(u), u.linked_employee?.designation, u.linked_employee?.department, u.linked_employee?.employee_code]
    .filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q);
};

const Person = ({ user, extraBranches }) => (
  <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-3" data-testid={`roster-person-${user.id}`}>
    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-500">
      {(user.full_name || user.email || "?").trim().charAt(0).toUpperCase()}
    </span>
    <div className="min-w-0 flex-1">
      <p className="truncate text-sm font-semibold text-slate-800">{user.full_name || "Unnamed account"}</p>
      <p className="truncate text-[11px] text-slate-400">{user.email}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-[5px] border px-1.5 py-0.5 text-[10px] font-bold ${roleClasses(user.role)}`}>{badgeOf(user)}</span>
        {designationOf(user) && <span className="truncate text-[11px] text-slate-500">{designationOf(user)}</span>}
        {/* Said plainly rather than left to be inferred from a colourless badge: this
            person works here and cannot sign in, which is a fact about the OS and not
            about them. */}
        {user.no_login && (
          <span className="rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-400">no login</span>
        )}
        {/* Somebody who covers several branches is listed under each of them, so the row
            says how many others — otherwise one person reads as several. */}
        {extraBranches > 0 && (
          <span className="rounded-[5px] border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
            +{extraBranches} more {extraBranches === 1 ? "branch" : "branches"}
          </span>
        )}
      </div>
    </div>
  </div>
);

const Section = ({ title, sub, people, liveIds, empty, testid }) => (
  <div data-testid={testid}>
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-1.5">
      <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Building2 className="h-4 w-4 text-slate-300" /> {title}
        {sub && <span className="text-[11px] font-normal text-slate-400">{sub}</span>}
      </p>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
        {people.length} {people.length === 1 ? "person" : "people"}
      </span>
    </div>
    {people.length === 0 ? (
      <p className="py-3 text-xs text-slate-400">{empty}</p>
    ) : (
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {people.map((u) => (
          <Person key={u.id} user={u} extraBranches={Math.max(0, postedIds(u, liveIds).length - 1)} />
        ))}
      </div>
    )}
  </div>
);

/**
 * `branches` is every live branch — it decides which postings are real. `visibleBranches`
 * is the subset the tab's All/Offline/Online + branch filter has left on screen, and it is
 * the only thing that decides which sections are drawn.
 *
 * `showUnposted` goes false the moment that filter narrows to a mode or a branch: an
 * accountant belongs to no branch, so listing them under Online would be the filter
 * quietly not applying.
 */
export const StaffRoster = ({ users, employees, loading, branches = [], visibleBranches = [], showUnposted = true }) => {
  const [query, setQuery] = useState("");
  const [role, setRole] = useState("");

  const liveIds = useMemo(() => new Set(branches.map((b) => b.branch_id)), [branches]);

  // Only accounts that can still be logged into, and only employees still on the books. A
  // deactivated login or a left employee is somebody who has gone, and answering "who
  // works here" with them in the list is the one way this card can be actively wrong.
  //
  // An employee whose account already appears is dropped rather than shown twice: the two
  // records are one person, and the account is the half that carries the role.
  const active = useMemo(() => {
    const rows = (users || []).filter((u) => u.is_active !== false);
    const linked = new Set(rows.map((u) => u.employee_id).filter(Boolean));
    const unlinked = (employees || [])
      .filter((e) => e.id && !linked.has(e.id) && (e.status || "active") === "active")
      .map(fromEmployee);
    return [...rows, ...unlinked];
  }, [users, employees]);

  // Everyone the branch filter leaves in scope, before the search box and the role chips
  // narrow it further — a chip has to stay on screen after you pick it, and its count has
  // to count the branch scope rather than itself.
  const inScope = useMemo(() => {
    const visible = new Set(visibleBranches.map((b) => b.branch_id));
    return active.filter((u) => {
      const posted = postedIds(u, liveIds);
      return posted.length === 0 ? showUnposted : posted.some((id) => visible.has(id));
    });
  }, [active, visibleBranches, liveIds, showUnposted]);

  // One chip per role, plus one per job title held by somebody with no account — the
  // company by job, whether or not the job comes with a password.
  const roleCounts = useMemo(() => {
    const m = new Map();
    inScope.forEach((u) => {
      const key = groupKeyOf(u);
      const row = m.get(key) || { key, label: badgeOf(u), slug: u.role || "", count: 0 };
      row.count += 1;
      m.set(key, row);
    });
    return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  }, [inScope]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return inScope
      .filter((u) => (!role || groupKeyOf(u) === role) && matches(u, q))
      .sort((a, b) => badgeOf(a).localeCompare(badgeOf(b)) || (a.full_name || "").localeCompare(b.full_name || ""));
  }, [inScope, role, query]);

  if (loading) {
    return <Card><CardContent className="py-12 text-center text-sm text-slate-400">Loading the roster...</CardContent></Card>;
  }

  const sections = visibleBranches.map((b) => ({
    key: b.branch_id,
    title: b.branch_name || "Unnamed branch",
    people: shown.filter((u) => postedIds(u, liveIds).includes(b.branch_id)),
  }));
  const unposted = showUnposted ? shown.filter((u) => postedIds(u, liveIds).length === 0) : [];

  // Both headline figures read the branch scope, never the search — a "Branches staffed"
  // that fell to 1/6 while you typed a name would be reporting the search box rather than
  // the company, and it sits beside a headcount that doesn't move.
  const staffedBranches = visibleBranches.filter((b) => inScope.some((u) => postedIds(u, liveIds).includes(b.branch_id))).length;
  const narrowed = !!(query.trim() || role);

  return (
    <Card data-testid="dashboard-roster-card">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base text-slate-700">
              <Users className="h-5 w-5 shrink-0" /> Who Works Here
            </CardTitle>
            <p className="text-sm text-slate-500">Every active account at Fitsiomax, and the branch they work at</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right" data-testid="roster-headcount">
              <p className="text-sm font-bold text-slate-700">{inScope.length}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">People</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right">
              <p className="text-sm font-bold text-slate-700">{staffedBranches}/{visibleBranches.length}</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Branches staffed</p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name, email, role or designation"
              className="h-9 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-700 placeholder:text-slate-300"
              data-testid="roster-search"
            />
          </div>
          {narrowed && (
            <button
              type="button"
              onClick={() => { setQuery(""); setRole(""); }}
              className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:text-rose-800"
              data-testid="roster-clear"
            >
              <X className="h-3.5 w-3.5" /> Clear
            </button>
          )}
        </div>

        {/* The whole company by job, in one row. Answers "who all works here" before any
            scrolling, and doubles as the role filter for the sections below. */}
        <div className="flex flex-wrap gap-1.5">
          {roleCounts.map((r) => (
            <button
              key={r.key}
              type="button"
              onClick={() => setRole(role === r.key ? "" : r.key)}
              className={`rounded-[5px] border px-2 py-1 text-[10px] font-bold transition ${
                role === r.key ? "border-sky-400 bg-sky-50 text-sky-700" : roleClasses(r.slug)
              }`}
              data-testid={`roster-role-${r.key}`}
            >
              {r.label} · {r.count}
            </button>
          ))}
        </div>

        {inScope.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">No accounts in this scope yet.</p>
        ) : shown.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-400">Nobody matches that search.</p>
        ) : (
          <div className="space-y-5">
            {sections.map((s) => (
              <Section
                key={s.key}
                testid={`roster-branch-${s.key}`}
                title={s.title}
                people={s.people}
                liveIds={liveIds}
                empty={narrowed ? "Nobody here matches that search." : "Nobody is posted to this branch yet."}
              />
            ))}
            {showUnposted && (
              <Section
                testid="roster-company-wide"
                title="Company-wide"
                sub="not posted to a branch"
                people={unposted}
                liveIds={liveIds}
                empty={narrowed ? "Nobody here matches that search." : "Every account is posted to a branch."}
              />
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default StaffRoster;
