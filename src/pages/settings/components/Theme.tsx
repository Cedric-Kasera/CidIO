import { useApp, useTheme } from "@/contexts";
import { Header, Label, Slider, Button } from "@/components";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import type { SystemColor } from "@/contexts";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components";

const colorOptions: {
  value: SystemColor;
  label: string;
  description: string;
  swatch: string;
}[] = [
  {
    value: "default",
    label: "Default",
    description: "Original app palette",
    swatch: "linear-gradient(135deg, #171717 0%, #737373 100%)",
  },
  {
    value: "red",
    label: "Red",
    description: "Neon rose glow",
    swatch: "linear-gradient(135deg, #ff5c7a 0%, #ff8a70 100%)",
  },
  {
    value: "yellow",
    label: "Yellow",
    description: "Electric citrus",
    swatch: "linear-gradient(135deg, #f5ff66 0%, #ffd84a 100%)",
  },
  {
    value: "lime",
    label: "Lime Green",
    description: "Hyper lime pop",
    swatch: "linear-gradient(135deg, #bfff57 0%, #7dff77 100%)",
  },
  {
    value: "orange",
    label: "Orange",
    description: "Neon amber heat",
    swatch: "linear-gradient(135deg, #ff7a1a 0%, #ffb347 100%)",
  },
  {
    value: "indigo",
    label: "Purple / Indigo",
    description: "Electric violet blue",
    swatch: "linear-gradient(135deg, #8262ff 0%, #58a6ff 100%)",
  },
];

export const Theme = () => {
  const {
    theme,
    systemColor,
    transparency,
    setTheme,
    setSystemColor,
    onSetTransparency,
  } = useTheme();
  const { hasActiveLicense } = useApp();

  return (
    <div id="theme" className="relative space-y-3">
      <Header
        title={`Theme Customization ${
          hasActiveLicense
            ? ""
            : " (You need an active license to use this feature)"
        }`}
        description="Personalize your experience with custom theme and transparency settings"
        isMainTitle
      />

      {/* Theme Toggle */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div>
              <Label className="text-sm font-medium flex items-center gap-2">
                {theme === "system" ? (
                  <>
                    <MonitorIcon className="h-4 w-4" />
                    System
                  </>
                ) : theme === "light" ? (
                  <>
                    <SunIcon className="h-4 w-4" />
                    Light Mode
                  </>
                ) : (
                  <>
                    <MoonIcon className="h-4 w-4" />
                    Dark Mode
                  </>
                )}
              </Label>
              <p className="text-xs text-muted-foreground mt-1">
                {theme === "light"
                  ? "Using light theme for better visibility in bright environments"
                  : "Using dark theme for comfortable viewing in low light"}
              </p>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                {theme === "system" ? (
                  <MonitorIcon className="h-[1.2rem] w-[1.2rem]" />
                ) : (
                  <>
                    <SunIcon className="h-[1.2rem] w-[1.2rem] scale-100 rotate-0 transition-all dark:scale-0 dark:-rotate-90" />
                    <MoonIcon className="absolute h-[1.2rem] w-[1.2rem] scale-0 rotate-90 transition-all dark:scale-100 dark:rotate-0" />
                  </>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setTheme("light")}>
                Light
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("dark")}>
                Dark
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setTheme("system")}>
                System
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {/* System Color */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <Header
          title="System Color"
          description="Choose the accent palette for buttons, your messages, and the background tint"
        />
        <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-3">
          {colorOptions.map((option) => {
            const isSelected = systemColor === option.value;

            return (
              <Button
                key={option.value}
                type="button"
                variant={isSelected ? "default" : "outline"}
                aria-pressed={isSelected}
                onClick={() => setSystemColor(option.value)}
                className="h-auto min-h-16 justify-start gap-3 px-3 py-3"
              >
                <span
                  className="size-5 shrink-0 rounded-full border border-black/10 shadow-sm"
                  style={{ background: option.swatch }}
                />
                <span className="min-w-0 text-left">
                  <span className="block truncate text-xs font-semibold">
                    {option.label}
                  </span>
                  <span
                    className={`block text-[10px] leading-4 ${
                      isSelected
                        ? "text-primary-foreground/80"
                        : "text-muted-foreground"
                    }`}
                  >
                    {option.description}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      {/* Transparency Slider */}
      <div
        className={`space-y-2 ${
          hasActiveLicense ? "" : "opacity-60 pointer-events-none"
        }`}
      >
        <Header
          title="Window Transparency"
          description="Adjust the transparency level of the application window"
        />
        <div className="space-y-3">
          <div className="flex items-center gap-4 mt-4">
            <Slider
              value={[transparency]}
              onValueChange={(value: number[]) => onSetTransparency(value[0])}
              min={0}
              max={100}
              step={1}
              className="flex-1"
            />
          </div>

          <p className="text-xs text-muted-foreground/70">
            💡 Tip: Higher transparency lets you see through the window, perfect
            for dark overlay. Changes apply immediately.
          </p>
        </div>
      </div>
    </div>
  );
};
