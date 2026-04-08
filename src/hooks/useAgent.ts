import { useState, useCallback, useRef } from "react";

/**
 * Event types emitted by the Agent SDK backend via SSE.
 */
export interface AgentEvent {
  type:
    | "start"
    | "text"
    | "tool_use"
    | "tool_result"
    | "result"
    | "complete"
    | "error";
  data?: string;
  name?: string;
  id?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  result?: string;
  subtype?: string;
  cost?: number;
  message?: string;
  timestamp?: number;
}

export interface AgentToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  result?: string;
  status: "running" | "done" | "error";
}

export function useAgent() {
  const [isRunning, setIsRunning] = useState(false);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [text, setText] = useState("");
  const [toolCalls, setToolCalls] = useState<AgentToolCall[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const run = useCallback(
    async (prompt: string, systemPrompt?: string) => {
      setIsRunning(true);
      setEvents([]);
      setText("");
      setToolCalls([]);
      setError(null);
      setCost(null);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const res = await fetch("/api/agent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ prompt, systemPrompt }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errText = await res.text();
          throw new Error(`Agent API error: ${res.status} ${errText}`);
        }

        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ") || line === "data: [DONE]") continue;

            try {
              const event: AgentEvent = JSON.parse(line.slice(6));
              setEvents((prev) => [...prev, event]);

              switch (event.type) {
                case "text":
                  if (event.data) {
                    setText((prev) => prev + event.data);
                  }
                  break;

                case "tool_use":
                  if (event.name) {
                    setToolCalls((prev) => [
                      ...prev,
                      {
                        id: event.id || crypto.randomUUID(),
                        name: event.name!,
                        input: event.input || {},
                        status: "running",
                      },
                    ]);
                  }
                  break;

                case "tool_result":
                  if (event.tool_use_id) {
                    setToolCalls((prev) =>
                      prev.map((tc) =>
                        tc.id === event.tool_use_id
                          ? { ...tc, result: event.result, status: "done" as const }
                          : tc
                      )
                    );
                  }
                  break;

                case "result":
                  if (event.cost != null) {
                    setCost(event.cost);
                  }
                  break;

                case "error":
                  setError(event.message || "Unknown agent error");
                  break;
              }
            } catch {
              // skip malformed SSE lines
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          setError(err.message);
        }
      } finally {
        setIsRunning(false);
        abortRef.current = null;
      }
    },
    []
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  const reset = useCallback(() => {
    setEvents([]);
    setText("");
    setToolCalls([]);
    setError(null);
    setCost(null);
  }, []);

  return { run, stop, reset, isRunning, events, text, toolCalls, error, cost };
}
