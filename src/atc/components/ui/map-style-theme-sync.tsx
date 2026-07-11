"use client";

import { useLayoutEffect } from "react";

type MapStyleThemeSyncProps = {
  isDark: boolean;
};

/** Keeps document-level semantic tokens in sync with the active map style. */
export function MapStyleThemeSync({ isDark }: MapStyleThemeSyncProps) {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previousDark = root.classList.contains("dark");
    const previousColorScheme = root.style.colorScheme;
    const colorScheme = isDark ? "dark" : "light";

    root.classList.toggle("dark", isDark);
    root.style.colorScheme = colorScheme;

    return () => {
      // Restore only values still owned by this instance. This avoids
      // clobbering another document-level theme controller during teardown.
      if (root.classList.contains("dark") === isDark) {
        root.classList.toggle("dark", previousDark);
      }
      if (root.style.colorScheme === colorScheme) {
        if (previousColorScheme) {
          root.style.colorScheme = previousColorScheme;
        } else {
          root.style.removeProperty("color-scheme");
        }
      }
    };
  }, [isDark]);

  return null;
}
