import { expect, it, vi } from "vitest";
import {
  FEATURE_BYTES,
  exactOutput,
  jsonStringBytes,
  reportWriter,
  workBudget,
} from "./browser-feature-core";
import { runDocumentTool, taskHeading } from "./browser-document-tools";
import { runRecordTool } from "./browser-record-tools";
import { runTableTool } from "./browser-table-tools";

it("refuses maximum-sized redaction line floods early without splitting input or parsing rules", () => {
  for (const source of [
    "\n".repeat(FEATURE_BYTES),
    "\r\n".repeat(FEATURE_BYTES / 2),
  ]) {
    const split = vi.spyOn(String.prototype, "split"),
      code = vi.spyOn(String.prototype, "charCodeAt");
    let error: unknown,
      splits = 0,
      inspected = 0;
    try {
      runDocumentTool(
        "document-redact",
        source,
        "invalid rules are not reached",
        {},
      );
    } catch (cause) {
      error = cause;
    } finally {
      splits = split.mock.calls.length;
      inspected = code.mock.calls.length;
      split.mockRestore();
      code.mockRestore();
    }
    expect(String(error)).toContain("10,000 lines");
    expect(splits).toBe(0);
    // Early refusal is bounded by the line limit, not the 256 KiB input extent.
    expect(inspected).toBeLessThanOrEqual(20000);
  }
});

it("parses adversarial heading spacing and line extents with linear charged work", () => {
  for (const size of [1000, 3000, 30000, 120000]) {
    let steps = 0;
    const source = "# a" + " ".repeat(size) + "b";
    expect(
      taskHeading(source, (amount = 1) => {
        steps += amount;
      }),
    ).toBe(source.slice(2));
    expect(steps).toBeLessThanOrEqual(source.length * 2);
    expect(steps).toBeGreaterThanOrEqual(size);
    const result = runDocumentTool(
      "document-tasks",
      source + "\n- [ ] task",
      "",
      { status: "all" },
    );
    expect(JSON.parse(result.output)[0].heading).toBe(source.slice(2));
  }
  expect(taskHeading("   #### Title ###   ", workBudget())).toBe("Title");
  expect(taskHeading("# Title###", workBudget())).toBe("Title");
  expect(taskHeading("\t# Indented", workBudget())).toBeNull();
  expect(taskHeading("####### Seven", workBudget())).toBeNull();
  expect(taskHeading("#No separator", workBudget())).toBeNull();
  // Small compatibility cases only: never run the old backtracking regex on
  // adversarial extents. The production parser remains linear.
  for (const title of [
    "",
    " ",
    "  ",
    "#",
    "###",
    "Title ### ",
    "a # #",
    "a\u2028b",
    "a\u2028",
    " \u2028",
    "\u2028 ",
    "\u2029\u2028",
  ]) {
    const text = "# " + title;
    expect(taskHeading(text, workBudget()), JSON.stringify(text)).toBe(
      /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(text)?.[1] ?? null,
    );
  }
  expect(() => taskHeading("# " + "a".repeat(100), workBudget(20))).toThrow(
    "work limit",
  );
});

it("counts exact JSON-escaped UTF-8 including controls, quotes and unpaired surrogates", () => {
  const cases = [
    "",
    "plain",
    '"\\\b\t\n\f\r\u0000\u0001',
    "é漢🔑",
    "\ud800",
    "\udfff",
    "\ud800x\udfff",
    String.fromCharCode(...Array.from({ length: 65536 }, (_, i) => i)),
  ];
  for (const text of cases) {
    expect(jsonStringBytes(text)).toBe(
      new TextEncoder().encode(JSON.stringify(text)).length,
    );
  }
  for (const text of cases.slice(0, -1)) {
    const bytes = jsonStringBytes(text),
      writer = reportWriter(bytes);
    writer.json(text);
    expect(writer.bytes).toBe(bytes);
    expect(writer.finish()).toBe(JSON.stringify(text));
    const stringify = vi.spyOn(JSON, "stringify");
    try {
      expect(() => reportWriter(bytes - 1).json(text)).toThrow("256 KiB");
      expect(stringify).not.toHaveBeenCalledWith(text);
    } finally {
      stringify.mockRestore();
    }
  }
});

function rejectsBeforeLargeSerialization(run: () => unknown) {
  const original = JSON.stringify;
  let largest = 0,
    serializedBytes = 0,
    error: unknown;
  const spy = vi
    .spyOn(JSON, "stringify")
    .mockImplementation((value: unknown) => {
      const text = original(value);
      if (text) {
        largest = Math.max(largest, text.length);
        serializedBytes += new TextEncoder().encode(text).length;
      }
      return text;
    });
  try {
    run();
  } catch (cause) {
    error = cause;
  } finally {
    spy.mockRestore();
  }
  expect(String(error)).toContain("256 KiB");
  expect(largest).toBeLessThanOrEqual(FEATURE_BYTES);
  expect(serializedBytes).toBeLessThanOrEqual(FEATURE_BYTES);
  return largest;
}
it("rejects repeated large headings before allocating a full task report", () => {
  const input = "# " + "a".repeat(64000) + "\n" + "- [ ] task\n".repeat(500);
  expect(
    rejectsBeforeLargeSerialization(() =>
      runDocumentTool("document-tasks", input, "", { status: "all" }),
    ),
  ).toBe(64002);
  for (const heading of ["漢🔑".repeat(4000), '\u0001"\\'.repeat(5000)]) {
    rejectsBeforeLargeSerialization(() =>
      runDocumentTool(
        "document-tasks",
        "# " + heading + "\n" + "- [ ] task\n".repeat(500),
        "",
        { status: "all" },
      ),
    );
  }
});
it("rejects repeated audit pointers before allocating all findings", () => {
  const input = JSON.stringify(Array.from({ length: 1000 }, () => ({})));
  for (const pointer of [
    "/" + "a".repeat(4095),
    "/" + "漢🔑".repeat(700),
    "/" + '\u0001"'.repeat(1500),
  ]) {
    const rules = JSON.stringify([{ pointer, type: "string" }]);
    rejectsBeforeLargeSerialization(() =>
      runRecordTool("record-audit", input, rules, {}),
    );
  }
});
it("bounds other JSON report and exact-value strings before escaped expansion", () => {
  const links = (
    "[" +
    "\u0001".repeat(900) +
    "](https://example.com)\n"
  ).repeat(100);
  rejectsBeforeLargeSerialization(() =>
    runDocumentTool("document-links", links, "", { filter: "all" }),
  );
  const before = "id,value\na," + "\u0001".repeat(50000) + "\n";
  rejectsBeforeLargeSerialization(() =>
    runTableTool("table-reconcile", before, "id,value\na,new\n", {
      delimiter: ",",
      column: "id",
    }),
  );
  rejectsBeforeLargeSerialization(() => exactOutput("\u0001".repeat(50000)));
});
