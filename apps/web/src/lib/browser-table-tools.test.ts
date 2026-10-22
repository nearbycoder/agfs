import { describe, expect, it } from "vitest";
import { runTableTool } from "./browser-table-tools";
import { parseCsv } from "./csv-inspector";
const run = (
  id: string,
  source: string,
  extra = "",
  options: Record<string, string> = {},
) => runTableTool("table-" + id, source, extra, { delimiter: ",", ...options });
const csv = "id,team,n\na,north,0.1\nb,south,0.2\nc,north,0.2\n";
describe("bounded table preparation", () => {
  it("#78 sorts exact decimals with stable ties and preserves quoted multiline cells", () => {
    const source =
      'id,n,text\na,9007199254740993,"line\nvalue"\nb,9007199254740992,"with,comma"\nc,9007199254740992.0,"say ""yes"""\n';
    const rows = parseCsv(
      run("sort", source, "", { column: "n", type: "number", direction: "asc" })
        .output,
    );
    expect(rows.slice(1).map((r) => r[0])).toEqual(["b", "c", "a"]);
    expect(rows[3][2]).toBe("line\nvalue");
    expect(rows[2][2]).toBe('say "yes"');
    expect(() =>
      run("sort", "n\nnope", "", {
        column: "n",
        type: "number",
        direction: "asc",
      }),
    ).toThrow("decimal");
  });
  it("#78 text sorting and semicolon delimiters retain exact cell strings", () => {
    expect(
      parseCsv(
        run("sort", "id;n\nb;2\na;10", "", {
          delimiter: ";",
          column: "id",
          type: "text",
          direction: "asc",
        }).output,
        ";",
      ),
    ).toEqual([
      ["id", "n"],
      ["a", "10"],
      ["b", "2"],
    ]);
  });
  it("#79 deduplicates composite keys without concatenation collisions", () => {
    const input = "a,b,v\na,bc,1\nab,c,2\na,bc,3\n";
    expect(
      parseCsv(
        run("dedupe", input, "", { columns: "a\nb", keep: "last" }).output,
      ),
    ).toEqual([
      ["a", "b", "v"],
      ["ab", "c", "2"],
      ["a", "bc", "3"],
    ]);
    expect(
      parseCsv(
        run("dedupe", 'a,v\n"",1\n"",2', "", { columns: "a", keep: "first" })
          .output,
      ),
    ).toHaveLength(2);
    expect(() =>
      run("dedupe", csv, "", { columns: "id\nid", keep: "first" }),
    ).toThrow("distinct");
  });
  it("#80 groups with exact decimal sums rather than floating point", () => {
    expect(
      parseCsv(run("group", csv, "", { columns: "team", sum: "n" }).output),
    ).toEqual([
      ["team", "row_count", "sum:n"],
      ["north", "2", "0.3"],
      ["south", "1", "0.2"],
    ]);
    expect(
      parseCsv(
        run("group", "n\n9007199254740993\n2\n", "", { columns: "", sum: "n" })
          .output,
      )[1],
    ).toEqual(["2", "9007199254740995"]);
    expect(
      parseCsv(
        run("group", "n\n1e-3\n2e-3\n", "", { columns: "", sum: "n" }).output,
      )[1],
    ).toEqual(["2", "0.003"]);
    expect(
      parseCsv(
        run("group", "n\n-0.1\n0.1\n", "", { columns: "", sum: "n" }).output,
      )[1],
    ).toEqual(["2", "0"]);
  });
  it("#80 refuses invalid sums and exponent growth; header-only input produces no phantom group", () => {
    expect(() =>
      run("group", "n\nunknown", "", { columns: "", sum: "n" }),
    ).toThrow("decimal");
    expect(() =>
      run("group", "n\n1e1001", "", { columns: "", sum: "n" }),
    ).toThrow("exponents");
    expect(
      parseCsv(
        run("group", "team,n\n", "", { columns: "team", sum: "n" }).output,
      ),
    ).toHaveLength(1);
    expect(() =>
      run("group", "row_count,n\na,1", "", { columns: "row_count", sum: "n" }),
    ).toThrow("conflicts");
  });
  it("#81 unpivots selected measures and identity columns in requested order", () => {
    expect(
      parseCsv(
        run("unpivot", "id,jan,feb,ignored\na,1,2,x\nb,3,4,y", "", {
          columns: "id",
          measures: "feb\njan",
        }).output,
      ),
    ).toEqual([
      ["id", "field", "value"],
      ["a", "feb", "2"],
      ["a", "jan", "1"],
      ["b", "feb", "4"],
      ["b", "jan", "3"],
    ]);
    expect(() =>
      run("unpivot", "id,n\na,1", "", { columns: "id", measures: "id" }),
    ).toThrow("disjoint");
    expect(() =>
      run("unpivot", "field,n\na,1", "", { columns: "field", measures: "n" }),
    ).toThrow("cannot be named");
  });
  it("#81 refuses row expansion before generating the expanded table", () => {
    const source = "id,a,b\n" + Array(2500).fill("x,1,2").join("\n");
    expect(() =>
      run("unpivot", source, "", { columns: "id", measures: "a\nb" }),
    ).toThrow("Reshaping would exceed");
  });
  it("#82 aligns reordered headers and union schemas without conflating an empty cell", () => {
    expect(
      parseCsv(
        run("append", "id,n\na,1", "n,id\n2,b", { mode: "strict" }).output,
      ),
    ).toEqual([
      ["id", "n"],
      ["a", "1"],
      ["b", "2"],
    ]);
    expect(
      parseCsv(
        run("append", "id,n\na,1", "id,other\nb,x", { mode: "union" }).output,
      ),
    ).toEqual([
      ["id", "n", "other"],
      ["a", "1", ""],
      ["b", "", "x"],
    ]);
    expect(() =>
      run("append", "id,n\na,1", "id,other\nb,x", { mode: "strict" }),
    ).toThrow("same header names");
  });
  it("#83 maps simultaneous swaps and hostile header names without changing raw values", () => {
    expect(
      parseCsv(
        run(
          "rename",
          "__proto__,constructor\na,b",
          '{"__proto__":"constructor","constructor":"__proto__"}',
        ).output,
      ),
    ).toEqual([
      ["constructor", "__proto__"],
      ["a", "b"],
    ]);
    expect(() => run("rename", csv, '{"id":"team"}')).toThrow("duplicate");
    expect(() => run("rename", csv, '{"missing":"x"}')).toThrow("Unknown");
    expect(() => run("rename", csv, '{"id":" "}')).toThrow("nonempty");
  });
  it("#84 reconciles keys with exact before/after row arrays and record references", () => {
    const result = run(
      "reconcile",
      'id,n,text\na,1,"long\ntext"\nb,2,B\nc,3,C',
      "text,n,id\nB,2,b\nchanged,4,a\nD,5,d",
      { column: "id" },
    );
    const report = JSON.parse(result.output);
    expect(report.columns).toEqual(["id", "n", "text"]);
    expect(
      report.changes.map((r: { key: string; status: string }) => [
        r.key,
        r.status,
      ]),
    ).toEqual([
      ["a", "changed"],
      ["c", "removed"],
      ["d", "added"],
    ]);
    expect(report.changes[0]).toMatchObject({
      beforeRow: 2,
      afterRow: 3,
      before: ["a", "1", "long\ntext"],
      after: ["a", "4", "changed"],
      changedColumns: ["n", "text"],
    });
  });
  it("#84 rejects ambiguous keys/schemas and returns empty changes for identical rows", () => {
    expect(() =>
      run("reconcile", "id,n\na,1\na,2", "id,n\na,1", { column: "id" }),
    ).toThrow("unique");
    expect(() =>
      run("reconcile", 'id,n\n"",1', "id,n\na,1", { column: "id" }),
    ).toThrow("nonempty");
    expect(() =>
      run("reconcile", "id,n\na,1", "id,x\na,1", { column: "id" }),
    ).toThrow("matching header");
    expect(
      JSON.parse(run("reconcile", csv, csv, { column: "id" }).output).changes,
    ).toEqual([]);
  });
  it("protects formulas and enforces ragged rows, duplicate headers, byte and aggregate limits", () => {
    expect(
      parseCsv(
        run("sort", "id,n\na,=CMD()", "", {
          column: "id",
          type: "text",
          direction: "asc",
        }).output,
      )[1][1],
    ).toBe("'=CMD()");
    expect(() =>
      run("sort", "id,id\na,b", "", {
        column: "id",
        type: "text",
        direction: "asc",
      }),
    ).toThrow("unique");
    expect(() =>
      run("sort", "id,n\na", "", {
        column: "id",
        type: "text",
        direction: "asc",
      }),
    ).toThrow("same number");
    expect(() =>
      run("sort", "n\n" + "é".repeat(140000), "", {
        column: "n",
        type: "text",
        direction: "asc",
      }),
    ).toThrow("256 KiB");
    const left = "id\n" + Array(2500).fill("a").join("\n");
    expect(() => run("append", left, left, { mode: "strict" })).toThrow(
      "Combined table exceeds",
    );
    const wide = "id,amount\n" + "x".repeat(131100) + ",1";
    expect(() => run("append", wide, wide, { mode: "strict" })).toThrow(
      "256 KiB",
    );
  });
});
