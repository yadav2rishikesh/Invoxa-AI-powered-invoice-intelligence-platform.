import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useMemo, useState } from "react";
import { useDropzone } from "react-dropzone";
import { FileSpreadsheet, UploadCloud, X, ChevronDown, ChevronRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  parseFile, autoDetect, FIELDS, processUpload,
  type FieldKey, type UploadResult,
} from "@/lib/invoice-upload";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Bulk Invoice Upload" },
      { name: "description", content: "Upload CSV or Excel files to import invoices in bulk." },
    ],
  }),
  component: UploadPage,
});

const MAX_BYTES = 10 * 1024 * 1024;

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [showErrors, setShowErrors] = useState(false);

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      toast.error("File exceeds 10MB limit");
      return;
    }
    try {
      const { columns, rows } = await parseFile(f);
      if (!rows.length) {
        toast.error("No rows found in the file");
        return;
      }
      setFile(f);
      setColumns(columns);
      setRows(rows);
      setMapping(autoDetect(columns));
      setResult(null);
    } catch (e: any) {
      toast.error(`Parse failed: ${e?.message ?? e}`);
    }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: false,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  });

  const requiredMapped = useMemo(
    () => FIELDS.filter((f) => f.required).every((f) => !!mapping[f.key]),
    [mapping],
  );

  function reset() {
    setFile(null); setColumns([]); setRows([]); setMapping({});
    setProgress(0); setResult(null); setShowErrors(false);
  }

  async function handleUpload() {
    if (!file) return;
    setUploading(true);
    setProgress(0);
    try {
      const res = await processUpload(file.name, rows, mapping, setProgress);
      setResult(res);
      toast.success(`Processed ${res.total} rows`);
    } catch (e: any) {
      toast.error(`Upload failed: ${e?.message ?? e}`);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Bulk Invoice Upload</h1>
        <p className="mt-1 text-muted-foreground">
          Upload CSV or Excel files to import invoices
        </p>
      </header>

      {!result && (
        <Card>
          <CardContent className="p-4">
            {!file ? (
              <div
                {...getRootProps()}
                className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors ${
                  isDragActive ? "border-primary bg-accent/40" : "border-border hover:bg-accent/20"
                }`}
              >
                <input {...getInputProps()} />
                <UploadCloud className="h-10 w-10 text-muted-foreground" />
                <div className="space-y-1">
                  <div className="font-medium">Drop CSV or Excel files here</div>
                  <div className="text-sm text-muted-foreground">
                    or <span className="text-primary underline">click to browse</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Accepts .csv, .xlsx, .xls — max 10MB
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between rounded-lg border bg-card p-4">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                  <div>
                    <div className="font-medium">{file.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatSize(file.size)} · {rows.length} rows · {columns.length} columns
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={reset} disabled={uploading}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {file && !result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>First 5 of {rows.length} rows</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {columns.map((c) => (
                      <TableHead key={c}>{c}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 5).map((r, i) => (
                    <TableRow key={i}>
                      {columns.map((c) => (
                        <TableCell key={c} className="max-w-[200px] truncate">
                          {String(r[c] ?? "")}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Column Mapping</CardTitle>
              <CardDescription>
                Auto-detected from your headers. Adjust if needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {FIELDS.map((f) => (
                <div key={f.key} className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_2fr]">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{f.label}</span>
                    {f.required ? (
                      <Badge variant="destructive">Required</Badge>
                    ) : (
                      <Badge variant="secondary">Optional</Badge>
                    )}
                  </div>
                  <Select
                    value={mapping[f.key] ?? "__none__"}
                    onValueChange={(v) =>
                      setMapping((m) => ({ ...m, [f.key]: v === "__none__" ? undefined : v }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="— Not mapped —" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">— Not mapped —</SelectItem>
                      {columns.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-3 p-4">
              {uploading && (
                <div className="space-y-1">
                  <Progress value={progress} />
                  <div className="text-xs text-muted-foreground">{progress}%</div>
                </div>
              )}
              <Button
                onClick={handleUpload}
                disabled={!requiredMapped || uploading}
                className="w-full"
                size="lg"
              >
                {uploading ? "Processing…" : "Process & Upload"}
              </Button>
              {!requiredMapped && (
                <p className="text-xs text-muted-foreground">
                  Map all required fields to enable upload.
                </p>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {result && (
        <Card>
          <CardHeader>
            <CardTitle>Upload Complete</CardTitle>
            <CardDescription>{file?.name}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Total" value={result.total} tone="muted" />
              <Stat label="Imported" value={result.imported} tone="success" />
              <Stat label="Duplicates" value={result.duplicates} tone="warning" />
              <Stat label="Failed" value={result.failed} tone="destructive" />
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg border">
                <button
                  className="flex w-full items-center justify-between p-3 text-left text-sm font-medium hover:bg-accent/40"
                  onClick={() => setShowErrors((s) => !s)}
                >
                  <span>Error log ({result.errors.length})</span>
                  {showErrors ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                </button>
                {showErrors && (
                  <div className="max-h-72 overflow-auto border-t">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-20">Row</TableHead>
                          <TableHead>Error</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.errors.map((e, i) => (
                          <TableRow key={i}>
                            <TableCell className="font-mono">{e.row}</TableCell>
                            <TableCell className="text-destructive">{e.error}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            )}

            <Button onClick={reset} variant="outline" className="w-full">
              Upload Another
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: number; tone: "muted" | "success" | "warning" | "destructive" }) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-foreground",
    success: "bg-green-500/10 text-green-600 dark:text-green-400",
    warning: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <div className={`rounded-lg p-4 ${tones[tone]}`}>
      <div className="text-xs uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
    </div>
  );
}
