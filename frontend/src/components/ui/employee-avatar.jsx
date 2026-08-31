import { useEffect, useState } from "react";

/**
 * An employee's face where there is one, their initial where there is not.
 *
 * One component for the directory, the record, the form and the signed-in header, so a
 * photo cannot appear in some of those and not others, and so the fallback is the same
 * shape as the photo — a row of avatars that changed size depending on who had uploaded
 * one would read as broken layout rather than as missing pictures.
 *
 * Lives here rather than in HRBoard because HR is no longer the only board that shows a
 * face: the header shows whoever is signed in, and a second copy of this would be a
 * second set of rules about what happens when the file is missing.
 */
export const EmployeeAvatar = ({
  employee,
  size = 40,
  className = "",
  // The tint the initial sits in where there is no photo. A prop rather than something a
  // caller appends to `className`, because two Tailwind background utilities on one
  // element are settled by the stylesheet's order and not by the order they are written
  // in — a caller "overriding" bg-slate-100 that way would work or not depending on the
  // build. Boards that colour experts in their own hue (the booking popup's CONSULTANT
  // column is teal) pass theirs; everywhere else keeps the neutral default.
  fallbackClassName = "bg-slate-100 text-slate-500",
}) => {
  // Reset on the employee changing, not just on error: a failed load left the fallback
  // showing for whoever was rendered into the same slot next.
  const [failed, setFailed] = useState(false);
  const url = employee?.photo_url || "";
  useEffect(() => { setFailed(false); }, [url]);

  const box = { width: size, height: size };
  if (!url || failed) {
    return (
      <div
        className={`flex shrink-0 items-center justify-center rounded-full font-semibold uppercase ${fallbackClassName} ${className}`}
        style={{ ...box, fontSize: Math.max(11, Math.round(size * 0.4)) }}
        aria-hidden="true"
      >
        {(employee?.full_name || "?").trim().charAt(0) || "?"}
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-full object-cover ${className}`}
      style={box}
    />
  );
};

export default EmployeeAvatar;
