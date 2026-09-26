#!/usr/bin/env node
// Check the Node version before loading anything that needs a newer one.
// See src/runtime/node-guard.ts.
import { assertSupportedNode } from "../src/runtime/node-guard.js";

assertSupportedNode(import.meta.url);
await import("../src/cli/main.js");
