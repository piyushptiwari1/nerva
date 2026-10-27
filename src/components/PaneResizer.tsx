import { useCallback, useRef } from "react";

/**
 * Vertical drag handle between two panes. Pointer-capture based so a fast
 * drag that leaves the 8px hit area keeps resizing. Double-click resets.
 * Keyboard: arrows nudge by 16px (Shift = 64px).
 */
export function PaneResizer({
  value,
  onChange,
  onReset,
  side,
  label,
}: {
  value: number;
  onChange: (px: number) => void;
  onReset: () => void;
  /** Which pane the handle controls: dragging right grows "left", shrinks "right". */
  side: "left" | "right";
  label: string;
}) {
  const start = useRef<{ x: number; value: number } | null>(null);
  const sign = side === "left" ? 1 : -1;

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    start.current = { x: e.clientX, value };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, [value]);

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    onChange(start.current.value + sign * (e.clientX - start.current.x));
  }, [onChange, sign]);

  const end = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      tabIndex={0}
      className="pane-resizer"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === "ArrowLeft") { e.preventDefault(); onChange(value - sign * step); }
        if (e.key === "ArrowRight") { e.preventDefault(); onChange(value + sign * step); }
        if (e.key === "Home" || e.key === "Enter") { e.preventDefault(); onReset(); }
      }}
      title="Drag to resize · double-click to reset"
    >
      <span className="pane-resizer-grip" aria-hidden="true" />
    </div>
  );
}
