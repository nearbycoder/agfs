import { describe, it, expect } from "vitest";
import { searchInputSchema } from "./search-input";
describe("advanced search boundaries", () => {
  it("parses inclusive size and date bounds", () => {
    expect(
      searchInputSchema.parse({
        minSize: "0",
        maxSize: "10",
        modifiedAfter: "1",
        modifiedBefore: "2",
        kind: "file",
      }),
    ).toMatchObject({
      minSize: 0,
      maxSize: 10,
      modifiedAfter: 1,
      modifiedBefore: 2,
      kind: "file",
    });
  });
  it("rejects reversed, unsafe and invalid filters", () => {
    for (const input of [
      { minSize: 11, maxSize: 10 },
      { modifiedAfter: 2, modifiedBefore: 1 },
      { minSize: -1 },
      { maxSize: "Infinity" },
      { minSize: "9007199254740992" },
      { kind: "symlink" },
    ])
      expect(searchInputSchema.safeParse(input).success).toBe(false);
  });
});
