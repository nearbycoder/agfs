import type { AgentToolId } from "./agent-tool-catalog";
import {
  boundedAgentText,
  chunkContext,
  promptVariables,
} from "./agent-context";
import {
  arrayToJsonl,
  jsonlToArray,
  jsonShape,
  mergePatch,
  redactJson,
  selectJsonRecords,
} from "./agent-json";
import {
  compareLineSets,
  csvMarkdown,
  joinCsv,
  projectCsv,
  testPathScope,
} from "./agent-data";
import { parseExactJson, stringifyExactJson } from "./lossless-json";
import { verifyAgentWebhook } from "./agent-signature";
export type AgentOutput = { output: string; filename: string; summary: string };
export async function runAgentTool(
  id: AgentToolId,
  input: string,
  secondary: string,
  options: Record<string, string>,
): Promise<AgentOutput> {
  boundedAgentText(input);
  boundedAgentText(secondary);
  let output: string,
    filename = id + ".json";
  const lines = (s: string) =>
    s.split(/\r\n|\n|\r/).filter((v) => v.length > 0);
  switch (id) {
    case "context-chunker":
      output = JSON.stringify(
        chunkContext(input, Number(options.size), Number(options.overlap)),
        null,
        2,
      );
      break;
    case "prompt-variables":
      output = promptVariables(input, secondary);
      filename = "rendered-prompt.txt";
      break;
    case "json-merge-patch":
      output = stringifyExactJson(
        mergePatch(parseExactJson(input), parseExactJson(secondary)),
      );
      break;
    case "json-redactor":
      output = redactJson(input, lines(secondary));
      break;
    case "json-shape":
      output = JSON.stringify(jsonShape(input), null, 2);
      break;
    case "json-records":
      output = stringifyExactJson(
        selectJsonRecords(
          input,
          options.pointer,
          options.expected,
          options.mode,
        ),
      );
      break;
    case "array-jsonl":
      output = arrayToJsonl(input);
      filename = "records.jsonl";
      break;
    case "jsonl-array":
      output = jsonlToArray(input);
      break;
    case "csv-project":
      output = projectCsv(input, lines(secondary), options.delimiter);
      filename = "projected.csv";
      break;
    case "csv-join":
      output = joinCsv(
        input,
        secondary,
        options.key,
        options.mode,
        options.delimiter,
      );
      filename = "joined.csv";
      break;
    case "csv-markdown":
      output = csvMarkdown(input, options.delimiter);
      filename = "table.md";
      break;
    case "line-sets": {
      const result = compareLineSets(
        input,
        secondary,
        options.mode,
        options.normalize,
      );
      output = result.join("\n") + (result.length ? "\n" : "");
      filename = "items.txt";
      break;
    }
    case "path-scope":
      output = JSON.stringify(testPathScope(input, options.pattern), null, 2);
      break;
    case "webhook-verifier":
      output = JSON.stringify(
        await verifyAgentWebhook(
          input,
          options.secret,
          options.timestamp,
          options.signature,
        ),
        null,
        2,
      );
      break;
    default:
      throw new Error("Choose a supported agent tool.");
  }
  boundedAgentText(output);
  return {
    output,
    filename,
    summary: `${new TextEncoder().encode(output).length.toLocaleString()} output bytes · Ready to review`,
  };
}
