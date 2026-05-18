#!/usr/bin/env node
/**
 * Smoke-test any MCP server from the command line:
 *   node examples/smoke-test.js ./dist/my-server.js
 *
 * Connects, lists tools, validates schema, prints a summary.
 */
import { createTestClient, SchemaValidationError } from "../dist/index.js";
import { resolve } from "node:path";

const script = process.argv[2];
if (!script) {
  console.error("Usage: node examples/smoke-test.js <path-to-server>");
  process.exit(1);
}

const client = await createTestClient({ serverScript: resolve(script) });

console.log("Connected.");

const tools = await client.listTools();
console.log(`\nTools (${tools.length}):`);
for (const t of tools) {
  const props = Object.keys(t.inputSchema.properties ?? {}).join(", ") || "(none)";
  console.log(`  ${t.name}  [${props}]`);
  if (t.description) console.log(`    ${t.description}`);
}

try {
  await client.assertSchema();
  console.log("\nSchema: OK");
} catch (e) {
  if (e instanceof SchemaValidationError) {
    console.error("\nSchema violations:");
    for (const v of e.violations) console.error(`  • ${v}`);
  }
}

await client.close();
console.log("Done.");
