import { useEffect, useRef, useState, useCallback, KeyboardEvent, useMemo } from "react";
import {
  Send,
  Square,
  Trash2,
  Bot,
  Zap,
  ChevronDown,
  Sparkles,
  Paperclip,
  ArrowDown,
  Lightbulb,
  Code,
  Layout,
  Globe,
  Palette,
  FileText,
  Search,
  MessageSquare,
  Rocket,
  Command,
  CornerDownLeft,
  Hash,
  X,
} from "lucide-react";
import { useChat, ChatMode, ToolExecutor, WorkspaceContext, CheckpointManager } from "@/hooks/useChat";
import { ChatMessageItem } from "./ChatMessage";

/* ─── Slash Commands ─────────────────────────────────────────────────── */
interface SlashCommand {
  id: string;
  label: string;
  description: string;
  icon: React.ReactNode;
  prompt: string;
}

const SLASH_COMMANDS: SlashCommand[] = [
  { id: "build", label: "/build", description: "Scaffold a new project from scratch", icon: <Rocket size={13} />, prompt: "Build me a complete, production-quality " },
  { id: "design", label: "/design", description: "Create a stunning UI design", icon: <Palette size={13} />, prompt: "Design a beautiful, modern UI for " },
  { id: "landing", label: "/landing", description: "Build a landing page", icon: <Layout size={13} />, prompt: "Build a professional, conversion-optimized landing page for " },
  { id: "fix", label: "/fix", description: "Fix a bug or issue", icon: <Code size={13} />, prompt: "Find and fix the bug in " },
  { id: "refactor", label: "/refactor", description: "Refactor and improve code", icon: <Code size={13} />, prompt: "Refactor and improve the code quality of " },
  { id: "deploy", label: "/deploy", description: "Deploy the project live", icon: <Globe size={13} />, prompt: "Deploy the current project to a live URL." },
  { id: "explain", label: "/explain", description: "Explain how code works", icon: <Lightbulb size={13} />, prompt: "Explain how " },
  { id: "search", label: "/search", description: "Search files and code", icon: <Search size={13} />, prompt: "Search the project for " },
  { id: "tree", label: "/tree", description: "Show project structure", icon: <FileText size={13} />, prompt: "Show me the complete project file tree with details." },
];

/* ─── Smart Suggestions ──────────────────────────────────────────────── */
const SUGGESTION_SETS = [
  [
    { icon: <Rocket size={13} />, text: "Build a portfolio website" },
    { icon: <Layout size={13} />, text: "Create a dashboard UI" },
    { icon: <Palette size={13} />, text: "Design a pricing page" },
    { icon: <Globe size={13} />, text: "Make an e-commerce store" },
  ],
  [
    { icon: <Code size={13} />, text: "Build a todo app" },
    { icon: <Layout size={13} />, text: "Create a blog layout" },
    { icon: <Palette size={13} />, text: "Design a login page" },
    { icon: <Globe size={13} />, text: "Build a weather app" },
  ],
  [
    { icon: <Rocket size={13} />, text: "Build a SaaS landing page" },
    { icon: <Code size={13} />, text: "Create a kanban board" },
    { icon: <Layout size={13} />, text: "Design a settings panel" },
    { icon: <Palette size={13} />, text: "Make a photo gallery" },
  ],
];

/* ─── ChatPanel Props ────────────────────────────────────────────────── */
interface ChatPanelProps {
  toolExecutor?: ToolExecutor;
  workspaceContext?: WorkspaceContext;
  checkpointManager?: CheckpointManager;
  projectId?: string;
}

export function ChatPanel({ toolExecutor, workspaceContext, checkpointManager, projectId }: ChatPanelProps) {
  const {
    messages,
    isStreaming,
    mode,
    setMode,
    sendMessage,
    stopStreaming,
    clearMessages,
    deleteMessage,
    revertToMessage,
  } = useChat(toolExecutor, workspaceContext, checkpointManager, projectId);

  const handleDeleteMessage = useCallback(
    (messageId: string) => {
      if (isStreaming) return;
      deleteMessage(messageId);
    },
    [deleteMessage, isStreaming]
  );

  const [input, setInput] = useState("");
  const handleRevertToMessage = useCallback(
    async (messageId: string) => {
      if (isStreaming) return;
      const content = await revertToMessage(messageId);
      if (content) setInput(content);
    },
    [revertToMessage, isStreaming]
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [showModeMenu, setShowModeMenu] = useState(false);
  const [showSlashMenu, setShowSlashMenu] = useState(false);
  const [slashFilter, setSlashFilter] = useState("");
  const [slashIndex, setSlashIndex] = useState(0);
  const [showScrollDown, setShowScrollDown] = useState(false);
  const [charCount, setCharCount] = useState(0);

  // Randomize suggestion set on mount
  const suggestions = useMemo(
    () => SUGGESTION_SETS[Math.floor(Math.random() * SUGGESTION_SETS.length)],
    []
  );

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!showScrollDown) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, showScrollDown]);

  // Track scroll position for "scroll to bottom" button
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const isNearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 100;
    setShowScrollDown(!isNearBottom);
  }, []);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    setShowScrollDown(false);
  }, []);

  // Slash command filtering
  const filteredSlashCommands = useMemo(() => {
    if (!slashFilter) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter(
      (cmd) =>
        cmd.id.includes(slashFilter.toLowerCase()) ||
        cmd.description.toLowerCase().includes(slashFilter.toLowerCase())
    );
  }, [slashFilter]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || isStreaming) return;
    sendMessage(trimmed);
    setInput("");
    setCharCount(0);
    setShowSlashMenu(false);
    if (textareaRef.current) textareaRef.current.style.height = "auto";
  };

  const handleSlashSelect = useCallback(
    (cmd: SlashCommand) => {
      setInput(cmd.prompt);
      setCharCount(cmd.prompt.length);
      setShowSlashMenu(false);
      textareaRef.current?.focus();
      // Auto-resize
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.style.height = "auto";
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + "px";
        }
      }, 0);
    },
    []
  );

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Slash menu navigation
    if (showSlashMenu) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSlashIndex((i) => Math.min(i + 1, filteredSlashCommands.length - 1));
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSlashIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredSlashCommands[slashIndex]) {
          handleSlashSelect(filteredSlashCommands[slashIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        setShowSlashMenu(false);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setInput(value);
    setCharCount(value.length);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";

    // Slash command detection
    if (value === "/") {
      setShowSlashMenu(true);
      setSlashFilter("");
      setSlashIndex(0);
    } else if (value.startsWith("/") && !value.includes(" ")) {
      setShowSlashMenu(true);
      setSlashFilter(value.slice(1));
      setSlashIndex(0);
    } else {
      setShowSlashMenu(false);
    }
  };

  const modeConfig: Record<ChatMode, { label: string; icon: React.ReactNode; desc: string; color: string }> = {
    chat: {
      label: "Chat",
      icon: <MessageSquare size={12} />,
      desc: "Single-turn conversation",
      color: "hsl(220 14% 65%)",
    },
    agent: {
      label: "Agent",
      icon: <Zap size={12} />,
      desc: "Multi-step autonomous coding",
      color: "hsl(207 90% 65%)",
    },
  };

  const messageCount = messages.filter((m) => m.role === "user").length;

  return (
    <div
      className="flex flex-col h-full"
      style={{ background: "hsl(220 13% 15%)" }}
      data-testid="chat-panel"
    >
      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{
          borderBottom: "1px solid hsl(220 13% 20%)",
          background: "linear-gradient(180deg, hsl(220 13% 17%) 0%, hsl(220 13% 15%) 100%)",
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 35%) 100%)",
              boxShadow: "0 2px 8px hsl(207 90% 35% / 0.4)",
            }}
          >
            <Sparkles size={14} style={{ color: "white" }} />
          </div>
          <div>
            <span className="text-sm font-semibold" style={{ color: "hsl(220 14% 92%)", letterSpacing: "-0.01em" }}>
              PiPilot AI
            </span>
            {messageCount > 0 && (
              <span
                className="ml-2 text-xs tabular-nums"
                style={{ color: "hsl(220 14% 45%)" }}
              >
                {messageCount} message{messageCount !== 1 ? "s" : ""}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {/* Mode Toggle */}
          <div className="relative">
            <button
              className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-all duration-200"
              style={{
                background: mode === "agent"
                  ? "linear-gradient(135deg, hsl(207 90% 36% / 0.25) 0%, hsl(207 90% 36% / 0.15) 100%)"
                  : "hsl(220 13% 22%)",
                color: modeConfig[mode].color,
                border: `1px solid ${mode === "agent" ? "hsl(207 90% 45% / 0.3)" : "hsl(220 13% 28%)"}`,
                boxShadow: mode === "agent" ? "0 0 12px hsl(207 90% 50% / 0.15)" : "none",
              }}
              onClick={() => setShowModeMenu((p) => !p)}
              data-testid="chat-mode-toggle"
            >
              {modeConfig[mode].icon}
              <span>{modeConfig[mode].label}</span>
              <ChevronDown size={10} style={{ opacity: 0.6 }} />
            </button>

            {showModeMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowModeMenu(false)} />
                <div
                  className="absolute right-0 top-full mt-1.5 rounded-xl border shadow-xl z-50 overflow-hidden"
                  style={{
                    background: "hsl(220 13% 17%)",
                    borderColor: "hsl(220 13% 25%)",
                    minWidth: "200px",
                    backdropFilter: "blur(16px)",
                    boxShadow: "0 8px 32px hsl(220 13% 5% / 0.6), 0 0 0 1px hsl(220 13% 25%)",
                  }}
                >
                  {(["chat", "agent"] as ChatMode[]).map((m) => (
                    <button
                      key={m}
                      className="w-full flex items-start gap-2.5 px-3.5 py-2.5 text-xs transition-all duration-150 text-left"
                      style={
                        mode === m
                          ? { color: modeConfig[m].color, background: "hsl(207 90% 40% / 0.12)" }
                          : { color: "hsl(220 14% 70%)" }
                      }
                      onMouseEnter={(e) => {
                        if (mode !== m) e.currentTarget.style.background = "hsl(220 13% 22%)";
                      }}
                      onMouseLeave={(e) => {
                        if (mode !== m) e.currentTarget.style.background = "transparent";
                      }}
                      onClick={() => {
                        setMode(m);
                        setShowModeMenu(false);
                      }}
                      data-testid={`chat-mode-option-${m}`}
                    >
                      <span className="mt-0.5 flex-shrink-0">{modeConfig[m].icon}</span>
                      <div>
                        <div className="font-semibold">{modeConfig[m].label}</div>
                        <div style={{ color: "hsl(220 14% 50%)", marginTop: 1 }}>{modeConfig[m].desc}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>

          {messages.length > 0 && (
            <button
              className="rounded-lg p-1.5 text-xs transition-all duration-200 hover:scale-105"
              style={{ color: "hsl(220 14% 50%)" }}
              onClick={clearMessages}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "hsl(0 84% 60% / 0.12)";
                e.currentTarget.style.color = "hsl(0 84% 65%)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "transparent";
                e.currentTarget.style.color = "hsl(220 14% 50%)";
              }}
              title="Clear conversation"
              data-testid="chat-clear-btn"
            >
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      {/* ── Agent mode badge ── */}
      {mode === "agent" && (
        <div
          className="flex items-center gap-2 px-4 py-2 text-xs"
          style={{
            background: "linear-gradient(90deg, hsl(207 90% 36% / 0.08) 0%, transparent 100%)",
            borderBottom: "1px solid hsl(220 13% 20%)",
            color: "hsl(207 90% 65%)",
          }}
        >
          <div
            className="w-1.5 h-1.5 rounded-full"
            style={{
              background: "hsl(142 71% 50%)",
              boxShadow: "0 0 6px hsl(142 71% 50% / 0.5)",
            }}
          />
          <span style={{ fontWeight: 500 }}>Agent mode</span>
          <span style={{ color: "hsl(220 14% 45%)" }}>— autonomous coding with file tools</span>
        </div>
      )}

      {/* ── Messages ── */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto px-3 py-3 relative"
        onScroll={handleScroll}
        data-testid="chat-messages"
      >
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-8">
            {/* Logo */}
            <div
              className="w-16 h-16 rounded-2xl flex items-center justify-center relative"
              style={{
                background: "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(220 80% 35%) 100%)",
                boxShadow: "0 8px 32px hsl(207 90% 35% / 0.35), 0 0 0 1px hsl(207 90% 50% / 0.2)",
              }}
            >
              <Sparkles size={28} style={{ color: "white" }} />
              <div
                className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{
                  background: "hsl(142 71% 45%)",
                  boxShadow: "0 2px 6px hsl(142 71% 40% / 0.4)",
                  border: "2px solid hsl(220 13% 15%)",
                }}
              >
                <Zap size={10} style={{ color: "white" }} />
              </div>
            </div>

            <div>
              <p
                className="text-base font-semibold"
                style={{ color: "hsl(220 14% 88%)", letterSpacing: "-0.02em" }}
              >
                What shall we build?
              </p>
              <p className="text-xs mt-1.5" style={{ color: "hsl(220 14% 48%)" }}>
                Type <kbd
                  className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-mono"
                  style={{
                    background: "hsl(220 13% 22%)",
                    border: "1px solid hsl(220 13% 30%)",
                    color: "hsl(207 90% 65%)",
                  }}
                >/</kbd> for commands or describe what you want
              </p>
            </div>

            {/* Suggestion cards */}
            <div className="grid grid-cols-2 gap-2 mt-2 w-full max-w-[300px]">
              {suggestions.map((s, i) => (
                <button
                  key={i}
                  className="flex items-center gap-2 text-xs rounded-xl px-3 py-2.5 text-left transition-all duration-200 group"
                  style={{
                    background: "hsl(220 13% 19%)",
                    color: "hsl(220 14% 68%)",
                    border: "1px solid hsl(220 13% 24%)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = "hsl(207 90% 45% / 0.4)";
                    e.currentTarget.style.background = "hsl(220 13% 21%)";
                    e.currentTarget.style.color = "hsl(220 14% 85%)";
                    e.currentTarget.style.transform = "translateY(-1px)";
                    e.currentTarget.style.boxShadow = "0 4px 12px hsl(220 13% 5% / 0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = "hsl(220 13% 24%)";
                    e.currentTarget.style.background = "hsl(220 13% 19%)";
                    e.currentTarget.style.color = "hsl(220 14% 68%)";
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "none";
                  }}
                  onClick={() => {
                    setInput(s.text);
                    setCharCount(s.text.length);
                    textareaRef.current?.focus();
                  }}
                >
                  <span style={{ color: "hsl(207 90% 60%)", flexShrink: 0 }}>{s.icon}</span>
                  <span className="leading-tight">{s.text}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <ChatMessageItem
            key={msg.id}
            message={msg}
            onDelete={handleDeleteMessage}
            onRevert={handleRevertToMessage}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Scroll to bottom fab ── */}
      {showScrollDown && (
        <div className="relative">
          <button
            className="absolute left-1/2 -translate-x-1/2 -top-10 z-20 rounded-full p-1.5 transition-all duration-200 hover:scale-110"
            style={{
              background: "hsl(220 13% 22%)",
              border: "1px solid hsl(220 13% 30%)",
              color: "hsl(220 14% 70%)",
              boxShadow: "0 4px 12px hsl(220 13% 5% / 0.5)",
            }}
            onClick={scrollToBottom}
          >
            <ArrowDown size={14} />
          </button>
        </div>
      )}

      {/* ── Slash command popup ── */}
      {showSlashMenu && filteredSlashCommands.length > 0 && (
        <div
          className="mx-3 mb-1 rounded-xl border overflow-hidden"
          style={{
            background: "hsl(220 13% 17%)",
            borderColor: "hsl(220 13% 25%)",
            boxShadow: "0 -8px 32px hsl(220 13% 5% / 0.5)",
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          <div className="px-3 py-1.5 text-xs font-medium" style={{ color: "hsl(220 14% 42%)", borderBottom: "1px solid hsl(220 13% 22%)" }}>
            <Hash size={10} className="inline mr-1" style={{ verticalAlign: "-1px" }} />
            Commands
          </div>
          {filteredSlashCommands.map((cmd, idx) => (
            <button
              key={cmd.id}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-all duration-100 text-left"
              style={{
                background: idx === slashIndex ? "hsl(207 90% 40% / 0.12)" : "transparent",
                color: idx === slashIndex ? "hsl(207 90% 70%)" : "hsl(220 14% 70%)",
                borderLeft: idx === slashIndex ? "2px solid hsl(207 90% 55%)" : "2px solid transparent",
              }}
              onMouseEnter={() => setSlashIndex(idx)}
              onClick={() => handleSlashSelect(cmd)}
            >
              <span style={{ color: idx === slashIndex ? "hsl(207 90% 60%)" : "hsl(220 14% 45%)" }}>
                {cmd.icon}
              </span>
              <span className="font-mono font-semibold" style={{ color: idx === slashIndex ? "hsl(207 90% 75%)" : "hsl(220 14% 60%)" }}>
                {cmd.label}
              </span>
              <span style={{ color: "hsl(220 14% 48%)" }}>{cmd.description}</span>
            </button>
          ))}
        </div>
      )}

      {/* ── Input Area ── */}
      <div
        className="px-3 py-2.5"
        style={{ borderTop: "1px solid hsl(220 13% 20%)" }}
      >
        <div
          className="rounded-xl overflow-hidden transition-all duration-300"
          style={{
            background: "hsl(220 13% 18%)",
            border: `1px solid ${isStreaming ? "hsl(207 90% 45% / 0.5)" : "hsl(220 13% 25%)"}`,
            boxShadow: isStreaming
              ? "0 0 20px hsl(207 90% 50% / 0.12), inset 0 1px 0 hsl(220 13% 22%)"
              : "0 2px 8px hsl(220 13% 5% / 0.3), inset 0 1px 0 hsl(220 13% 22%)",
          }}
        >
          <textarea
            ref={textareaRef}
            className="w-full px-3.5 pt-3 pb-1 text-sm resize-none outline-none bg-transparent leading-relaxed"
            style={{
              color: "hsl(220 14% 90%)",
              minHeight: "42px",
              maxHeight: "160px",
              caretColor: "hsl(207 90% 60%)",
            }}
            placeholder={
              mode === "agent"
                ? "Describe what to build, or type / for commands..."
                : "Ask anything..."
            }
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            rows={1}
            data-testid="chat-input"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5">
            <div className="flex items-center gap-3">
              <button
                className="rounded-lg p-1.5 transition-all duration-150"
                style={{ color: "hsl(220 14% 42%)" }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = "hsl(220 14% 70%)";
                  e.currentTarget.style.background = "hsl(220 13% 24%)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = "hsl(220 14% 42%)";
                  e.currentTarget.style.background = "transparent";
                }}
                title="Attach file context"
              >
                <Paperclip size={13} />
              </button>

              {isStreaming ? (
                <span className="flex items-center gap-1.5 text-xs" style={{ color: "hsl(207 90% 60%)" }}>
                  <span className="flex gap-0.5">
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "0ms" }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "150ms" }} />
                    <span className="w-1 h-1 rounded-full animate-bounce" style={{ background: "hsl(207 90% 60%)", animationDelay: "300ms" }} />
                  </span>
                  <span className="font-medium">Working</span>
                </span>
              ) : (
                <span className="text-xs flex items-center gap-1" style={{ color: "hsl(220 14% 38%)" }}>
                  <CornerDownLeft size={10} />
                  <span>to send</span>
                  {charCount > 0 && (
                    <span className="ml-1 tabular-nums" style={{ color: charCount > 4000 ? "hsl(38 92% 55%)" : "hsl(220 14% 35%)" }}>
                      {charCount.toLocaleString()}
                    </span>
                  )}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1.5">
              {isStreaming ? (
                <button
                  className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 font-medium transition-all duration-200"
                  style={{
                    background: "hsl(0 84% 58% / 0.15)",
                    color: "hsl(0 84% 65%)",
                    border: "1px solid hsl(0 84% 58% / 0.2)",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "hsl(0 84% 58% / 0.25)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "hsl(0 84% 58% / 0.15)";
                  }}
                  onClick={stopStreaming}
                  data-testid="chat-stop-btn"
                >
                  <Square size={10} className="fill-current" />
                  Stop
                </button>
              ) : (
                <button
                  className="rounded-lg px-3 py-1.5 text-xs flex items-center gap-1.5 font-medium transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed"
                  style={{
                    background: input.trim()
                      ? "linear-gradient(135deg, hsl(207 90% 45%) 0%, hsl(207 90% 38%) 100%)"
                      : "hsl(220 13% 24%)",
                    color: input.trim() ? "white" : "hsl(220 14% 45%)",
                    boxShadow: input.trim()
                      ? "0 2px 8px hsl(207 90% 35% / 0.4), inset 0 1px 0 hsl(207 90% 65% / 0.15)"
                      : "none",
                    border: "none",
                  }}
                  onMouseEnter={(e) => {
                    if (input.trim()) {
                      e.currentTarget.style.transform = "translateY(-1px)";
                      e.currentTarget.style.boxShadow = "0 4px 12px hsl(207 90% 35% / 0.5), inset 0 1px 0 hsl(207 90% 65% / 0.2)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = "translateY(0)";
                    if (input.trim()) {
                      e.currentTarget.style.boxShadow = "0 2px 8px hsl(207 90% 35% / 0.4), inset 0 1px 0 hsl(207 90% 65% / 0.15)";
                    }
                  }}
                  onClick={handleSend}
                  disabled={!input.trim() || isStreaming}
                  data-testid="chat-send-btn"
                >
                  <Send size={11} />
                  Send
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
