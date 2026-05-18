import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { MCPProtocolAdapter } from "./protocol.js";
import {
  ServerScriptNotFoundError,
  ServerStartupError,
  ClientNotReadyError,
  ToolNotFoundError,
  SchemaValidationError,
  CloseTimeoutError,
} from "./errors.js";
import type { TestClientOptions, ToolDefinition, ToolResult, ClientState } from "./types.js";

export class TestClient {
  private proc: ChildProcess | null = null;
  private adapter: MCPProtocolAdapter | null = null;
  private state: ClientState = "uninitialized";
  private tools: ToolDefinition[] = [];
  private readonly opts: Required<TestClientOptions>;

  constructor(opts: TestClientOptions) {
    this.opts = {
      env: {},
      initTimeout: 10_000,
      toolTimeout: 30_000,
      closeTimeout: 5_000,
      nodeArgs: [],
      ...opts,
    };
  }

  async connect(): Promise<void> {
    if (this.state !== "uninitialized") {
      throw new ClientNotReadyError(`connect() called in state '${this.state}'`);
    }
    this.state = "connecting";

    const scriptPath = resolve(this.opts.serverScript);
    if (!existsSync(scriptPath)) {
      this.state = "error";
      throw new ServerScriptNotFoundError(
        `Server script not found: ${this.opts.serverScript}\nDid you build your project first?`,
      );
    }

    const proc = spawn(
      process.execPath,
      [...this.opts.nodeArgs, scriptPath],
      {
        env: { ...process.env, ...this.opts.env },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    this.proc = proc;

    // Give the process 500ms to fail early (wrong interpreter, missing deps, etc.)
    const startupError = await new Promise<string | null>((resolve) => {
      proc.on("error", (err) => resolve(`Failed to spawn server: ${err.message}`));
      const onExit = (code: number | null, signal: string | null) => {
        if (this.state === "connecting") {
          resolve(`Server exited during startup (code=${code}, signal=${signal})`);
        }
      };
      proc.on("exit", onExit);
      setTimeout(() => {
        proc.off("exit", onExit);
        resolve(null);
      }, 500);
    });

    if (startupError) {
      this.state = "error";
      throw new ServerStartupError(startupError);
    }

    this.adapter = new MCPProtocolAdapter(proc);

    try {
      await this.adapter.initialize(this.opts.initTimeout);
      this.tools = await this.adapter.listTools();
      this.state = "ready";
    } catch (err) {
      this.state = "error";
      proc.kill("SIGTERM");
      throw err;
    }
  }

  private assertReady() {
    if (this.state !== "ready") {
      throw new ClientNotReadyError(
        `Client is not ready (state: '${this.state}'). Did you call createTestClient()?`,
      );
    }
  }

  async listTools(): Promise<ToolDefinition[]> {
    this.assertReady();
    return this.tools;
  }

  async callTool<T extends Record<string, unknown> = Record<string, unknown>>(
    name: string,
    args: Record<string, unknown> = {},
  ): Promise<ToolResult & T> {
    this.assertReady();
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) {
      const available = this.tools.map((t) => t.name).join(", ") || "(none)";
      throw new ToolNotFoundError(
        `Tool '${name}' not found.\nAvailable tools: ${available}`,
      );
    }
    return this.adapter!.callTool(name, args, this.opts.toolTimeout) as Promise<ToolResult & T>;
  }

  async assertSchema(): Promise<void> {
    this.assertReady();
    const violations: string[] = [];

    for (const tool of this.tools) {
      if (!tool.name) {
        violations.push(`A tool is missing required field 'name'`);
        continue;
      }
      if (!tool.inputSchema) {
        violations.push(`Tool '${tool.name}': missing required field 'inputSchema'`);
        continue;
      }
      if (tool.inputSchema.type !== "object") {
        violations.push(
          `Tool '${tool.name}': inputSchema.type must be 'object', got '${String(tool.inputSchema.type)}'`,
        );
      }
    }

    if (violations.length > 0) {
      throw new SchemaValidationError(
        `Schema validation failed (${violations.length} violation${violations.length === 1 ? "" : "s"}):\n` +
          violations.map((v) => `  • ${v}`).join("\n"),
        violations,
      );
    }
  }

  async assertToolExists(name: string): Promise<void> {
    this.assertReady();
    const exists = this.tools.some((t) => t.name === name);
    if (!exists) {
      const available = this.tools.map((t) => t.name).join(", ") || "(none)";
      throw new ToolNotFoundError(
        `Expected tool '${name}' to exist.\nAvailable tools: ${available}`,
      );
    }
  }

  /**
   * Throws if the tool result has isError: true.
   * Use this after callTool() to assert the tool completed without an error response.
   */
  assertNoErrors(result: ToolResult): void {
    if (result.isError) {
      const text = result.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("\n");
      throw new Error(`Tool returned an error response:\n${text || "(no message)"}`);
    }
  }

  async close(): Promise<void> {
    if (this.state === "closed" || this.state === "uninitialized") return;
    this.state = "closing";

    if (!this.proc) {
      this.state = "closed";
      return;
    }

    // Signal the server to shut down gracefully via stdin EOF
    this.proc.stdin?.end();

    const closed = await Promise.race([
      new Promise<boolean>((resolve) => {
        this.proc!.once("exit", () => resolve(true));
        // If already dead, resolve immediately
        if (this.proc!.exitCode !== null) resolve(true);
      }),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), this.opts.closeTimeout)),
    ]);

    if (!closed) {
      this.proc.kill("SIGKILL");
      this.state = "closed";
      throw new CloseTimeoutError(
        `Server did not exit within ${this.opts.closeTimeout}ms — sent SIGKILL`,
      );
    }

    this.state = "closed";
  }
}
