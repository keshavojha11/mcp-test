export { TestClient } from "./client.js";
export {
  McpTestError,
  ServerScriptNotFoundError,
  ServerStartupError,
  InitializationTimeoutError,
  ProtocolVersionError,
  ClientNotReadyError,
  ToolNotFoundError,
  InvalidArgumentsError,
  ToolExecutionError,
  ServerCrashedError,
  ToolTimeoutError,
  SchemaValidationError,
  CloseTimeoutError,
} from "./errors.js";
export type {
  TestClientOptions,
  ToolDefinition,
  ToolContent,
  ToolResult,
  ClientState,
} from "./types.js";

import { TestClient } from "./client.js";
import type { TestClientOptions } from "./types.js";

export async function createTestClient(opts: TestClientOptions): Promise<TestClient> {
  const client = new TestClient(opts);
  await client.connect();
  return client;
}
