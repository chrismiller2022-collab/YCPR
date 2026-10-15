import { useState } from "react";

// Per-browser admin display preferences (single-user tool, same
// localStorage convention as the admin week selector). Reads and writes
// are wrapped because storage can be unavailable (private browsing);
// the defaults still render correctly without it.

export type AdminTheme = "light" | "dark";

const THEME_KEY = "admin_theme";
const SIDEBAR_KEY = "admin_sidebar_collapsed";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage disabled — the choice just won't survive a reload.
  }
}

/** Admin color theme, light unless dark was picked before. */
export function useAdminTheme(): [AdminTheme, (t: AdminTheme) => void] {
  const [theme, setThemeState] = useState<AdminTheme>(() => (read(THEME_KEY) === "dark" ? "dark" : "light"));
  function setTheme(t: AdminTheme) {
    setThemeState(t);
    write(THEME_KEY, t);
  }
  return [theme, setTheme];
}

/** Whether the admin sidebar is hidden, remembered across reloads. */
export function useSidebarCollapsed(): [boolean, (collapsed: boolean) => void] {
  const [collapsed, setCollapsedState] = useState<boolean>(() => read(SIDEBAR_KEY) === "1");
  function setCollapsed(c: boolean) {
    setCollapsedState(c);
    write(SIDEBAR_KEY, c ? "1" : "0");
  }
  return [collapsed, setCollapsed];
}
