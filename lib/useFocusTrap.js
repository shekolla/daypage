// Traps Tab/Shift+Tab inside a container while it's open. Auto-focuses
// the first focusable on mount. Restores focus to whatever was focused
// before the modal opened on cleanup.
//
// Usage:
//   const ref = useFocusTrap(open);
//   return <div ref={ref}>...</div>;

import { useEffect, useRef } from "react";

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useFocusTrap(active) {
  const ref = useRef(null);
  useEffect(() => {
    if (!active || !ref.current) return undefined;
    const root = ref.current;
    const previouslyFocused = typeof document !== "undefined" ? document.activeElement : null;
    const list0 = root.querySelectorAll(FOCUSABLE);
    if (list0.length > 0 && typeof list0[0].focus === "function") list0[0].focus();
    const onKey = (e) => {
      if (e.key !== "Tab") return;
      const list = root.querySelectorAll(FOCUSABLE);
      if (list.length === 0) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        last.focus();
        e.preventDefault();
      } else if (!e.shiftKey && document.activeElement === last) {
        first.focus();
        e.preventDefault();
      }
    };
    root.addEventListener("keydown", onKey);
    return () => {
      root.removeEventListener("keydown", onKey);
      if (previouslyFocused && typeof previouslyFocused.focus === "function") {
        previouslyFocused.focus();
      }
    };
  }, [active]);
  return ref;
}
