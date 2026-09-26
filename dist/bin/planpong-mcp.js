#!/usr/bin/env node
// Check the Node version before loading the MCP SDK and the rest of the
// server. Claude Code shows this stderr line in its MCP logs when the
// server fails to start. See src/runtime/node-guard.ts.
import { assertSupportedNode } from "../src/runtime/node-guard.js";
assertSupportedNode(import.meta.url);
await import("../src/mcp/main.js");
//# sourceMappingURL=planpong-mcp.js.map