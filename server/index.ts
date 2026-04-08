import "dotenv/config";
import express from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";

const app = express();
app.use(express.json());

// Health check
app.get("/api/agent/health", (_req, res) => {
  res.json({ status: "ok", sdk: "claude-agent-sdk" });
});

// Agent endpoint — streams events to the frontend via SSE
app.post("/api/agent", async (req, res) => {
  const { prompt, systemPrompt } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "start", timestamp: Date.now() });

  try {
    for await (const message of query({
      prompt,
      options: {
        systemPrompt: systemPrompt || undefined,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        includePartialMessages: true,
      },
    })) {
      // Real-time text streaming
      if (message.type === "stream_event") {
        const event = message.event;
        if (
          event.type === "content_block_delta" &&
          event.delta?.type === "text_delta"
        ) {
          send({ type: "text", data: event.delta.text });
        } else if (
          event.type === "content_block_start" &&
          event.content_block?.type === "tool_use"
        ) {
          send({
            type: "tool_use",
            name: event.content_block.name,
            id: event.content_block.id,
            input: {},
          });
        }
      }

      // Tool results (file reads, command output, etc.)
      else if (message.type === "user") {
        const content = message.message?.content;
        if (Array.isArray(content)) {
          for (const block of content) {
            if (block.type === "tool_result") {
              const resultText =
                typeof block.content === "string"
                  ? block.content
                  : Array.isArray(block.content)
                    ? block.content
                        .map((c: any) =>
                          c.type === "text" ? c.text : `[${c.type}]`
                        )
                        .join("\n")
                    : JSON.stringify(block.content);
              send({
                type: "tool_result",
                tool_use_id: block.tool_use_id,
                result: (resultText || "").substring(0, 2000),
              });
            }
          }
        }
      }

      // Final result
      else if (message.type === "result") {
        send({
          type: "result",
          subtype: message.subtype,
          result: message.result,
          cost: message.total_cost_usd,
        });
      }
    }

    send({ type: "complete" });
  } catch (err: any) {
    send({ type: "error", message: err.message || "Agent SDK error" });
  }

  res.end();
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Agent SDK backend running on :${PORT}`);
  console.log(`ANTHROPIC_BASE_URL: ${process.env.ANTHROPIC_BASE_URL || "(not set)"}`);
});
