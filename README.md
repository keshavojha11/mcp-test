# mcp-test

Test your MCP servers locally — no agent required.

```ts
import { createTestClient } from "@keshavojha11/mcp-test";

const client = await createTestClient({ serverScript: "./dist/server.js" });

const tools = await client.listTools();
console.log(tools.map(t => t.name)); // ["read_file", "write_file", ...]

const result = await client.callTool("read_file", { path: "README.md" });
client.assertNoErrors(result);
console.log(result.content[0].text);

await client.close();
```

## Why

Every MCP server needs tests. Before this, your only option was manual: run the server, attach Claude, click around. `mcp-test` gives you a real test client you can drive from Vitest, Jest, or any Node.js test runner — no agent, no API key, no cloud.

## Install

```bash
npm install --save-dev @keshavojha11/mcp-test
```

Requires Node.js 18+ and a peer of `@modelcontextprotocol/sdk ^1.0.0`.

## Usage

### `createTestClient(opts)` → `TestClient`

Spawns your server script as a subprocess and completes the MCP handshake. Throws if the script doesn't exist, exits early, or doesn't respond within `initTimeout`.

```ts
const client = await createTestClient({
  serverScript: "./dist/server.js",   // required — path to your compiled server
  env: { DB_URL: "sqlite://test.db" }, // extra env vars for the subprocess
  initTimeout: 10_000,                 // ms to wait for initialize() — default 10s
  toolTimeout: 30_000,                 // ms to wait for each tool call — default 30s
  closeTimeout: 5_000,                 // ms before SIGKILL on close() — default 5s
  nodeArgs: ["--experimental-vm-modules"], // extra Node.js flags
});
```

### `client.listTools()` → `ToolDefinition[]`

Returns the tool list the server advertised during `tools/list`. Cached from `connect()` — no extra round-trip.

### `client.callTool(name, args?)` → `ToolResult`

Calls a tool and returns its raw result. Throws `ToolNotFoundError` if the name isn't in the tool list.

```ts
const result = await client.callTool("add", { a: 1, b: 2 });
// result.content[0].text === "3"
```

### `client.assertNoErrors(result)` → `void`

Throws if `result.isError` is true. Use this after `callTool()` to assert the happy path.

### `client.assertSchema()` → `Promise<void>`

Checks that every tool in `listTools()` has a `name` and an `inputSchema` with `type: "object"`. Throws `SchemaValidationError` listing all violations.

### `client.assertToolExists(name)` → `Promise<void>`

Throws `ToolNotFoundError` if the named tool isn't in the list.

### `client.close()` → `Promise<void>`

Sends stdin EOF and waits for the subprocess to exit. SIGKILL after `closeTimeout`. Safe to call multiple times.

## Example test

```ts
// server.test.ts
import { describe, it, afterAll } from "vitest";
import { createTestClient } from "@keshavojha11/mcp-test";
import type { TestClient } from "@keshavojha11/mcp-test";

let client: TestClient;

describe("my MCP server", () => {
  beforeAll(async () => {
    client = await createTestClient({ serverScript: "./dist/server.js" });
    await client.assertSchema();
  });

  afterAll(() => client.close());

  it("exposes a read_file tool", async () => {
    await client.assertToolExists("read_file");
  });

  it("read_file returns file contents", async () => {
    const result = await client.callTool("read_file", { path: "README.md" });
    client.assertNoErrors(result);
    expect(result.content[0].text).toContain("mcp-test");
  });
});
```

## Error types

All errors extend `McpTestError` so you can catch them specifically:

| Class | When |
|---|---|
| `ServerScriptNotFoundError` | Script path doesn't exist |
| `ServerStartupError` | Server exits within 500ms of spawn |
| `ProtocolVersionError` | Server speaks an unsupported MCP version |
| `ClientNotReadyError` | Method called before `connect()` or after `close()` |
| `ToolNotFoundError` | `callTool` / `assertToolExists` names an unknown tool |
| `ToolExecutionError` | Server returns a JSON-RPC error (not `isError: true`) |
| `ToolTimeoutError` | Tool call exceeds `toolTimeout` |
| `ServerCrashedError` | Subprocess exits unexpectedly mid-session |
| `SchemaValidationError` | `assertSchema()` finds violations |
| `CloseTimeoutError` | Server didn't exit within `closeTimeout` (SIGKILL sent) |

## Debugging

Set `DEBUG=mcp-test` to log all JSON-RPC messages to stderr:

```bash
DEBUG=mcp-test vitest run
```

## License

MIT
