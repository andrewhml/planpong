const STATUS_LINE_RE = /^\*\*planpong:\*\*[^\n]*$/m;
// Collapse a CRLF-or-LF run of trailing whitespace down to "no trailing
// whitespace on each line." This makes `before` matches tolerant to the
// kind of whitespace drift that's common when planners paraphrase
// surrounding content. We deliberately do NOT normalize internal
// whitespace — that would silently mis-match meaningful indentation.
function normalizeTrailingWhitespace(s) {
    return s.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n");
}
function parseSections(plan) {
    const lines = plan.split("\n");
    const boundaries = [];
    let inFence = false;
    // First pass: locate heading lines while tracking fenced code blocks
    // (triple-backtick or triple-tilde). Lines inside fences never count as
    // headings even if they start with `#`.
    const headingLines = [];
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const fenceMatch = line.match(/^(```|~~~)/);
        if (fenceMatch) {
            inFence = !inFence;
            continue;
        }
        if (inFence)
            continue;
        const headingMatch = line.match(/^(#{1,6})\s+(.+?)\s*$/);
        if (!headingMatch)
            continue;
        headingLines.push({
            index: i,
            level: headingMatch[1].length,
            heading: headingMatch[2].trim(),
        });
    }
    // Convert heading lines to character offsets and resolve section ends:
    // section i ends where the next heading of level <= i.level begins.
    // Pre-compute line start offsets once.
    const lineStarts = [0];
    for (let i = 0; i < lines.length; i++) {
        lineStarts.push(lineStarts[i] + lines[i].length + 1); // +1 for the \n
    }
    for (let h = 0; h < headingLines.length; h++) {
        const cur = headingLines[h];
        const start = lineStarts[cur.index];
        const contentStart = lineStarts[cur.index + 1] ?? plan.length;
        let end = plan.length;
        for (let n = h + 1; n < headingLines.length; n++) {
            if (headingLines[n].level <= cur.level) {
                end = lineStarts[headingLines[n].index];
                break;
            }
        }
        boundaries.push({
            heading: cur.heading,
            level: cur.level,
            start,
            end,
            contentStart,
        });
    }
    return boundaries;
}
function findSection(boundaries, label) {
    const target = label.trim();
    const matches = boundaries.filter((b) => b.heading === target);
    if (matches.length === 0)
        return null;
    // First-match-wins for duplicate-labeled headings. The ROUND-3 reviewer
    // flagged this as silent-mis-application risk; the plan as approved keeps
    // first-match + warning. The duplicate count is surfaced so the caller can
    // emit the warning to stderr.
    return { boundary: matches[0], duplicateCount: matches.length };
}
function indexOfAllOccurrences(haystack, needle) {
    const offsets = [];
    if (needle.length === 0)
        return offsets;
    let from = 0;
    while (true) {
        const idx = haystack.indexOf(needle, from);
        if (idx === -1)
            return offsets;
        offsets.push(idx);
        from = idx + 1;
    }
}
function modifiesStatusLine(plan, range) {
    const match = STATUS_LINE_RE.exec(plan);
    if (!match)
        return false;
    const lineStart = match.index;
    const lineEnd = match.index + match[0].length;
    return range.start < lineEnd && range.end > lineStart;
}
/**
 * Apply a list of section-scoped text-replacement edits to a markdown plan.
 *
 * Edits are processed sequentially against the running plan — later edits
 * see earlier edits' results. Each edit must locate its section heading and
 * its `before` string must appear exactly once within that section's
 * content. Failures are recorded but do NOT abort the run; surviving edits
 * are applied. The caller decides whether to retry the failed edits.
 *
 * Pure: no filesystem access, no logging side-effects. The caller surfaces
 * diagnostics via stderr or telemetry.
 */
export function applyEdits(plan, edits) {
    let working = plan.replace(/\r\n/g, "\n");
    const applied = [];
    const failures = [];
    for (const edit of edits) {
        const boundaries = parseSections(working);
        const sectionLabel = edit.section.trim();
        const sectionHit = findSection(boundaries, sectionLabel);
        if (!sectionHit) {
            failures.push({
                edit,
                reason: "section-not-found",
                section_searched: sectionLabel,
            });
            continue;
        }
        const { boundary } = sectionHit;
        const sectionContent = working.slice(boundary.contentStart, boundary.end);
        const normalizedSection = normalizeTrailingWhitespace(sectionContent);
        const normalizedBefore = normalizeTrailingWhitespace(edit.before);
        const offsets = indexOfAllOccurrences(normalizedSection, normalizedBefore);
        if (offsets.length === 0) {
            // Plan-wide diagnostic: locate where the unscoped match would have
            // landed, if anywhere. This is INFORMATIONAL — never applied.
            const planWide = indexOfAllOccurrences(normalizeTrailingWhitespace(working), normalizedBefore);
            const diagnostic = planWide.length
                ? `would have matched at offset ${planWide[0]} of plan (cross-section)`
                : "no plan-wide match either";
            failures.push({
                edit,
                reason: "no-match",
                section_searched: sectionLabel,
                diagnostic,
            });
            continue;
        }
        if (offsets.length > 1) {
            failures.push({
                edit,
                reason: "multi-match",
                section_searched: sectionLabel,
                diagnostic: `${offsets.length} occurrences within section`,
            });
            continue;
        }
        // Unique match. Map normalized offset back to the un-normalized
        // working text. Because normalization only collapses TRAILING
        // whitespace per line, the byte offset within the section is invariant
        // up to the first normalized character — we can locate the match in
        // the un-normalized section by re-scanning with the same `before` and
        // selecting the matching occurrence by index. Edit count is 1, so
        // index 0 of the un-normalized matches.
        const unNormalizedOffsets = indexOfAllOccurrences(sectionContent, edit.before);
        let absoluteStart;
        let matchedLength;
        if (unNormalizedOffsets.length === 1) {
            absoluteStart = boundary.contentStart + unNormalizedOffsets[0];
            matchedLength = edit.before.length;
        }
        else {
            // Trailing-whitespace differences caused the un-normalized match to
            // shift. Fall back to the normalized offset, treat the original
            // before string as the replacement region length. This is rare —
            // typically when the planner stripped a trailing space the file
            // happens to have. Accept the small risk; the alternative is
            // rejecting the edit and the planner gets a retry anyway.
            absoluteStart = boundary.contentStart + offsets[0];
            // Find the actual matched substring in the original by re-scanning
            // tolerantly. Use the section content's character range that
            // contains the normalized hit.
            const candidate = sectionContent.slice(offsets[0], offsets[0] + edit.before.length + 32);
            const restored = candidate.match(new RegExp(edit.before
                .replace(/\r\n/g, "\n")
                .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
                .replace(/[ \t]+\n/g, "[ \\t]*\\n")));
            matchedLength = restored ? restored[0].length : edit.before.length;
        }
        const range = { start: absoluteStart, end: absoluteStart + matchedLength };
        if (modifiesStatusLine(working, range)) {
            failures.push({
                edit,
                reason: "status-line",
                section_searched: sectionLabel,
            });
            continue;
        }
        working =
            working.slice(0, range.start) + edit.after + working.slice(range.end);
        applied.push({ edit, match_offset: range.start });
    }
    return { plan: working, applied, failures };
}
/**
 * Build a stderr-friendly summary of edit application. Used by callers that
 * want a one-line log per round.
 */
export function summarizeApply(result) {
    return `applied=${result.applied.length} failed=${result.failures.length}` +
        (result.failures.length
            ? ` reasons=${result.failures.map((f) => f.reason).join(",")}`
            : "");
}
/**
 * Emit per-failure stderr diagnostics. Caller invokes this once after first-
 * pass and once after retry pass.
 */
export function logFailures(prefix, failures) {
    for (const f of failures) {
        const detail = f.diagnostic ? ` (${f.diagnostic})` : "";
        process.stderr.write(`[planpong] ${prefix}: edit failed (${f.reason}) section="${f.section_searched ?? "?"}"${detail}\n`);
    }
}
//# sourceMappingURL=apply-edits.js.map