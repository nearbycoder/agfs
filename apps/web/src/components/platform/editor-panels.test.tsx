import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { TextCleanup } from "./TextCleanup";
import { TextReplace } from "./TextReplace";
import { cleanText } from "~/lib/text-cleanup";
import { textReplacement } from "~/lib/text-replace";

vi.mock("~/lib/text-cleanup", () => ({ cleanText: vi.fn() }));
vi.mock("~/lib/text-replace", () => ({ textReplacement: vi.fn() }));

afterEach(() => vi.restoreAllMocks());

it("renders closed cleanup without transforming, encoding byte counts or rendering previews", () => {
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  const html = renderToStaticMarkup(
    <TextCleanup
      value={"private draft \t\r\n".repeat(15000)}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  expect(html).toContain("Cleanup recipes");
  expect(html).not.toContain('open=""');
  expect(html).not.toContain("private draft");
  expect(html).not.toContain("Apply cleanup");
  expect(cleanText).not.toHaveBeenCalled();
  expect(encode).not.toHaveBeenCalled();
});

it("renders closed replacement without scanning the draft or rendering contexts", () => {
  const encode = vi.spyOn(TextEncoder.prototype, "encode");
  const html = renderToStaticMarkup(
    <TextReplace
      value={"private draft \t\r\n".repeat(15000)}
      onChange={vi.fn()}
      disabled={false}
    />,
  );
  expect(html).toContain("Find &amp; replace in this draft");
  expect(html).not.toContain('open=""');
  expect(html).not.toContain("private draft");
  expect(html).not.toContain("Replace all");
  expect(textReplacement).not.toHaveBeenCalled();
  expect(encode).not.toHaveBeenCalled();
});
