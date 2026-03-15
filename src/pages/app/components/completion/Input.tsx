import { ChevronDown, Loader2 } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
  Button,
  ScrollArea,
  Input as InputComponent,
  Markdown,
} from "@/components";
import { UseCompletionReturn } from "@/types";
import { MessageHistory } from "./MessageHistory";

const formatTimestamp = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

export const Input = ({
  isPopoverOpen,
  isLoading,
  input,
  setInput,
  handleKeyPress,
  handlePaste,
  currentConversationId,
  conversationHistory,
  startNewConversation,
  setChatPanelOpen,
  messageHistoryOpen,
  setMessageHistoryOpen,
  error,
  response,
  cancel,
  scrollAreaRef,
  inputRef,
  isHidden,
}: UseCompletionReturn & { isHidden: boolean }) => {
  const now = Date.now();
  const pendingUserMessage =
    input.trim() && (isLoading || response || error)
      ? {
          id: "pending-user",
          role: "user" as const,
          content: input,
          timestamp: now,
        }
      : null;
  const pendingAssistantMessage = response
    ? {
        id: "pending-assistant",
        role: "assistant" as const,
        content: response,
        timestamp: now + 1,
      }
    : null;
  const displayMessages = [
    ...conversationHistory,
    ...(pendingUserMessage ? [pendingUserMessage] : []),
    ...(pendingAssistantMessage ? [pendingAssistantMessage] : []),
  ];

  return (
    <div className="relative flex-1">
      <Popover
        open={isPopoverOpen}
        onOpenChange={(open) => {
          if (open) {
            setChatPanelOpen(true);
          }
        }}
      >
        <PopoverTrigger
          asChild
          className="!border-none !bg-transparent data-[state=open]:!bg-transparent data-[state=open]:!text-inherit data-[state=open]:!border-transparent"
        >
          <div className="relative select-none">
            <InputComponent
              ref={inputRef}
              placeholder="Ask me anything..."
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              onPaste={handlePaste}
              disabled={isLoading || isHidden}
              className={`${
                currentConversationId && conversationHistory.length > 0
                  ? "pr-14"
                  : "pr-2"
              }`}
            />

            {currentConversationId &&
              conversationHistory.length > 0 &&
              !isLoading && (
                <div className="absolute select-none right-1 top-1/2 -translate-y-1/2 flex items-center gap-1">
                  <MessageHistory
                    conversationHistory={conversationHistory}
                    currentConversationId={currentConversationId}
                    onStartNewConversation={startNewConversation}
                    messageHistoryOpen={messageHistoryOpen}
                    setMessageHistoryOpen={setMessageHistoryOpen}
                  />
                </div>
              )}

            {isLoading && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2 animate-pulse">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}
          </div>
        </PopoverTrigger>

        <PopoverContent
          align="end"
          side="bottom"
          className="w-screen overflow-hidden border p-0 shadow-lg"
          sideOffset={8}
        >
          <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
            <div className="flex flex-col gap-0.5">
              <h3 className="select-none text-xs font-semibold">
                Current Conversation
              </h3>
              <div className="text-[10px] text-muted-foreground/70">
                {displayMessages.length} messages
              </div>
            </div>

            <div className="flex items-center gap-2 select-none">
              <Button
                size="sm"
                variant="ghost"
                className="cursor-pointer text-xs"
                onClick={() => {
                  if (isLoading) {
                    cancel();
                  }
                  startNewConversation();
                }}
              >
                New Chat
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="cursor-pointer"
                title="Collapse conversation"
                onClick={() => setChatPanelOpen(false)}
              >
                <ChevronDown className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <ScrollArea ref={scrollAreaRef} className="h-[calc(100vh-7rem)]">
            <div className="space-y-4 p-4">
              {error && (
                <div className="rounded-2xl border border-destructive/20 bg-destructive/10 p-3 text-sm text-destructive">
                  <strong>Error:</strong> {error}
                </div>
              )}

              {displayMessages.map((message) => {
                const isUserMessage = message.role === "user";

                return (
                  <div
                    key={message.id}
                    className={`flex w-full ${
                      isUserMessage ? "justify-end" : "justify-start"
                    }`}
                  >
                    <div
                      className={`max-w-[85%] rounded-[1.35rem] px-4 py-3 text-sm shadow-sm ${
                        isUserMessage
                          ? "rounded-br-md bg-primary text-primary-foreground"
                          : "rounded-bl-md border border-border/60 bg-muted/60 text-foreground"
                      }`}
                    >
                      <div
                        className={`mb-2 flex items-center gap-2 text-[10px] ${
                          isUserMessage
                            ? "justify-end text-primary-foreground/70"
                            : "text-muted-foreground"
                        }`}
                      >
                        <span className="font-medium uppercase">
                          {isUserMessage ? "You" : "AI"}
                        </span>
                        <span>{formatTimestamp(message.timestamp)}</span>
                      </div>
                      <div className="break-words leading-6">
                        <Markdown
                          isStreaming={
                            message.id === "pending-assistant" && isLoading
                          }
                        >
                          {message.content}
                        </Markdown>
                      </div>
                    </div>
                  </div>
                );
              })}

              {isLoading && !response && (
                <div className="flex w-full justify-start">
                  <div className="max-w-[85%] rounded-[1.35rem] rounded-bl-md border border-border/60 bg-muted/60 px-4 py-3 text-sm text-foreground shadow-sm">
                    <div className="mb-2 flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="font-medium uppercase">AI</span>
                      <span>{formatTimestamp(now)}</span>
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Thinking...</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </ScrollArea>
        </PopoverContent>
      </Popover>
    </div>
  );
};
