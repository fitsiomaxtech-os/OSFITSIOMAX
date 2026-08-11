import { Users, Target, Building2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One tier of the sales chain — its people, and how each is doing.
 *
 * Lives here rather than inside MarketingBoard because the Super Admin Dashboard shows
 * the same panels as its own tabs. One component, so the two screens can't drift into
 * reporting the same person differently.
 *
 * The tiers measure different things, so the tiles are named per tier rather than sharing
 * one set of labels: Pre-Sales is judged on how much of its book it converts, the branch
 * on how many of the appointments handed to it close.
 *
 * Every figure is one /marketing/team-members already computes. The only thing derived
 * here is the comparison against the team, and that is derived rather than fetched
 * precisely so it can never disagree with the rows it is drawn from.
 */

// Which two counts make the rate. Needed because the team's own rate is the totals
// divided — sum(closed) / sum(leads) — and NOT the average of everyone's percentages.
// The mean of rates lets someone with three leads and one conversion drag the team
// benchmark as hard as someone with nine hundred, which is not what a benchmark is for.
export const TEAM_TIERS = {
  pre_sales: {
    icon: Users,
    accent: "text-amber-600",
    avatar: "bg-amber-500",
    rate: { key: "conversion_rate", num: "deals_closed", den: "total_assigned" },
    tiles: [
      { key: "total_assigned", label: "Leads" },
      { key: "deals_closed", label: "Converted" },
      { key: "conversion_rate", label: "Rate", suffix: "%", isRate: true },
    ],
  },
  sales: {
    icon: Target,
    accent: "text-emerald-600",
    avatar: "bg-emerald-500",
    rate: { key: "conversion_rate", num: "deals_closed", den: "current_leads" },
    tiles: [
      { key: "current_leads", label: "Appointments" },
      { key: "deals_closed", label: "Deals Closed" },
      { key: "conversion_rate", label: "Close Rate", suffix: "%", isRate: true },
    ],
  },
  // Same rows, same numbers — but the Dashboard names this tab Branch, because each of
  // these accounts *is* a branch. So the row leads with the branch it stands for and
  // carries the branch's whole lead count as a fourth tile.
  branch: {
    icon: Building2,
    accent: "text-emerald-600",
    avatar: "bg-emerald-500",
    subline: "branch_name",
    rate: { key: "conversion_rate", num: "deals_closed", den: "current_leads" },
    tiles: [
      { key: "total_assigned", label: "Leads" },
      { key: "current_leads", label: "Appointments" },
      { key: "deals_closed", label: "Converted" },
      { key: "conversion_rate", label: "Close Rate", suffix: "%", isRate: true },
    ],
  },
};

// Above this many people, cards stop working: the panel becomes a scroll where the first
// person and the last can never be on screen together, and comparing them is the whole
// job. Three or fewer read better as cards, which is what the marketing board shows.
const TABLE_FROM = 4;

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** The team's own rate: the totals divided, not the mean of the percentages. */
const teamRate = (members, rate) => {
  const den = members.reduce((s, m) => s + num(m[rate.den]), 0);
  if (!den) return null;
  return (members.reduce((s, m) => s + num(m[rate.num]), 0) / den) * 100;
};

/**
 * How far above or below the team this person is, in percentage POINTS.
 *
 * Points, not percent: the difference between 13.8% and 8.8% is five points. Calling it
 * "57% better" is arithmetically true of the ratio and says something nobody means.
 */
const Delta = ({ value, team }) => {
  if (team == null || value == null) return null;
  const d = Math.round((num(value) - team) * 10) / 10;
  if (Math.abs(d) < 0.05) return <span className="text-[10px] font-semibold text-slate-400">at team avg</span>;
  return (
    <span className={`text-[10px] font-semibold ${d > 0 ? "text-emerald-600" : "text-amber-600"}`}>
      {d > 0 ? "+" : ""}{d} pts vs team
    </span>
  );
};

/** Colour is spent only here, on the one number a manager acts on. Everywhere else it was
    decorative — Leads is not "warm" and Rate is not "purple" — and three hues on every row
    left no hue free to mean anything. */
const rateTone = (value, team) => {
  if (team == null || value == null) return "text-slate-800";
  return num(value) + 0.05 < team ? "text-amber-600" : "text-emerald-600";
};

const nameOf = (m, tier) => (tier.subline && m[tier.subline]) || m.full_name;
const subOf = (m, tier) => (tier.subline && m[tier.subline] ? m.full_name : m.email);

/**
 * `benchmarkFrom` is who the team average is computed over, and it is NOT always the rows
 * on screen.
 *
 * Filtering Pre-Sales to one branch should re-benchmark: those agents are peers doing the
 * same job in the same place, and how they compare with each other is the question.
 *
 * Filtering Branch Performance to one branch must NOT: a branch's peers are the other
 * branches, and measuring it against itself gives every branch a delta of zero forever.
 *
 * So the caller says which. Defaulting to the rows shown keeps every existing caller
 * behaving exactly as it did.
 */
export const TeamCard = ({ title, subtitle, members = [], kind, benchmarkFrom }) => {
  const tier = TEAM_TIERS[kind] || TEAM_TIERS.pre_sales;
  const Icon = tier.icon;
  const avg = teamRate(benchmarkFrom || members, tier.rate);

  // Best rate first, so the person who needs help is findable rather than buried at
  // whatever position the roster happened to return them in.
  const rows = [...members].sort((a, b) => num(b[tier.rate.key]) - num(a[tier.rate.key]));

  return (
    <Card data-testid={`mk-team-${kind}-card`}>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className={`flex items-center gap-2 text-base ${tier.accent}`}>
              <Icon className="h-5 w-5 shrink-0" /> {title}
            </CardTitle>
            {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
          </div>
          {avg != null && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-right" data-testid={`mk-team-${kind}-avg`}>
              <p className="text-sm font-bold text-slate-700">{Math.round(avg * 10) / 10}%</p>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Team avg</p>
            </div>
          )}
        </div>
      </CardHeader>

      <CardContent className={rows.length >= TABLE_FROM ? "p-0 sm:px-6 sm:pb-6" : "space-y-3"}>
        {rows.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No members.</p>
        ) : rows.length >= TABLE_FROM ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-4 py-2.5 text-left font-semibold">Name</th>
                  {tier.tiles.map((t) => (
                    <th key={t.key} className="px-3 py-2.5 text-right font-semibold">{t.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((m) => (
                  <tr key={m.id} className="hover:bg-slate-50" data-testid={`mk-team-row-${m.id}`}>
                    <td className="px-4 py-3">
                      <p className="truncate font-medium text-slate-800">{nameOf(m, tier)}</p>
                      <p className="truncate text-[11px] text-slate-400">{subOf(m, tier)}</p>
                    </td>
                    {tier.tiles.map((t) => (
                      <td key={t.key} className="px-3 py-3 text-right" data-testid={`mk-team-tile-${m.id}-${t.key}`}>
                        <p className={`font-semibold ${t.isRate ? rateTone(m[t.key], avg) : "text-slate-700"}`}>
                          {m[t.key] ?? 0}{t.suffix || ""}
                        </p>
                        {t.isRate && <Delta value={m[t.key]} team={avg} />}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : rows.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid={`mk-team-row-${m.id}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${tier.avatar}`}>
                {(nameOf(m, tier) || "?").trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-slate-800">{nameOf(m, tier)}</p>
                <p className="truncate text-xs text-slate-500">{subOf(m, tier)}</p>
              </div>
            </div>
            <div className={`mt-3 grid gap-2 ${tier.tiles.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3"}`}>
              {tier.tiles.map((t) => (
                <div key={t.key} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center" data-testid={`mk-team-tile-${m.id}-${t.key}`}>
                  <p className={`truncate text-xl font-bold ${t.isRate ? rateTone(m[t.key], avg) : "text-slate-800"}`}>
                    {m[t.key] ?? 0}{t.suffix || ""}
                  </p>
                  <p className="truncate text-[10px] font-semibold uppercase tracking-wider text-slate-500">{t.label}</p>
                  {t.isRate && <Delta value={m[t.key]} team={avg} />}
                </div>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
};

export default TeamCard;
