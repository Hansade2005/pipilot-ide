import "dotenv/config";
import express from "express";
import { query } from "@anthropic-ai/claude-agent-sdk";
import fs from "fs";
import path from "path";

const app = express();
app.use(express.json());

// ─── Workspace Management ───────────────────────────────────────────────────
// Each project gets its own isolated directory on the filesystem.
// The Agent SDK (Claude Code) operates inside that directory via the `cwd` option.

const WORKSPACES_ROOT = process.env.WORKSPACES_ROOT
  || path.join(process.cwd(), ".workspaces");

function getWorkspacePath(projectId: string): string {
  // Sanitize projectId to prevent path traversal
  const safe = projectId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(WORKSPACES_ROOT, safe);
}

function ensureWorkspace(projectId: string): string {
  const dir = getWorkspacePath(projectId);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Health check
app.get("/api/agent/health", (_req, res) => {
  res.json({ status: "ok", sdk: "claude-agent-sdk", workspacesRoot: WORKSPACES_ROOT });
});

// List workspace files (for debugging)
app.get("/api/agent/workspace/:projectId", (req, res) => {
  const dir = getWorkspacePath(req.params.projectId);
  if (!fs.existsSync(dir)) {
    res.json({ exists: false, files: [] });
    return;
  }
  const files = fs.readdirSync(dir, { recursive: true }) as string[];
  res.json({ exists: true, path: dir, files });
});

// Agent endpoint — streams events to the frontend via SSE
app.post("/api/agent", async (req, res) => {
  const { prompt, systemPrompt, projectId } = req.body;

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "prompt is required" });
    return;
  }

  // Determine the working directory for this agent session
  const cwd = projectId
    ? ensureWorkspace(projectId)
    : ensureWorkspace("default");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");

  const send = (payload: object) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  send({ type: "start", timestamp: Date.now(), workspace: cwd });

  try {
    for await (const message of query({
      prompt,
      options: {
        cwd,                                    // Agent works in this directory
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
  console.log(`Workspaces root: ${WORKSPACES_ROOT}`);
});
