import { Users, Target } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * One tier of the sales chain — its people, and how each is doing.
 *
 * Lives here rather than inside MarketingBoard because the Super Admin Dashboard shows
 * the same two panels as its own tabs. One component, so the two screens can't drift
 * into reporting the same person differently.
 *
 * The two tiers measure different things, so the tiles are named per tier rather than
 * sharing one set of labels: tier 1 is judged on how much of its book it converts, tier 2
 * on how many of the appointments handed to it close.
 *
 * Every figure is one /marketing/team-members already computes — nothing is derived here,
 * so the tile says what the endpoint counted. "Converted" is leads that reached Assigned
 * Physio; it is deliberately not called "Appt Booked", which is a different event and one
 * nothing currently counts per agent.
 */
export const TEAM_TIERS = {
  pre_sales: {
    icon: Users,
    accent: "text-amber-600",
    avatar: "bg-amber-500",
    tiles: [
      { key: "total_assigned", label: "Leads", tone: "text-amber-600" },
      { key: "deals_closed", label: "Converted", tone: "text-emerald-600" },
      { key: "conversion_rate", label: "Rate", tone: "text-violet-600", suffix: "%" },
    ],
  },
  sales: {
    icon: Target,
    accent: "text-emerald-600",
    avatar: "bg-emerald-500",
    tiles: [
      { key: "current_leads", label: "Appointments", tone: "text-emerald-600" },
      { key: "deals_closed", label: "Deals Closed", tone: "text-emerald-600" },
      { key: "conversion_rate", label: "Close Rate", tone: "text-violet-600", suffix: "%" },
    ],
  },
};

export const TeamCard = ({ title, subtitle, members, kind }) => {
  const tier = TEAM_TIERS[kind] || TEAM_TIERS.pre_sales;
  const Icon = tier.icon;
  return (
    <Card data-testid={`mk-team-${kind}-card`}>
      <CardHeader className="pb-3">
        <CardTitle className={`flex items-center gap-2 text-base ${tier.accent}`}>
          <Icon className="h-5 w-5 shrink-0" /> {title}
        </CardTitle>
        {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
      </CardHeader>
      <CardContent className="space-y-3">
        {members.length === 0 ? (
          <p className="py-6 text-center text-xs text-slate-400">No members.</p>
        ) : members.map((m) => (
          <div key={m.id} className="rounded-xl border border-slate-200 bg-slate-50/60 p-3" data-testid={`mk-team-row-${m.id}`}>
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-base font-bold text-white ${tier.avatar}`}>
                {(m.full_name || "?").trim().charAt(0).toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-bold text-slate-800">{m.full_name}</p>
                <p className="truncate text-xs text-slate-500">{m.email}</p>
              </div>
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {tier.tiles.map((t) => (
                <div key={t.key} className="rounded-lg border border-slate-200 bg-white px-2 py-2 text-center" data-testid={`mk-team-tile-${m.id}-${t.key}`}>
                  <p className={`truncate text-xl font-bold ${t.tone}`}>{m[t.key] ?? 0}{t.suffix || ""}</p>
                  <p className="truncate text-[11px] text-slate-500">{t.label}</p>
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
