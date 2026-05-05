import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function reviseHandler(input: {
    session_id: string;
    expected_round: number;
    cwd?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function registerRevise(server: McpServer): void;
