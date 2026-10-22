import { afterEach, expect, it, vi } from "vitest";
import { lazy, Suspense } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdvancedSettings } from "../ui/advanced-settings";
import { CsvProfile } from "./CsvProfile";
import { LineDiff } from "./LineDiff";
import * as profiling from "../../lib/csv-profile";

afterEach(() => vi.restoreAllMocks());

it("does not load optional file-tool modules before the user opens their settings", () => {
  const load = vi.fn(async () => ({ default: () => <p>Optional tools</p> }));
  const Tools = lazy(load);
  const html = renderToStaticMarkup(
    <AdvancedSettings
      lazy
      title="Selection tools"
      summary="Selected file actions"
    >
      <Suspense fallback={<p>Loading tools</p>}>
        <Tools />
      </Suspense>
    </AdvancedSettings>,
  );
  expect(html).toContain("Selection tools");
  expect(load).not.toHaveBeenCalled();
  expect(html).not.toContain("Loading tools");
});

it("retains eager optional form fields by default so native validation still works", () => {
  const html = renderToStaticMarkup(
    <AdvancedSettings title="Filters" summary="Filter options">
      <input name="minimum" required type="number" min={0} />
    </AdvancedSettings>,
  );
  expect(html).toContain('name="minimum"');
  expect(html).toContain('required=""');
});

it("does zero full-column profiling while its disclosure is closed", () => {
  const profile = vi.spyOn(profiling, "profileColumn");
  const rows = Array.from({ length: 5000 }, (_, index) => [
    String(index),
    "value",
  ]);
  const html = renderToStaticMarkup(
    <CsvProfile rows={rows} headers={["Number", "Value"]} />,
  );
  expect(html).toContain("Column quality &amp; statistics");
  expect(profile).not.toHaveBeenCalled();
});

it("renders only 100 draft changes and offers accessible navigation for the remainder", () => {
  const before = Array.from({ length: 4000 }, (_, i) => `old ${i + 1}`).join(
    "\n",
  );
  const after = Array.from({ length: 4000 }, (_, i) => `new ${i + 1}`).join(
    "\n",
  );
  const html = renderToStaticMarkup(<LineDiff before={before} after={after} />);
  const diff = html.slice(html.indexOf("<pre"), html.indexOf("</pre>"));
  expect(diff.match(/<div\b/g)).toHaveLength(100);
  expect(html).toContain('aria-label="Line change pages"');
  expect(html).toContain("Next changes");
  expect(html).toContain("Page 1 of 80");
  expect(html).not.toContain("old 101");
});
