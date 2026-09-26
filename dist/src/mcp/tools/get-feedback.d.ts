import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
export declare function getFeedbackHandler(input: {
    session_id: string;
    cwd?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    isError?: undefined;
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function registerGetFeedback(server: McpServer): void;
