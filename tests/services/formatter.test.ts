import { describe, it, expect } from "vitest";
import {
  formatAsTable,
  formatAsList,
  formatOutput,
  truncateIfNeeded,
  safeToolCall,
  stripFormatChars,
} from "../../src/services/formatter.js";

describe("formatAsTable", () => {
  it("formats array of objects as markdown table", () => {
    const data = [
      { name: "Alice", role: "Admin" },
      { name: "Bob", role: "User" },
    ];
    const result = formatAsTable(data, ["name", "role"]);
    expect(result).toContain("| name | role |");
    expect(result).toContain("| Alice | Admin |");
    expect(result).toContain("| Bob | User |");
  });

  it("returns 'No data' for empty array", () => {
    expect(formatAsTable([], ["a"])).toBe("No data found.");
  });

  it("renders arrays and objects as JSON in cells instead of [object Object]", () => {
    const data = [
      { name: "Acme", groups: [123, 456], meta: { code: "A" } },
    ];
    const result = formatAsTable(data, ["name", "groups", "meta"]);
    expect(result).toContain("[123,456]");
    expect(result).toContain('{"code":"A"}');
    expect(result).not.toContain("[object Object]");
  });

  it("escapes pipe characters and newlines in cell values", () => {
    const data = [
      { name: "Alice | Admin", bio: "Line 1\nLine 2" },
    ];
    const result = formatAsTable(data, ["name", "bio"]);
    expect(result).toContain("Alice \\| Admin");
    expect(result).toContain("Line 1 Line 2");
    // Verify the table has exactly 3 lines (header, separator, one data row)
    expect(result.split("\n")).toHaveLength(3);
  });

  it("resolves nested metrics and dimensions from Sprout API response format", () => {
    const data = [
      {
        dimensions: { "reporting_period.by(day)": "2024-01-01", customer_profile_id: 1234 },
        metrics: { impressions: 3400, reactions: 12 },
      },
    ];
    const result = formatAsTable(data, ["impressions", "reactions"]);
    expect(result).toContain("| 3400 | 12 |");
  });

  it("resolves dotted field paths in nested objects", () => {
    const data = [
      { from: { name: "John", guid: "abc" }, text: "Hello" },
    ];
    const result = formatAsTable(data, ["from.name", "text"]);
    expect(result).toContain("| John | Hello |");
  });

  it("resolves deeply nested dotted paths", () => {
    const data = [
      { internal: { sent_by: { email: "test@example.com" } } },
    ];
    const result = formatAsTable(data, ["internal.sent_by.email"]);
    expect(result).toContain("| test@example.com |");
  });

  it("resolves top-level fields before checking nested", () => {
    const data = [
      { name: "Alice", metrics: { name: "should-not-use" } },
    ];
    const result = formatAsTable(data, ["name"]);
    expect(result).toContain("| Alice |");
  });
});

describe("formatAsList", () => {
  it("formats items as bullet list", () => {
    const result = formatAsList(["one", "two", "three"]);
    expect(result).toBe("- one\n- two\n- three");
  });
});

describe("formatOutput", () => {
  it("returns JSON string for json format", () => {
    const data = { foo: "bar" };
    const result = formatOutput(data, "json");
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  it("returns markdown string for markdown format with custom renderer", () => {
    const data = { name: "Test" };
    const result = formatOutput(data, "markdown", (d) => `Name: ${d.name}`);
    expect(result).toBe("Name: Test");
  });

  it("falls back to JSON if no markdown renderer", () => {
    const data = { name: "Test" };
    const result = formatOutput(data, "markdown");
    expect(result).toBe(JSON.stringify(data, null, 2));
  });

  it("embeds pagination in JSON structure when format is json", () => {
    const data = [{ id: 1 }];
    const result = formatOutput(data, "json", undefined, { current_page: 2, total_pages: 5 });
    const parsed = JSON.parse(result);
    expect(parsed.data).toEqual([{ id: 1 }]);
    expect(parsed.pagination).toEqual({ current_page: 2, total_pages: 5 });
  });

  it("embeds next_cursor in JSON structure when format is json", () => {
    const data = [{ id: 1 }];
    const result = formatOutput(data, "json", undefined, { next_cursor: "abc==" });
    const parsed = JSON.parse(result);
    expect(parsed.data).toEqual([{ id: 1 }]);
    expect(parsed.pagination.next_cursor).toBe("abc==");
  });

  it("appends pagination as text in markdown format", () => {
    const data = [{ id: 1 }];
    const result = formatOutput(data, "markdown", () => "| id |\n| 1 |", { current_page: 1, total_pages: 3 });
    expect(result).toContain("Page 1 of 3");
  });

  it("appends next_cursor as text in markdown format", () => {
    const data = [{ id: 1 }];
    const result = formatOutput(data, "markdown", () => "| id |\n| 1 |", { next_cursor: "xyz==" });
    expect(result).toContain("Next cursor: xyz==");
  });
});

describe("safeToolCall", () => {
  it("returns result on success", async () => {
    const result = await safeToolCall(async () => ({
      content: [{ type: "text" as const, text: "ok" }],
    }));
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe("ok");
  });

  it("catches errors and returns isError response", async () => {
    const result = await safeToolCall(async () => {
      throw new Error("network failure");
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("network failure");
  });

  it("strips invisible format characters from tool output", async () => {
    const post = "\u200EEvery year before Black Friday, Klaviyo changes how everything looks. \u200E \u200ENow, I go with the flow.";
    const result = await safeToolCall(async () => ({
      content: [{ type: "text" as const, text: formatAsTable([{ network: "LINKEDIN", text: post }], ["network", "text"]) }],
    }));
    expect(result.content[0]!.text).not.toMatch(/\p{Cf}/u);
    expect(result.content[0]!.text).toContain("| LINKEDIN | Every year before Black Friday, Klaviyo changes how everything looks.  Now, I go with the flow. |");
  });

  it("strips invisible format characters from error output", async () => {
    const result = await safeToolCall(async () => {
      throw new Error("bad\u200B value\u202E");
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("bad value");
    expect(result.content[0]!.text).not.toMatch(/\p{Cf}/u);
  });
});

describe("stripFormatChars", () => {
  it("removes bidi marks, zero-width characters, BOM, and tag characters", () => {
    const input = "a\u200Eb\u200Fc\u200Bd\u200De\u2060f\uFEFFg\u202Ah\u2066i\u{E0041}j\u00ADk";
    expect(stripFormatChars(input)).toBe("abcdefghijk");
  });

  it("keeps ordinary text, accents, and emoji variation selectors", () => {
    const input = "Café ❤️ 日本語 — ok";
    expect(stripFormatChars(input)).toBe(input);
  });

  it("splits zero-width-joiner emoji into their parts", () => {
    expect(stripFormatChars("🤷\u200D♀️")).toBe("🤷♀️");
  });
});

describe("truncateIfNeeded", () => {
  it("returns text unchanged when under limit", () => {
    expect(truncateIfNeeded("short", 100)).toBe("short");
  });

  it("truncates and appends message when over limit", () => {
    const input = "a".repeat(200);
    const result = truncateIfNeeded(input, 100);
    expect(result).toContain("truncated");
    expect(result).not.toBe(input);
    expect(result.indexOf("---")).toBeLessThan(100);
  });
});
