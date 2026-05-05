import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { type IssueResponse } from "../../schemas/revision.js";
export declare function recordRevisionHandler(input: {
    session_id: string;
    expected_round: number;
    responses: IssueResponse[];
    cwd?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
export declare function registerRecordRevision(server: McpServer): void;
