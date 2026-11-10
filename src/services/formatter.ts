import { CHARACTER_LIMIT } from "../constants.js";
import type { ResponseFormat, ToolResponse } from "../types.js";
import { handleApiError } from "./api-client.js";
import { reportToolError } from "./tool-errors.js";

/**
 * Resolve a potentially nested value from a record.
 * Checks top-level first, then common Sprout nesting patterns
 * like `record.metrics[col]` and `record.dimensions[col]`.
 */
function resolveValue(record: Record<string, unknown>, col: string): unknown {
  if (col in record) return record[col];
  const metrics = record.metrics as Record<string, unknown> | undefined;
  if (metrics && col in metrics) return metrics[col];
  const dimensions = record.dimensions as Record<string, unknown> | undefined;
  if (dimensions && col in dimensions) return dimensions[col];
  // Walk dotted paths for nested fields (e.g. "from.name", "internal.tags.id")
  if (col.includes(".")) {
    const parts = col.split(".");
    let current: unknown = record;
    for (const part of parts) {
      if (current == null || typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[part];
    }
    return current;
  }
  return undefined;
}

function escapeCell(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  const str = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (!str.includes("|") && !str.includes("\n")) return str;
  return str.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

export function formatAsTable(
  data: object[],
  columns: string[]
): string {
  if (data.length === 0) return "No data found.";

  const header = `| ${columns.join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const rows = data.map(
    (row) => {
      const record = row as Record<string, unknown>;
      return `| ${columns.map((col) => escapeCell(resolveValue(record, col))).join(" | ")} |`;
    }
  );

  return [header, separator, ...rows].join("\n");
}

// Unicode format characters (category Cf): bidi marks, zero-width spaces and
// joiners, tag characters. They are invisible, and security scanners between
// this server and the agent block any result that contains them.
const FORMAT_CHARS = /\p{Cf}/gu;

export function stripFormatChars(text: string): string {
  return text.replace(FORMAT_CHARS, "");
}

function stripResponse(response: ToolResponse): ToolResponse {
  return {
    ...response,
    content: response.content.map((item) => ({ ...item, text: stripFormatChars(item.text) })),
  };
}

/**
 * Wrap a tool handler to catch errors and return them as MCP error responses
 * instead of crashing the server.
 */
export async function safeToolCall(
  fn: () => Promise<ToolResponse>
): Promise<ToolResponse> {
  try {
    return stripResponse(await fn());
  } catch (error) {
    reportToolError(error);
    return stripResponse({
      isError: true,
      content: [{ type: "text" as const, text: handleApiError(error) }],
    });
  }
}

export function formatAsList(items: string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

export interface PaginationInfo {
  current_page?: number;
  total_pages?: number;
  next_cursor?: string;
}

export function formatOutput<T>(
  data: T,
  format: ResponseFormat,
  markdownRenderer?: (data: T) => string,
  pagination?: PaginationInfo
): string {
  if (format === "json") {
    if (pagination && Object.keys(pagination).length > 0) {
      return JSON.stringify({ data, pagination }, null, 2);
    }
    return JSON.stringify(data, null, 2);
  }

  let text: string;
  if (markdownRenderer) {
    text = markdownRenderer(data);
  } else {
    text = JSON.stringify(data, null, 2);
  }

  if (pagination?.next_cursor) {
    text += `\n\nNext cursor: ${pagination.next_cursor}`;
  } else if (pagination?.current_page !== undefined && pagination?.total_pages !== undefined) {
    text += `\n\nPage ${pagination.current_page} of ${pagination.total_pages}`;
  }

  return text;
}

export function truncateIfNeeded(
  text: string,
  limit: number = CHARACTER_LIMIT
): string {
  if (text.length <= limit) return text;

  const truncationMsg =
    "\n\n---\n*Response truncated. Use pagination parameters (page/cursor) or narrower date ranges to retrieve remaining data.*";
  const sliceEnd = Math.max(0, limit - truncationMsg.length);
  return text.slice(0, sliceEnd) + truncationMsg;
}
