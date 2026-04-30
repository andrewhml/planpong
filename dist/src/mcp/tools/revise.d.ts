import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function reviseHandler(input: {
    session_id: string;
    cwd?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
export declare function registerRevise(server: McpServer): void;
