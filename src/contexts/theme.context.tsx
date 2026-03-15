import { createContext, useContext, useEffect, useState } from "react";
import { STORAGE_KEYS } from "@/config/";

type Theme = "dark" | "light" | "system";
export const SYSTEM_COLORS = [
  "default",
  "red",
  "yellow",
  "lime",
  "orange",
  "indigo",
] as const;
export type SystemColor = (typeof SYSTEM_COLORS)[number];

const isSystemColor = (value: string | null): value is SystemColor =>
  SYSTEM_COLORS.includes(value as SystemColor);

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  systemColor: SystemColor;
  setSystemColor: (systemColor: SystemColor) => void;
  transparency: number;
  onSetTransparency: (transparency: number) => void;
};

const initialState: ThemeProviderState = {
  theme: "system",
  setTheme: () => null,
  systemColor: "default",
  setSystemColor: () => null,
  transparency: 10,
  onSetTransparency: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = "system",
  storageKey = STORAGE_KEYS.THEME,
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  );
  const [systemColor, setSystemColorState] = useState<SystemColor>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.SYSTEM_COLOR);
    return isSystemColor(stored) ? stored : "default";
  });
  const [transparency, setTransparency] = useState<number>(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.TRANSPARENCY);
    return stored ? parseInt(stored, 10) : 10;
  });

  const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
  const isSystemThemeDark = mediaQuery.matches;

  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === STORAGE_KEYS.TRANSPARENCY && e.newValue) {
        setTransparency(parseInt(e.newValue, 10));
      }
      if (e.key === storageKey && e.newValue) {
        setTheme(e.newValue as Theme);
      }
      if (e.key === STORAGE_KEYS.SYSTEM_COLOR) {
        setSystemColorState(isSystemColor(e.newValue) ? e.newValue : "default");
      }
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [storageKey]);

  useEffect(() => {
    const root = window.document.documentElement;

    const applyTheme = (currentTheme: Theme) => {
      root.classList.remove("light", "dark");

      if (currentTheme === "system") {
        const systemTheme = mediaQuery.matches ? "dark" : "light";
        root.classList.add(systemTheme);
      } else {
        root.classList.add(currentTheme);
      }
    };

    const updateTheme = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };

    applyTheme(theme);

    if (theme === "system") {
      mediaQuery.addEventListener("change", updateTheme);
    }

    return () => {
      if (theme === "system") {
        mediaQuery.removeEventListener("change", updateTheme);
      }
    };
  }, [theme]);

  useEffect(() => {
    const root = window.document.documentElement;

    if (systemColor === "default") {
      root.removeAttribute("data-system-color");
      return;
    }

    root.setAttribute("data-system-color", systemColor);
  }, [systemColor]);

  // Apply transparency globally
  useEffect(() => {
    const root = window.document.documentElement;
    const opacity = (100 - transparency) / 100;

    // Apply opacity to CSS variables
    root.style.setProperty("--opacity", opacity.toString());

    // Apply backdrop filter when transparency is active
    if (transparency > 0) {
      root.style.setProperty("--backdrop-blur", "blur(12px)");
    } else {
      root.style.setProperty("--backdrop-blur", "none");
    }
  }, [transparency]);

  const onSetTransparency = (transparency: number) => {
    localStorage.setItem(STORAGE_KEYS.TRANSPARENCY, transparency.toString());
    setTransparency(transparency);
  };

  const value = {
    theme,
    setTheme: (newTheme: Theme) => {
      localStorage.setItem(storageKey, newTheme);
      setTheme(newTheme);
    },
    systemColor,
    setSystemColor: (newSystemColor: SystemColor) => {
      localStorage.setItem(STORAGE_KEYS.SYSTEM_COLOR, newSystemColor);
      setSystemColorState(newSystemColor);
    },
    isSystemThemeDark,
    transparency,
    onSetTransparency,
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error("useTheme must be used within a ThemeProvider");

  return context;
};
