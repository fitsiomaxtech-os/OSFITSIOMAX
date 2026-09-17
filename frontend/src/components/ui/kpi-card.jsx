/**
 * The figure tile every HR screen counts with: a bordered white card holding an icon, a
 * small uppercase label, the number, and an optional line of explanation under it.
 *
 * Lives here rather than in HRBoard.jsx because HR's Dashboard is no longer the only board
 * that shows one — the EOD Report tab counts with the same tiles, and two copies of this
 * would be two cards that drift apart a release later.
 *
 * A tile with no `onClick` renders as plain text rather than a button, so a card that
 * leads nowhere never invites a click that does nothing. `onClick` makes it one: the tile
 * is then the way into the rows behind the figure.
 * `active` marks the one whose list is currently on screen, for a board where the tiles
 * switch between lists rather than navigating away.
 */

export const KPI = ({ label, value, icon: Icon, onClick, hint, active = false, testid }) => {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      {...(onClick ? { type: "button", onClick } : {})}
      className={`w-full rounded-xl border-2 bg-white px-4 py-3.5 text-left transition ${
        active ? "border-sky-400 shadow-sm" : "border-slate-200"
      } ${onClick ? "cursor-pointer hover:border-sky-300 hover:shadow-sm" : ""}`}
      data-testid={testid}
    >
      <span className={`flex items-center gap-1.5 ${active ? "text-sky-600" : "text-slate-500"}`}>
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate text-[11px] font-bold uppercase tracking-wider">{label}</span>
      </span>
      <span className="mt-1 block text-3xl font-extrabold text-slate-800">{value}</span>
      {hint && <span className="mt-0.5 block text-[10px] text-slate-400">{hint}</span>}
    </Tag>
  );
};

export default KPI;
