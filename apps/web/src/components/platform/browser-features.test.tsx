import { afterEach, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { browserFeatures } from "~/lib/browser-feature-catalog";
import { runRecordTool } from "~/lib/browser-record-tools";
import { runTableTool } from "~/lib/browser-table-tools";
import { runDocumentTool } from "~/lib/browser-document-tools";
import { createLatestBrowserRead } from "~/lib/latest-browser-read";
import {
  DataPreparationWorkbench,
  PreparationReview,
  preparationConfig,
  preparationContentType,
} from "./DataPreparationWorkbench";
import { saveBrowserText } from "~/lib/browser-text";
import { resultPage } from "./ResultPage";

const state = vi.hoisted(() => ({ hash: "" }));
vi.mock("@tanstack/react-router", () => ({
  useLocation: () => state,
  useNavigate: () => vi.fn(),
}));
afterEach(() => {
  vi.unstubAllGlobals();
  state.hash = "";
});

it.each([
  ["sample.csv", "a,b\n1,2\n", "text/csv"],
  ["sample.json", '{"value":1}', "application/json"],
  ["sample.txt", "Text 漢\n", "text/plain"],
  ["sample.md", "# Title\n", "text/markdown"],
])(
  "saves %s with its filename, exact content and format MIME in the create-only protocol",
  async (filename, output, mime) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            uploadId: "upload-test",
            headers: { "X-AGFS-Upload-Token": "test-only" },
          }),
        ),
      )
      .mockResolvedValueOnce(
        new Response("", { headers: { etag: "test-etag" } }),
      )
      .mockResolvedValueOnce(new Response("{}"));
    expect(preparationContentType(filename)).toBe(mime);
    await saveBrowserText(
      "/" + filename,
      output,
      null,
      preparationContentType(filename),
      request,
    );
    expect(request).toHaveBeenCalledTimes(3);
    expect(JSON.parse(request.mock.calls[0][1]?.body as string)).toEqual({
      path: "/" + filename,
      size: new TextEncoder().encode(output).length,
      contentType: mime,
      ifMatch: null,
    });
    const upload = request.mock.calls[1][1]!;
    expect(upload.method).toBe("PUT");
    expect(upload.headers).toMatchObject({ "content-type": mime });
    expect((upload.body as Blob).type).toBe(mime);
    expect(await (upload.body as Blob).text()).toBe(output);
    expect(JSON.parse(request.mock.calls[2][1]?.body as string)).toEqual({
      etag: "test-etag",
    });
  },
);

it("exposes exactly 17 distinct additions with working, request-free examples", () => {
  expect(browserFeatures.map((f) => f.number)).toEqual(
    Array.from({ length: 17 }, (_, i) => i + 71),
  );
  expect(new Set(browserFeatures.map((f) => f.id)).size).toBe(17);
  const fetch = vi.fn(() => {
    throw new Error("Unexpected network request");
  });
  vi.stubGlobal("fetch", fetch);
  for (const feature of browserFeatures) {
    const spec = preparationConfig[feature.id],
      options = Object.fromEntries(spec.options.map((o) => [o.key, o.value]));
    const run =
      feature.group === "record-preparation"
        ? runRecordTool
        : feature.group === "table-preparation"
          ? runTableTool
          : runDocumentTool;
    const result = run(feature.id, spec.example, spec.extra ?? "", options);
    expect(result.filename, feature.id).toBeTruthy();
    expect(result.output.length, feature.id).toBeGreaterThan(0);
    expect(new TextEncoder().encode(result.output).length).toBeLessThanOrEqual(
      262144,
    );
  }
  expect(fetch).not.toHaveBeenCalled();
});
it("renders task deep links with labelled inputs, explicit preview, local examples and empty state", () => {
  for (const feature of browserFeatures) {
    state.hash = feature.id;
    const html = renderToStaticMarkup(
      <DataPreparationWorkbench group={feature.group} />,
    );
    expect(html).toContain(feature.label);
    expect(html).toContain("Preview " + feature.label.toLowerCase());
    expect(html).toContain("Replace inputs with example");
    expect(html).toContain("Results appear here for review before export.");
    expect(html).toMatch(/maxlength="262144"/i);
    expect(html).toContain("Preparation options");
  }
});
it("pages findings to 100 rows and keeps arbitrary link targets inert and escaped", () => {
  const rows = Array.from({ length: 1000 }, (_, i) => [
    String(i),
    '<script>alert("x")</script>',
    "javascript:alert(1)",
    "x".repeat(400),
  ]);
  const result = {
    output: "[]",
    filename: "links.json",
    summary: "Inventory",
    columns: ["Line", "Label", "Target", "Details"],
    rows,
  };
  const html = renderToStaticMarkup(<PreparationReview result={result} />);
  expect(html.match(/<tr\b/g)).toHaveLength(101);
  expect(html).toContain("Page 1 of 10");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("href=");
  expect(html).not.toContain("x".repeat(301));
  expect(
    Array.from({ length: 10 }, (_, i) => resultPage(rows, i).rows).flat(),
  ).toEqual(rows);
  expect(
    renderToStaticMarkup(
      <PreparationReview result={{ ...result, rows: [] }} />,
    ),
  ).toContain("No matching findings");
});
it("suppresses cancelled and superseded source/output completions through the shared read lane", async () => {
  const lane = createLatestBrowserRead(),
    success = vi.fn(),
    error = vi.fn(),
    settled = vi.fn();
  let resolveOld!: (value: string) => void;
  const old = lane.run(
    () =>
      new Promise<string>((resolve) => {
        resolveOld = resolve;
      }),
    { success, error, settled },
  );
  await lane.run(async () => "current", { success, error, settled });
  resolveOld("stale");
  await old;
  expect(success.mock.calls).toEqual([["current"]]);
  expect(settled).toHaveBeenCalledTimes(1);
  let resolveCancelled!: (value: string) => void;
  const cancelled = lane.run(
    () =>
      new Promise<string>((resolve) => {
        resolveCancelled = resolve;
      }),
    { success, error, settled },
  );
  lane.cancel();
  resolveCancelled("cancelled");
  await cancelled;
  expect(success.mock.calls).toEqual([["current"]]);
  expect(error).not.toHaveBeenCalled();
});
