import { useRef } from "react";

/**
 * Guards a `load()`-style function that can be called again before its
 * previous call's promise resolves (e.g. a week-scoped fetch re-firing
 * because useDefaultToAdminWeek just changed `week` a moment after the
 * initial mount-time fetch already started) — without this, whichever
 * response happens to arrive LAST wins, even if it's for stale
 * arguments. A bigger "all weeks"/earlier request routinely finishes
 * after a smaller/later one, so the page can end up showing the wrong
 * week's data while the week selector itself already says the right one.
 *
 * Usage: `const { next, isCurrent } = useLoadToken();` then in `load()`,
 * `const token = next();` before the fetch, and guard every `.then`/
 * `.catch`/`.finally` state update with `if (!isCurrent(token)) return;`.
 */
export function useLoadToken() {
  const ref = useRef(0);
  return {
    next: () => ++ref.current,
    isCurrent: (token: number) => ref.current === token,
  };
}
