import { Updater, DragButton, CustomCursor, Button } from "@/components";
import {
  SystemAudio,
  Completion,
  AudioVisualizer,
  StatusIndicator,
} from "./components";
import { useApp } from "@/hooks";
import { useApp as useAppContext } from "@/contexts";
import { EyeOffIcon, PowerIcon, SparklesIcon } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { ErrorBoundary } from "react-error-boundary";
import { ErrorLayout } from "@/layouts";
import { getPlatform } from "@/lib";
import { getCurrentWindow, Window } from "@tauri-apps/api/window";
import logo from "@/assets/logo.png";

const App = () => {
  const { isHidden, systemAudio } = useApp();
  const { customizable } = useAppContext();
  const platform = getPlatform();

  const openDashboard = async () => {
    try {
      await invoke("open_dashboard");
    } catch (error) {
      console.error("Failed to open dashboard:", error);
    }
  };

  const hideOverlay = async () => {
    try {
      const dashboardWindow = await Window.getByLabel("dashboard");

      if (dashboardWindow && (await dashboardWindow.isVisible())) {
        await dashboardWindow.hide();
      }

      await getCurrentWindow().hide();
    } catch (error) {
      console.error("Failed to hide overlay:", error);
    }
  };

  const stopApplication = async () => {
    try {
      await invoke("exit_app");
    } catch (error) {
      console.error("Failed to stop application:", error);
    }
  };

  return (
    <ErrorBoundary
      fallbackRender={() => {
        return <ErrorLayout isCompact />;
      }}
      resetKeys={["app-error"]}
      onReset={() => {
        console.log("Reset");
      }}
    >
      <div
        className={`relative w-screen h-screen overflow-hidden ${
          isHidden ? "hidden pointer-events-none" : ""
        }`}
      >
        <div className="flex h-full w-full flex-col items-center pt-1.5">
          <div className="relative z-10 mb-3 flex items-center gap-2 rounded-full border border-border/60 bg-card px-2 py-1.5 shadow-lg">
            <div className="flex items-center gap-2 rounded-full bg-background/80 px-2 py-1">
              <div className="flex size-8 items-center justify-center rounded-full bg-primary/10">
                <img
                  src={logo}
                  alt="CidIO logo"
                  className="size-5 object-contain transition-all duration-300 dark:invert"
                />
              </div>
              <span className="text-xs font-semibold tracking-[0.12em] uppercase">
                CidIO
              </span>
            </div>

            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 rounded-full px-3 text-xs"
              title="Hide overlay and dashboard"
              onClick={hideOverlay}
            >
              <EyeOffIcon className="size-3.5" />
              Hide
            </Button>

            <button
              type="button"
              title="Stop application"
              onClick={stopApplication}
              className="inline-flex h-8 items-center justify-center gap-1.5 rounded-full px-3 text-xs font-semibold uppercase tracking-[0.12em] shadow-sm transition-opacity hover:opacity-90"
              style={{
                backgroundColor: "var(--overlay-stop-bg)",
                color: "var(--overlay-stop-foreground)",
              }}
            >
              <PowerIcon className="size-3.5" />
              Stop
            </button>
          </div>

          <div
            className="flex w-full flex-row items-center gap-2 rounded-[26px] border border-border/60 px-2 py-2 shadow-lg"
            style={{
              backgroundColor: "rgb(from var(--card) r g b / 0.96)",
              backdropFilter: "blur(18px)",
            }}
          >
            <SystemAudio {...systemAudio} />
            {systemAudio?.capturing ? (
              <div className="flex flex-row items-center gap-2 justify-between w-full">
                <div className="flex flex-1 items-center gap-2">
                  <AudioVisualizer isRecording={systemAudio?.capturing} />
                </div>
                <div className="flex !w-fit items-center gap-2">
                  <StatusIndicator
                    setupRequired={systemAudio.setupRequired}
                    error={systemAudio.error}
                    isProcessing={systemAudio.isProcessing}
                    isAIProcessing={systemAudio.isAIProcessing}
                    capturing={systemAudio.capturing}
                  />
                </div>
              </div>
            ) : null}

            <div
              className={`${
                systemAudio?.capturing
                  ? "hidden w-full fade-out transition-all duration-300"
                  : "w-full flex flex-row gap-2 items-center"
              }`}
            >
              <Completion isHidden={isHidden} />
              <Button
                size={"icon"}
                className="cursor-pointer"
                title="Open Dev Space"
                onClick={openDashboard}
              >
                <SparklesIcon className="h-4 w-4" />
              </Button>
            </div>

            <Updater />
            <DragButton />
          </div>
        </div>
        {customizable.cursor.type === "invisible" && platform !== "linux" ? (
          <CustomCursor />
        ) : null}
      </div>
    </ErrorBoundary>
  );
};

export default App;
