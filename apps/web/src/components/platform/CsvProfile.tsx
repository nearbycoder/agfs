import { useMemo, useState } from "react";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "~/components/ui/table";
import { profileColumn } from "~/lib/csv-profile";
export function CsvProfile({
  rows,
  headers,
}: {
  rows: string[][];
  headers: string[];
}) {
  const [column, setColumn] = useState(0);
  const index = Math.min(column, headers.length - 1);
  const profile = useMemo(
    () => (index < 0 ? null : profileColumn(rows, index, headers.length)),
    [rows, index, headers.length],
  );
  return (
    <Disclosure>
      <DisclosureSummary>Column quality & statistics</DisclosureSummary>
      {profile ? (
        <>
          <label className="grid gap-2 text-sm">
            Profile column
            <Select
              aria-label="Profile column"
              value={index}
              onValueChange={(v) => setColumn(Number(v))}
            >
              {headers.map((h, i) => (
                <SelectItem key={i} value={i}>
                  {h}
                </SelectItem>
              ))}
            </Select>
          </label>
          <p className="text-xs text-muted-foreground">
            Profiles all loaded data rows, independent of the table filter.
            Distinct and common values exclude blank and missing cells. Numbers
            use approximate JavaScript precision.
          </p>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["Rows", profile.total],
              ["Missing cells", profile.missing],
              ["Blank cells", profile.blank],
              ["Distinct values", profile.distinct],
              ["Numeric cells", profile.numeric],
              ["Minimum", profile.min ?? "—"],
              ["Maximum", profile.max ?? "—"],
              ["Mean", profile.mean ?? "—"],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-1 break-all font-mono text-sm">{value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-sm">
            {profile.irregular} rows differ from the {headers.length}-column
            table width.
          </p>
          <Table aria-label="Most common column values">
            <TableHeader>
              <TableRow>
                <TableHead>Value</TableHead>
                <TableHead>Occurrences</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {profile.common.map(([value, count]) => (
                <TableRow key={value}>
                  <TableCell className="max-w-80 break-all whitespace-pre-wrap">
                    {value}
                  </TableCell>
                  <TableCell>{count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {!profile.common.length ? (
            <p>No nonblank values to profile.</p>
          ) : null}
        </>
      ) : (
        <p>No columns available.</p>
      )}
    </Disclosure>
  );
}
