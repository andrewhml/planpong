import { z } from "zod";

export const SeverityDisputeSchema = z.object({
  original: z.enum(["P1", "P2", "P3"]),
  revised: z.enum(["P1", "P2", "P3"]),
  justification: z.string(),
});

export const IssueResponseSchema = z.object({
  issue_id: z.string(),
  action: z.enum(["accepted", "rejected", "deferred"]),
  severity_dispute: SeverityDisputeSchema.optional(),
  rationale: z.string(),
});

// `before.length <= 2000` and `after.length <= 5000` are hard caps that prevent
// the planner from "editing" the entire plan in one edit, which defeats the
// point. Section scoping makes the unique-match constraint mean "unique within
// section" rather than "unique within plan".
export const ReplaceEditSchema = z.object({
  section: z.string().min(1),
  before: z.string().min(1).max(2000),
  after: z.string().max(5000),
});

// Direction-phase revisions are intentionally allowed to be sweeping rewrites,
// so they keep the full-plan output shape.
export const DirectionRevisionSchema = z
  .object({
    responses: z.array(IssueResponseSchema),
    updated_plan: z.string(),
  })
  .strict();

// Risk + detail-phase revisions emit a structured edit list instead. The
// applier replays edits server-side. No `updated_plan` field — `.strict()`
// rejects payloads that try to provide one.
export const EditsRevisionSchema = z
  .object({
    responses: z.array(IssueResponseSchema),
    edits: z.array(ReplaceEditSchema),
  })
  .strict();

// Backward-compatible export — equals DirectionRevisionSchema.
// Kept so existing imports of `PlannerRevisionSchema` (e.g., legacy
// JSON-Schema generation) continue to compile while the codebase migrates
// to phase-aware schemas.
export const PlannerRevisionSchema = DirectionRevisionSchema;

export type SeverityDispute = z.infer<typeof SeverityDisputeSchema>;
export type IssueResponse = z.infer<typeof IssueResponseSchema>;
export type ReplaceEdit = z.infer<typeof ReplaceEditSchema>;
export type DirectionRevision = z.infer<typeof DirectionRevisionSchema>;
export type EditsRevision = z.infer<typeof EditsRevisionSchema>;
export type PlannerRevision = DirectionRevision | EditsRevision;

export function isEditsRevision(r: PlannerRevision): r is EditsRevision {
  return "edits" in r;
}

export function isDirectionRevision(r: PlannerRevision): r is DirectionRevision {
  return "updated_plan" in r;
}
