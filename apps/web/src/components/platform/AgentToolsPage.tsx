import { lazy, Suspense, useEffect, useState } from "react";
import { Link, useLocation } from "@tanstack/react-router";
import {
  ArrowUpRight,
  Bot,
  Database,
  Scan,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Select, SelectItem } from "~/components/ui/select";
import { Disclosure, DisclosureSummary } from "~/components/ui/disclosure";
import { Badge } from "~/components/ui/badge";
import { agentTools } from "~/lib/agent-tool-catalog";
import { LoadingState } from "./shared";
const WorkflowTool = lazy(() =>
  import("./AgentWorkflowTool").then((m) => ({ default: m.AgentWorkflowTool })),
);
const ContextBuilder = lazy(() =>
  import("./ContextPackBuilder").then((m) => ({
    default: m.ContextPackBuilder,
  })),
);
const icons = {
  Prepare: Sparkles,
  Data: Database,
  Inspect: Scan,
  Verify: ShieldCheck,
};
export function AgentToolsPage() {
  const location = useLocation(),
    [query, setQuery] = useState(""),
    [group, setGroup] = useState("All");
  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace(/^#/, "");
    setQuery("");
    setGroup("All");
    const target = document.getElementById(id);
    if (target instanceof HTMLDetailsElement) {
      target.open = true;
      requestAnimationFrame(() => target.scrollIntoView({ block: "start" }));
    }
  }, [location.hash]);
  const matches = (tool: (typeof agentTools)[number]) =>
    (group === "All" || tool.group === group) &&
    `${tool.label} ${tool.description}`
      .toLowerCase()
      .includes(query.trim().toLowerCase());
  const count = agentTools.filter(matches).length;
  return (
    <section className="workspace-page agent-workbench">
      <header className="agent-page-heading">
        <div>
          <p className="section-label">Automation / Prepare & review</p>
          <h1 className="dashboard-title">Agent workbench</h1>
          <p className="section-copy">
            Give your agents better inputs. Inspect their outputs. Keep every
            step reviewable.
          </p>
        </div>
        <Button asChild variant="outline">
          <Link to="/app/runs">
            <Bot data-icon="inline-start" />
            Agent runs
            <ArrowUpRight data-icon="inline-end" />
          </Link>
        </Button>
      </header>
      <div className="agent-workflow-strip" role="group" aria-label="Workflow stages">
        <span>
          <b>01</b> Prepare context
        </span>
        <span>
          <b>02</b> Shape inputs
        </span>
        <span>
          <b>03</b> Inspect outputs
        </span>
        <span>
          <b>04</b> Verify delivery
        </span>
      </div>
      <div className="agent-tool-finder">
        <label className="grid gap-2 text-sm font-medium">
          Find an agent tool
          <Input
            type="search"
            value={query}
            placeholder="Context, records, redaction, signatures…"
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label className="grid gap-2 text-sm font-medium">
          Workflow stage
          <Select
            aria-label="Agent tool stage"
            value={group}
            onValueChange={setGroup}
          >
            {["All", "Prepare", "Data", "Inspect", "Verify"].map((g) => (
              <SelectItem key={g} value={g}>
                {g}
              </SelectItem>
            ))}
          </Select>
        </label>
        <p role="status" className="text-xs text-muted-foreground">
          {count} tools · Transformations run in your browser · Workspace
          permissions apply to file reads and saves
        </p>
      </div>
      <div className="agent-tool-list">
        {agentTools.map((tool) => {
          const Icon = icons[tool.group];
          return (
            <Disclosure
              key={tool.id}
              id={tool.id}
              hidden={!matches(tool)}
              lazy
              className="tool-workbench"
            >
              <DisclosureSummary>
                <span className="tool-icon">
                  <Icon className="size-4" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{tool.label}</span>
                  <span className="mt-1 block text-xs font-normal text-muted-foreground">
                    {tool.description}
                  </span>
                </span>
                <Badge variant="outline">{tool.group}</Badge>
              </DisclosureSummary>
              <Suspense
                fallback={<LoadingState label={"Opening " + tool.label} />}
              >
                {tool.id === "context-pack" ? (
                  <ContextBuilder />
                ) : (
                  <WorkflowTool id={tool.id} />
                )}
              </Suspense>
            </Disclosure>
          );
        })}
      </div>
      {!count ? (
        <div className="empty-state">
          <p>No tools match these filters.</p>
          <Button
            variant="outline"
            onClick={() => {
              setGroup("All");
              setQuery("");
            }}
          >
            Show all agent tools
          </Button>
        </div>
      ) : null}
    </section>
  );
}
