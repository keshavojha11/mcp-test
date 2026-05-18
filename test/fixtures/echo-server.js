#!/usr/bin/env node
// Minimal MCP stdio server for testing. Implements the MCP 2025-03-26 protocol.
import { createInterface } from "node:readline";

const rl = createInterface({ input: process.stdin });

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

rl.on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try {
    msg = JSON.parse(line);
  } catch {
    return;
  }

  if (msg.method === "initialize") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "echo-server", version: "0.0.1" },
      },
    });
    return;
  }

  if (msg.method === "notifications/initialized") {
    return; // no response for notifications
  }

  if (msg.method === "tools/list") {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      result: {
        tools: [
          {
            name: "echo",
            description: "Returns the input message unchanged.",
            inputSchema: {
              type: "object",
              properties: { message: { type: "string", description: "Text to echo back." } },
              required: ["message"],
            },
          },
          {
            name: "add",
            description: "Adds two numbers.",
            inputSchema: {
              type: "object",
              properties: {
                a: { type: "number" },
                b: { type: "number" },
              },
              required: ["a", "b"],
            },
          },
          {
            name: "fail",
            description: "Always returns an error response.",
            inputSchema: {
              type: "object",
              properties: {},
            },
          },
        ],
      },
    });
    return;
  }

  if (msg.method === "tools/call") {
    const { name, arguments: args } = msg.params;

    if (name === "echo") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: args.message }],
          isError: false,
        },
      });
      return;
    }

    if (name === "add") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: String(args.a + args.b) }],
          isError: false,
        },
      });
      return;
    }

    if (name === "fail") {
      send({
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          content: [{ type: "text", text: "something went wrong" }],
          isError: true,
        },
      });
      return;
    }

    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Method not found: ${name}` },
    });
    return;
  }

  // Unknown method
  if (msg.id != null) {
    send({
      jsonrpc: "2.0",
      id: msg.id,
      error: { code: -32601, message: `Unknown method: ${msg.method}` },
    });
  }
});

// Exit cleanly on stdin close
rl.on("close", () => process.exit(0));
