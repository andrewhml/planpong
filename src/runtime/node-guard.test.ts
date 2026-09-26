import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  MIN_NODE_FALLBACK,
  findPlanpongPackageJson,
  meetsMinimum,
  nodeVersionError,
  parseEnginesFloor,
  resolveMinimumNode,
} from "./node-guard.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf-8"));

describe("meetsMinimum", () => {
  it("rejects versions below the floor", () => {
    expect(meetsMinimum("22.12.9", "22.13.0")).toBe(false);
    expect(meetsMinimum("20.18.1", "22.13.0")).toBe(false);
    expect(meetsMinimum("18.20.4", "22.13.0")).toBe(false);
  });

  it("accepts the floor and newer", () => {
    expect(meetsMinimum("22.13.0", "22.13.0")).toBe(true);
    expect(meetsMinimum("22.20.0", "22.13.0")).toBe(true);
    expect(meetsMinimum("24.1.0", "22.13.0")).toBe(true);
    expect(meetsMinimum("26.0.0", "22.13.0")).toBe(true);
    expect(meetsMinimum("v26.0.0", "22.13.0")).toBe(true);
  });

  it("lets an unparseable version through rather than blocking", () => {
    expect(meetsMinimum("weird-build", "22.13.0")).toBe(true);
    expect(meetsMinimum("", "22.13.0")).toBe(true);
  });
});

describe("parseEnginesFloor", () => {
  it("reads a plain >= range", () => {
    expect(parseEnginesFloor(">=22.13.0")).toBe("22.13.0");
    expect(parseEnginesFloor(">= 22.13.0")).toBe("22.13.0");
  });

  it("returns null for ranges it doesn't understand", () => {
    expect(parseEnginesFloor("^22.13.0 || >=24")).toBeNull();
    expect(parseEnginesFloor(undefined)).toBeNull();
  });
});

describe("engines floor stays in one place", () => {
  it("the fallback constant equals package.json engines.node", () => {
    expect(parseEnginesFloor(pkg.engines.node)).toBe(MIN_NODE_FALLBACK);
  });
});

describe("findPlanpongPackageJson", () => {
  it("finds package.json from bin/ (tsx dev layout)", () => {
    const url = pathToFileURL(join(repoRoot, "bin", "planpong.ts")).href;
    expect(findPlanpongPackageJson(url)?.path).toBe(join(repoRoot, "package.json"));
  });

  it("finds package.json from dist/bin/ (built layout)", () => {
    const url = pathToFileURL(join(repoRoot, "dist", "bin", "planpong.js")).href;
    expect(findPlanpongPackageJson(url)?.path).toBe(join(repoRoot, "package.json"));
  });

  it("finds package.json from dist/src/runtime/ (where the guard itself lives)", () => {
    const url = pathToFileURL(join(repoRoot, "dist", "src", "runtime", "node-guard.js")).href;
    expect(resolveMinimumNode(url)).toBe(MIN_NODE_FALLBACK);
  });

  it("returns null outside any planpong package, and the minimum falls back", () => {
    const url = pathToFileURL("/tmp/not-planpong/x.js").href;
    expect(findPlanpongPackageJson(url)).toBeNull();
    expect(resolveMinimumNode(url)).toBe(MIN_NODE_FALLBACK);
  });
});

describe("nodeVersionError", () => {
  it("names the minimum, the found version, and the node binary", () => {
    expect(nodeVersionError("22.13.0", "20.18.1", "/usr/local/bin/node")).toBe(
      "planpong requires Node >= 22.13.0; found 20.18.1 at /usr/local/bin/node. " +
        "Upgrade Node or point your MCP config at a newer node.",
    );
  });
});
