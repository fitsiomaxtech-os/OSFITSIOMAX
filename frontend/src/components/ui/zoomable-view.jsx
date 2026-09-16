import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";

/**
 * Zoom for a document somebody is reading on screen — a scanned report, a prescription
 * photo, a diet chart.
 *
 * Every viewer opens at the whole page fitted to the panel: the first look at a document
 * is "what is this", and a picture that opens cropped hides the answer. Zooming in is then
 * the reader's choice, with the page scrollable (and draggable) around the part they want.
 *
 * One zoom level, `scale`, relative to that fitted size — 1 is "the whole thing fits".
 */

const MIN_SCALE = 0.5;
const MAX_SCALE = 6;
const STEP = 1.25;

const clamp = (v) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, v));

const ZoomToolbar = ({ percent, onIn, onOut, onFit, canIn, canOut, dark, testid }) => {
  const btn = `rounded-md p-1.5 transition disabled:opacity-40 ${
    dark ? "text-white hover:bg-white/15" : "text-slate-700 hover:bg-slate-100"
  }`;
  return (
    <div
      className={`pointer-events-auto flex items-center gap-0.5 rounded-lg border px-1 py-0.5 shadow-md ${
        dark ? "border-white/20 bg-slate-800/90" : "border-slate-200 bg-white/95"
      }`}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      data-testid={`${testid}-toolbar`}
    >
      <button type="button" onClick={onOut} disabled={!canOut} className={btn} title="Zoom out" aria-label="Zoom out" data-testid={`${testid}-zoom-out`}>
        <ZoomOut className="h-4 w-4" />
      </button>
      <span className={`min-w-[3rem] text-center text-[11px] font-semibold tabular-nums ${dark ? "text-white/80" : "text-slate-600"}`}>
        {percent}
      </span>
      <button type="button" onClick={onIn} disabled={!canIn} className={btn} title="Zoom in" aria-label="Zoom in" data-testid={`${testid}-zoom-in`}>
        <ZoomIn className="h-4 w-4" />
      </button>
      <button type="button" onClick={onFit} className={btn} title="Full view (fit to screen)" aria-label="Full view" data-testid={`${testid}-zoom-fit`}>
        <Maximize className="h-4 w-4" />
      </button>
    </div>
  );
};

/**
 * An image that opens fitted whole to its box, with zoom in / out / full view.
 *
 * The box must have a definite height (h-full inside a sized parent, or an explicit h-*):
 * "fit" is measured against it.
 */
// Keyed on src: a new picture opens at full view again, measured afresh.
export const ZoomableImage = (props) => <ZoomableImageView key={props.src} {...props} />;

const ZoomableImageView = ({ src, alt, className = "", dark = false, testid = "zoomable-image" }) => {
  const boxRef = useRef(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [scale, setScale] = useState(1);
  // Where the view should be centred after the next size change, as a fraction of the image.
  const anchor = useRef(null);
  const drag = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fitted size: the whole picture inside the box, never blown up past its own pixels.
  const pad = 16;
  const fit = natural.w && box.w
    ? Math.min((box.w - pad) / natural.w, (box.h - pad) / natural.h, 1)
    : 0;
  const width = fit ? natural.w * fit * scale : 0;
  const height = fit ? natural.h * fit * scale : 0;

  const zoomTo = useCallback((next) => {
    const el = boxRef.current;
    if (el && el.scrollWidth) {
      anchor.current = {
        x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth,
        y: (el.scrollTop + el.clientHeight / 2) / el.scrollHeight,
      };
    }
    setScale((s) => clamp(typeof next === "function" ? next(s) : next));
  }, []);

  // Keep the spot the reader was looking at in the middle as the picture grows or shrinks.
  useLayoutEffect(() => {
    const el = boxRef.current;
    const a = anchor.current;
    if (!el || !a) return;
    anchor.current = null;
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2;
    el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2;
  }, [scale]);

  // Ctrl/⌘ + wheel (and a trackpad pinch, which browsers report the same way) zooms.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      zoomTo((s) => (e.deltaY < 0 ? s * 1.1 : s / 1.1));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomTo]);

  const zoomed = width > box.w || height > box.h;

  const onPointerDown = (e) => {
    if (!zoomed || e.pointerType === "touch") return;
    const el = boxRef.current;
    drag.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };
  const onPointerMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const el = boxRef.current;
    el.scrollLeft = d.left - (e.clientX - d.x);
    el.scrollTop = d.top - (e.clientY - d.y);
  };
  const endDrag = () => { drag.current = null; };

  return (
    <div className={`relative h-full w-full ${className}`} data-testid={testid}>
      <div
        ref={boxRef}
        className={`flex h-full w-full overflow-auto ${zoomed ? "cursor-grab active:cursor-grabbing" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onDoubleClick={() => zoomTo((s) => (s > 1 ? 1 : 2))}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          // m-auto rather than flex centering: a centred flex child wider than its scroll box
          // gets its left edge cut off where scrolling cannot reach it.
          className="m-auto block max-w-none select-none rounded"
          style={fit ? { width, height } : { maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
          data-testid={`${testid}-img`}
        />
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <ZoomToolbar
          percent={fit ? `${Math.round(fit * scale * 100)}%` : "—"}
          onIn={() => zoomTo((s) => s * STEP)}
          onOut={() => zoomTo((s) => s / STEP)}
          onFit={() => zoomTo(1)}
          canIn={scale < MAX_SCALE}
          canOut={scale > MIN_SCALE}
          dark={dark}
          testid={testid}
        />
      </div>
    </div>
  );
};

/**
 * A PDF in the browser's own viewer, opened at the whole page (`#view=Fit`), with the same
 * zoom controls as an image. The viewer reads its zoom from the URL fragment only when it
 * loads, so a zoom step reloads the frame — a blob URL, so that is instant and offline.
 */
const PDF_STEPS = [50, 75, 100, 125, 150, 200, 300, 400];

export const ZoomablePdf = (props) => <ZoomablePdfView key={props.src} {...props} />;

const ZoomablePdfView = ({ src, title, className = "h-full w-full", dark = false, testid = "zoomable-pdf" }) => {
  // null = full view (fit the page); otherwise a percentage from PDF_STEPS.
  const [zoom, setZoom] = useState(null);

  const idx = zoom == null ? -1 : PDF_STEPS.indexOf(zoom);
  const zoomIn = () => setZoom(zoom == null ? 100 : PDF_STEPS[Math.min(idx + 1, PDF_STEPS.length - 1)]);
  const zoomOut = () => setZoom(zoom == null ? 50 : PDF_STEPS[Math.max(idx - 1, 0)]);
  const frameSrc = zoom == null ? `${src}#view=Fit&zoom=page-fit` : `${src}#zoom=${zoom}`;

  return (
    <div className={`relative ${className}`} data-testid={testid}>
      <iframe key={frameSrc} src={frameSrc} title={title} className="h-full w-full border-0" data-testid={`${testid}-frame`} />
      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <ZoomToolbar
          percent={zoom == null ? "Fit" : `${zoom}%`}
          onIn={zoomIn}
          onOut={zoomOut}
          onFit={() => setZoom(null)}
          canIn={zoom !== PDF_STEPS[PDF_STEPS.length - 1]}
          canOut={zoom !== PDF_STEPS[0]}
          dark={dark}
          testid={testid}
        />
      </div>
    </div>
  );
};
