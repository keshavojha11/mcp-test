export interface TestClientOptions {
  /** Path to the MCP server script (Node.js). */
  serverScript: string;
  /** Extra environment variables passed to the server process. Inherits process.env by default. */
  env?: Record<string, string>;
  /** Milliseconds to wait for the server to respond to initialize(). Default: 10_000. */
  initTimeout?: number;
  /** Milliseconds to wait for a tool response. Default: 30_000. */
  toolTimeout?: number;
  /** Milliseconds to wait for graceful shutdown before SIGKILL. Default: 5_000. */
  closeTimeout?: number;
  /** Node.js args prepended before serverScript (e.g. ["--experimental-vm-modules"]). */
  nodeArgs?: string[];
}

export interface ToolDefinition {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, unknown>;
    required?: string[];
  };
}

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource"; resource: { uri: string; text?: string; blob?: string } };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

export type ClientState = "uninitialized" | "connecting" | "ready" | "closing" | "closed" | "error";
