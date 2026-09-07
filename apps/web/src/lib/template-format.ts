export const starterTemplates = [
  {
    id: "starter-note",
    name: "Markdown note",
    contentType: "text/markdown",
    body: "# {{name}}\n\nCreated {{date}}\n\n## Summary\n\n## Next steps\n- [ ] Review\n",
  },
  {
    id: "starter-json",
    name: "JSON manifest",
    contentType: "application/json",
    body: '{\n  "name": "{{name}}",\n  "created": "{{date}}",\n  "artifacts": []\n}\n',
  },
  {
    id: "starter-csv",
    name: "CSV table",
    contentType: "text/csv",
    body: "name,status,notes\nexample,pending,\n",
  },
  {
    id: "starter-handoff",
    name: "Run handoff",
    contentType: "text/markdown",
    body: "# {{name}}\n\nDate: {{date}}\n\n## Inputs\n\n## Outputs\n\n## Verification\n\n## Remaining work\n",
  },
];
export function renderFileTemplate(
  body: string,
  path: string,
  contentType: string,
  date = new Date(),
) {
  const name = (path.split("/").pop() || "Untitled").replace(/\.[^.]+$/, "");
  const values: Record<string, string> = {
    name,
    date: date.toISOString().slice(0, 10),
  };
  return body.replace(/\{\{(name|date)\}\}/g, (_, key: string) =>
    contentType === "application/json"
      ? JSON.stringify(values[key]).slice(1, -1)
      : values[key],
  );
}
