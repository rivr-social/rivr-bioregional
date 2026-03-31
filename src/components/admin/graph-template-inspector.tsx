"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

type TemplateLibrary = Record<string, Record<string, Record<string, unknown>>>;

type Props = {
  templates: TemplateLibrary;
};

export default function GraphTemplateInspector({ templates }: Props) {
  const tableOptions = useMemo(() => Object.keys(templates), [templates]);
  const [table, setTable] = useState<string>(tableOptions[0] ?? "agents");
  const typeOptions = useMemo(() => Object.keys(templates[table] ?? {}), [templates, table]);
  const [type, setType] = useState<string>(typeOptions[0] ?? "person");

  const selectedTemplate = useMemo(
    () => templates[table]?.[type] ?? {},
    [templates, table, type]
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Entity Template Inspector</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="text-xs text-muted-foreground">
          Model note: this repo uses <span className="font-mono">agents/resources/ledger</span> tables. Functionally this maps to objects + associations.
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <label className="text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Table</span>
            <select
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              value={table}
              onChange={(event) => {
                const nextTable = event.target.value;
                const nextType = Object.keys(templates[nextTable] ?? {})[0] ?? "";
                setTable(nextTable);
                setType(nextType);
              }}
            >
              {tableOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
          <label className="text-sm space-y-1">
            <span className="text-xs text-muted-foreground">Type</span>
            <select
              className="w-full rounded border bg-background px-2 py-2 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              {typeOptions.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </label>
        </div>

        <div className="flex items-center gap-2 text-xs">
          <Badge variant="outline">table: {table}</Badge>
          <Badge variant="outline">type: {type}</Badge>
        </div>

        <pre className="max-h-[420px] overflow-auto rounded border bg-muted/30 p-3 text-xs leading-5">
{JSON.stringify(selectedTemplate, null, 2)}
        </pre>
      </CardContent>
    </Card>
  );
}
