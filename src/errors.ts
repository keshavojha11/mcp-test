export class McpTestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class ServerScriptNotFoundError extends McpTestError {}
export class ServerStartupError extends McpTestError {}
export class InitializationTimeoutError extends McpTestError {}
export class ProtocolVersionError extends McpTestError {}
export class ClientNotReadyError extends McpTestError {}
export class ToolNotFoundError extends McpTestError {}
export class InvalidArgumentsError extends McpTestError {}
export class ToolExecutionError extends McpTestError {}
export class ServerCrashedError extends McpTestError {}
export class ToolTimeoutError extends McpTestError {}
export class SchemaValidationError extends McpTestError {
  constructor(
    message: string,
    public readonly violations: string[],
  ) {
    super(message);
  }
}
export class CloseTimeoutError extends McpTestError {}
