import { useState } from "react";
import { Stethoscope, CalendarRange, Pill, Dumbbell, ShoppingCart } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const TABS = [
  { key: "consultations", label: "Consultations", icon: Stethoscope },
  { key: "sessions", label: "Sessions", icon: CalendarRange },
  { key: "tablet", label: "Tablet", icon: Pill },
  { key: "equipment", label: "Equipment", icon: Dumbbell },
  { key: "vending_machine", label: "Vending Machine", icon: ShoppingCart },
];

const PlaceholderPanel = ({ label, testid }) => (
  <Card data-testid={testid}>
    <CardContent className="p-8 text-center text-sm text-slate-400">
      {label} panel — setup coming soon.
    </CardContent>
  </Card>
);

export const PackagesBoard = () => {
  const [tab, setTab] = useState("consultations");

  return (
    <div className="space-y-4" data-testid="packages-board">
      <div>
        <h2 className="text-2xl font-bold text-slate-900">FITSIO STORE</h2>
        <p className="text-sm text-slate-500">Manage Consultations, Sessions, Tablet, Equipment, and Vending Machine.</p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-lg border border-slate-200 bg-white p-1" data-testid="packages-subtabs">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              data-testid={`packages-subtab-${t.key}`}
              className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition ${active ? "bg-violet-50 text-violet-600" : "text-slate-600 hover:bg-slate-50"}`}
            >
              <Icon className="h-4 w-4" />{t.label}
            </button>
          );
        })}
      </div>

      {TABS.map((t) => tab === t.key && (
        <PlaceholderPanel key={t.key} label={t.label} testid={`packages-panel-${t.key}`} />
      ))}
    </div>
  );
};

export default PackagesBoard;
