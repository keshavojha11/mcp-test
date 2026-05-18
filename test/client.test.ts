import { describe, it, expect, afterEach } from "vitest";
import { resolve } from "node:path";
import { createTestClient } from "../src/index.js";
import { TestClient } from "../src/index.js";
import {
  ServerScriptNotFoundError,
  ToolNotFoundError,
  SchemaValidationError,
} from "../src/index.js";
import type { ToolResult } from "../src/index.js";

const ECHO_SERVER = resolve(import.meta.dirname, "fixtures/echo-server.js");

describe("createTestClient", () => {
  let client: TestClient | null = null;

  afterEach(async () => {
    if (client) {
      await client.close();
      client = null;
    }
  });

  it("connects and lists tools", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const tools = await client.listTools();
    expect(tools).toHaveLength(3);
    expect(tools.map((t) => t.name)).toEqual(["echo", "add", "fail"]);
  });

  it("throws ServerScriptNotFoundError for missing script", async () => {
    await expect(
      createTestClient({ serverScript: "/no/such/server.js" }),
    ).rejects.toBeInstanceOf(ServerScriptNotFoundError);
  });

  it("callTool — echo returns the message", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const result = await client.callTool("echo", { message: "hello world" });
    expect(result.isError).toBeFalsy();
    expect(result.content[0]).toEqual({ type: "text", text: "hello world" });
  });

  it("callTool — add returns the sum", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const result = await client.callTool("add", { a: 3, b: 4 });
    expect(result.content[0]).toEqual({ type: "text", text: "7" });
  });

  it("callTool — throws ToolNotFoundError for unknown tool", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    await expect(client.callTool("nonexistent")).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("ToolNotFoundError message lists available tools", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const err = await client.callTool("nonexistent").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ToolNotFoundError);
    expect((err as ToolNotFoundError).message).toContain("echo");
    expect((err as ToolNotFoundError).message).toContain("add");
  });

  it("assertNoErrors — passes on success result", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const result = await client.callTool("echo", { message: "ok" });
    expect(() => client!.assertNoErrors(result)).not.toThrow();
  });

  it("assertNoErrors — throws on isError result", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    const result = await client.callTool("fail");
    expect(() => client!.assertNoErrors(result)).toThrow("something went wrong");
  });

  it("assertSchema — passes for well-formed tools", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    await expect(client.assertSchema()).resolves.toBeUndefined();
  });

  it("assertToolExists — passes for existing tool", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    await expect(client.assertToolExists("echo")).resolves.toBeUndefined();
  });

  it("assertToolExists — throws ToolNotFoundError for missing tool", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    await expect(client.assertToolExists("ghost")).rejects.toBeInstanceOf(ToolNotFoundError);
  });

  it("close() is idempotent", async () => {
    client = await createTestClient({ serverScript: ECHO_SERVER });
    await client.close();
    await expect(client.close()).resolves.toBeUndefined();
    client = null;
  });
});

describe("assertSchema violations", () => {
  it("throws SchemaValidationError for a server with bad schema", async () => {
    // Use a dynamic server that returns a tool with non-object inputSchema
    const { spawn } = await import("node:child_process");
    const badServer = `
import { createInterface } from "node:readline";
const rl = createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const msg = JSON.parse(line);
  if (msg.method === "initialize") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "bad", version: "0" } } }) + "\\n");
  } else if (msg.method === "notifications/initialized") {
    // no-op
  } else if (msg.method === "tools/list") {
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { tools: [{ name: "bad-tool", inputSchema: { type: "array" } }] } }) + "\\n");
  }
});
rl.on("close", () => process.exit(0));
`;
    const { writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const tmpFile = join(tmpdir(), "bad-server-test.mjs");
    writeFileSync(tmpFile, badServer);

    const client = await createTestClient({ serverScript: tmpFile });
    try {
      await expect(client.assertSchema()).rejects.toBeInstanceOf(SchemaValidationError);
    } finally {
      await client.close();
    }
  });
});
