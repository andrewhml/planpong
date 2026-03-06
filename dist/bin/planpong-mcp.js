#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createPlanpongServer } from "../src/mcp/server.js";
const server = createPlanpongServer();
const transport = new StdioServerTransport();
await server.connect(transport);
//# sourceMappingURL=planpong-mcp.js.map