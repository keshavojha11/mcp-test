import { createInterface } from "node:readline";
import type { ChildProcess } from "node:child_process";
import {
  ToolExecutionError,
  ServerCrashedError,
  ToolTimeoutError,
  ProtocolVersionError,
} from "./errors.js";
import type { ToolDefinition, ToolResult } from "./types.js";

const debug = process.env["DEBUG"]?.includes("mcp-test")
  ? (...args: unknown[]) => process.stderr.write(`[mcp-test] ${args.join(" ")}\n`)
  : () => {};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export class MCPProtocolAdapter {
  private nextId = 1;
  private pending = new Map<number, { resolve: (r: unknown) => void; reject: (e: Error) => void }>();
  private stderr: string[] = [];
  private crashed = false;
  private crashError: Error | null = null;
  private rl: ReturnType<typeof createInterface>;

  constructor(private proc: ChildProcess) {
    this.rl = createInterface({ input: proc.stdout! });
    this.rl.on("line", (line) => this.onLine(line));
    proc.stderr!.on("data", (chunk: Buffer) => {
      const text = chunk.toString();
      debug("stderr:", text.trim());
      this.stderr.push(text);
    });
    proc.on("exit", () => this.onCrash());
    proc.on("error", (err) => this.onCrash(err));
  }

  private onLine(line: string) {
    if (!line.trim()) return;
    debug("←", line);
    let msg: JsonRpcResponse | JsonRpcNotification;
    try {
      msg = JSON.parse(line) as JsonRpcResponse | JsonRpcNotification;
    } catch {
      debug("parse error on line:", line);
      return;
    }
    if ("id" in msg && msg.id != null) {
      const handler = this.pending.get(msg.id);
      if (handler) {
        this.pending.delete(msg.id);
        if (msg.error) {
          handler.reject(new ToolExecutionError(`JSON-RPC error ${msg.error.code}: ${msg.error.message}`));
        } else {
          handler.resolve(msg.result);
        }
      }
    }
  }

  private onCrash(err?: Error) {
    this.crashed = true;
    const stderrText = this.stderr.join("").trim();
    this.crashError = new ServerCrashedError(
      err
        ? `Server process error: ${err.message}${stderrText ? `\n${stderrText}` : ""}`
        : `Server process exited unexpectedly.${stderrText ? `\n${stderrText}` : ""}`,
    );
    for (const handler of this.pending.values()) {
      handler.reject(this.crashError);
    }
    this.pending.clear();
  }

  private send(method: string, params?: unknown): Promise<unknown> {
    if (this.crashed) return Promise.reject(this.crashError ?? new ServerCrashedError("Server is not running"));
    const id = this.nextId++;
    const msg: JsonRpcRequest = { jsonrpc: "2.0", id, method, ...(params !== undefined && { params }) };
    const line = JSON.stringify(msg);
    debug("→", line);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin!.write(line + "\n");
    });
  }

  private notify(method: string, params?: unknown): void {
    if (this.crashed) return;
    const msg: JsonRpcNotification = { jsonrpc: "2.0", method, ...(params !== undefined && { params }) };
    const line = JSON.stringify(msg);
    debug("→", line);
    this.proc.stdin!.write(line + "\n");
  }

  private async withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ToolTimeoutError(`${label} timed out after ${ms}ms`)), ms);
    });
    try {
      return await Promise.race([promise, timeout]);
    } finally {
      clearTimeout(timer!);
    }
  }

  async initialize(timeoutMs: number): Promise<void> {
    const result = await this.withTimeout(
      this.send("initialize", {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "mcp-test", version: "0.1.0" },
      }),
      timeoutMs,
      "initialize()",
    ) as { protocolVersion?: string };

    debug("server protocol version:", result?.protocolVersion);

    const supported = ["2024-11-05", "2024-10-15", "2025-03-26"];
    if (result?.protocolVersion && !supported.includes(result.protocolVersion)) {
      throw new ProtocolVersionError(
        `Server speaks MCP ${result.protocolVersion}, mcp-test supports: ${supported.join(", ")}`,
      );
    }

    this.notify("notifications/initialized");
  }

  async listTools(): Promise<ToolDefinition[]> {
    const result = await this.send("tools/list") as { tools: ToolDefinition[] };
    return result.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>, timeoutMs: number): Promise<ToolResult> {
    const result = await this.withTimeout(
      this.send("tools/call", { name, arguments: args }),
      timeoutMs,
      `callTool('${name}')`,
    ) as ToolResult;
    return result;
  }

  capturedStderr(): string {
    return this.stderr.join("").trim();
  }

  hasCrashed(): boolean {
    return this.crashed;
  }
}
