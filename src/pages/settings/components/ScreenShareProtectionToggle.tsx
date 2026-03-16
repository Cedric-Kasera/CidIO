import { Header, Label, Switch } from "@/components";
import { useApp } from "@/contexts";
import { getPlatform } from "@/lib";

interface ScreenShareProtectionToggleProps {
  className?: string;
}

export const ScreenShareProtectionToggle = ({
  className,
}: ScreenShareProtectionToggleProps) => {
  const { customizable, toggleScreenShareProtection } = useApp();
  const platform = getPlatform();
  const isLinux = platform === "linux";
  const isEnabled = customizable.screenShareProtection.isEnabled;
  const checked = isLinux ? false : isEnabled;

  const handleSwitchChange = async (checked: boolean) => {
    await toggleScreenShareProtection(checked);
  };

  return (
    <div id="screen-share-protection" className={`space-y-2 ${className}`}>
      <Header
        title="Screen Share Protection"
        description="Control whether CidIO windows are allowed to appear in screen shares and recordings"
        isMainTitle
      />
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div>
            <Label className="text-sm font-medium">
              {isLinux
                ? "Unavailable on Linux"
                : isEnabled
                  ? "Hide CidIO from screen sharing"
                  : "Allow CidIO in screen sharing"}
            </Label>
            <p className="mt-1 text-xs text-muted-foreground">
              {isLinux
                ? "Linux desktop compositors do not expose reliable per-window capture protection through Tauri, so the overlay and dashboard can still appear in full-screen shares."
                : isEnabled
                  ? "The overlay, dashboard, and capture overlays stay hidden from supported screen-sharing and recording tools."
                  : "The overlay and dashboard can appear normally in meetings, recordings, and shared screens."}
            </p>
          </div>
        </div>
        <Switch
          checked={checked}
          onCheckedChange={handleSwitchChange}
          disabled={isLinux}
          aria-label="Toggle screen share protection"
        />
      </div>
    </div>
  );
};
