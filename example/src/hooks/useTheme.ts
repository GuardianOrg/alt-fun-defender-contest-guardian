import { useContext } from "react";

import { ThemeContext } from "../contexts/ThemeContextDef";

import type { ThemeContextType } from "../contexts/ThemeContextDef";

export const useTheme = (): ThemeContextType => {
  const context = useContext(ThemeContext);
  if (context === undefined) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
};
