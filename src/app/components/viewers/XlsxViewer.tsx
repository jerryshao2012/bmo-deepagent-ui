"use client";

import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Table2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface XlsxViewerProps {
  xlsxData: ArrayBuffer;
  initialSheet?: string;
}

// Column letter conversion (0 → A, 26 → AA, etc.)
function colToLetter(col: number): string {
  let result = "";
  let n = col;
  while (n >= 0) {
    result = String.fromCharCode(65 + (n % 26)) + result;
    n = Math.floor(n / 26) - 1;
  }
  return result;
}

export const XlsxViewer: React.FC<XlsxViewerProps> = ({
  xlsxData,
  initialSheet,
}) => {
  const [workbook, setWorkbook] = useState<any>(null);
  const [xlsxModule, setXlsxModule] = useState<any>(null);
  const [activeSheet, setActiveSheet] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const XLSX = await import("xlsx");
        const wb = XLSX.read(xlsxData, { type: "array" });
        if (cancelled) return;
        setXlsxModule(() => XLSX);
        setWorkbook(wb);
        const sheetNames = wb.SheetNames as string[];
        if (sheetNames.length > 0) {
          // Prefer initialSheet if it exists, otherwise the first sheet
          const target =
            initialSheet && sheetNames.includes(initialSheet)
              ? initialSheet
              : sheetNames[0];
          setActiveSheet(target);
        }
      } catch (e) {
        if (!cancelled) {
          setError(`Failed to load spreadsheet: ${e}`);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [xlsxData]);

  // Render the active sheet as an HTML table with row/column headers
  const sheetData = useMemo(() => {
    if (!workbook || !activeSheet || !xlsxModule) return null;
    const worksheet = workbook.Sheets[activeSheet];
    if (!worksheet) return null;

    // Convert to array-of-arrays for easy table rendering
    const rows: any[][] = xlsxModule.utils.sheet_to_json(worksheet, {
      header: 1,
      raw: false,
      defval: "",
      blankrows: false,
    });
    return rows;
  }, [workbook, activeSheet]);

  // Detect the max column count for proper header rendering
  const maxCols = useMemo(() => {
    if (!sheetData || sheetData.length === 0) return 0;
    return Math.max(...sheetData.map((row) => row.length));
  }, [sheetData]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <span className="ml-3 text-sm text-muted-foreground">
          Loading spreadsheet…
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-red-500">{error}</p>
      </div>
    );
  }

  if (!workbook || !sheetData) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground">No data found</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Sheet tabs */}
      {workbook.SheetNames.length > 1 && (
        <div className="flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border bg-muted/30 px-3 py-2">
          {workbook.SheetNames.map((name: string) => (
            <Button
              key={name}
              variant={name === activeSheet ? "default" : "ghost"}
              size="sm"
              className="h-7 shrink-0 text-xs"
              onClick={() => setActiveSheet(name)}
            >
              <Table2 size={12} className="mr-1" />
              {name}
            </Button>
          ))}
        </div>
      )}

      {/* Sheet content */}
      <div className="flex-1 overflow-auto bg-white">
        <table className="border-collapse text-sm">
          <thead className="sticky top-0 z-10">
            <tr>
              <th className="sticky left-0 z-20 border border-zinc-300 bg-zinc-200 px-2 py-1 text-xs font-medium text-zinc-600">
                #
              </th>
              {Array.from({ length: maxCols }, (_, i) => i).map((col) => (
                <th
                  key={col}
                  className="border border-zinc-300 bg-zinc-200 px-3 py-1 text-xs font-medium text-zinc-600"
                >
                  {colToLetter(col)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheetData.map((row, rowIdx) => (
              <tr key={rowIdx} className="hover:bg-blue-50/40">
                <td className="sticky left-0 z-10 border border-zinc-300 bg-zinc-100 px-2 py-1 text-xs text-zinc-500">
                  {rowIdx + 1}
                </td>
                {Array.from({ length: maxCols }, (_, i) => i).map((col) => {
                  const cellVal = row[col];
                  const isNumeric =
                    typeof cellVal === "number" ||
                    (typeof cellVal === "string" &&
                      cellVal !== "" &&
                      !isNaN(Number(cellVal)));
                  return (
                    <td
                      key={col}
                      className={cn(
                        "border border-zinc-200 px-3 py-1 text-zinc-800",
                        isNumeric && "text-right tabular-nums"
                      )}
                    >
                      {cellVal !== undefined && cellVal !== ""
                        ? String(cellVal)
                        : ""}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Status bar */}
      <div className="shrink-0 border-t border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground">
        {sheetData.length} rows × {maxCols} columns
      </div>
    </div>
  );
};
