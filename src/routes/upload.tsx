import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDropzone } from "react-dropzone";
import {
  FileSpreadsheet, UploadCloud, X, ChevronDown, ChevronRight,
  CheckCircle2, AlertTriangle, Receipt, ShoppingCart, Sparkles, Download, Loader2,
} from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  parsePreview, smartDetect, processUpload, FIELDS,
  type FieldKey, type InvoiceType, type DetectedMapping,
  type ProgressUpdate, type UploadResult, type ParseResult,
} from "@/lib/invoice-upload";

export const Route = createFileRoute("/upload")({
  head: () => ({
    meta: [
      { title: "Bulk Invoice Upload" },
      { name: "description", content: "Upload CSV or Excel files. Handles 1 lakh — 10 lakh invoices with smart column mapping." },
    ],
  }),
  component: UploadPage,
});

const MAX_BYTES = 50 * 1024 * 1024;
const REQUIRED_KEYS: FieldKey[] = ["invoice_number", "invoice_date", "party_name", "total_amount"];
const OPTIONAL_KEYS: FieldKey[] = ["due_date", "subtotal", "tax_amount", "discount", "gstin", "hsn_code", "notes"];

function fmtBytes(b: number) {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  return `${(b / (1024 * 1024)).toFixed(2)} MB`;
}
function fmtMs(ms: number) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  if (m < 60) return `${m}m ${r}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
function estimate(rows: number) {
  // Roughly 200 rows/sec for client-side path.
  return fmtMs((rows / 200) * 1000);
}

function UploadPage() {
  const [invoiceType, setInvoiceType] = useState<InvoiceType | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const [detected, setDetected] = useState<Partial<Record<FieldKey, DetectedMapping>>>({});
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [parsing, setParsing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<ProgressUpdate | null>(null);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [errOpen, setErrOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const onDrop = useCallback(async (accepted: File[]) => {
    const f = accepted[0];
    if (!f || !invoiceType) return;
    if (f.size > MAX_BYTES) { toast.error("File exceeds 50MB limit"); return; }
    setParsing(true);
    try {
      const p = await parsePreview(f, 10);
      if (!p.columns.length) throw new Error("Could not detect any columns");
      setFile(f);
      setPreview(p);
      const det = await smartDetect(p.columns, invoiceType);
      setDetected(det);
      const m: Partial<Record<FieldKey, string>> = {};
      for (const k of Object.keys(det) as FieldKey[]) m[k] = det[k]!.column;
      setMapping(m);
      setResult(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Parse failed: ${msg}`);
    } finally {
      setParsing(false);
    }
  }, [invoiceType]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop, multiple: false, disabled: !invoiceType || parsing || uploading,
    accept: {
      "text/csv": [".csv"],
      "application/vnd.ms-excel": [".xls"],
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
    },
  });

  const requiredMapped = useMemo(
    () => REQUIRED_KEYS.every((k) => !!mapping[k]),
    [mapping],
  );
  const unmappedCols = useMemo(() => {
    if (!preview) return [];
    const used = new Set(Object.values(mapping).filter(Boolean) as string[]);
    return preview.columns.filter((c) => !used.has(c));
  }, [preview, mapping]);

  function reset(keepType = true) {
    setFile(null); setPreview(null); setDetected({}); setMapping({});
    setProgress(null); setResult(null); setErrOpen(false); setUploading(false);
    if (!keepType) setInvoiceType(null);
  }

  async function handleUpload() {
    if (!file || !invoiceType) return;
    setUploading(true);
    setProgress(null);
    abortRef.current = new AbortController();
    try {
      const res = await processUpload({
        file, invoiceType, mapping,
        onProgress: setProgress,
        signal: abortRef.current.signal,
      });
      setResult(res);
      toast.success(`Imported ${res.imported.toLocaleString()} of ${res.total.toLocaleString()} rows`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error(`Upload failed: ${msg}`);
    } finally {
      setUploading(false);
    }
  }

  function cancel() {
    abortRef.current?.abort();
    toast.message("Cancelling…");
  }

  function downloadErrorsCsv() {
    if (!result?.errors.length) return;
    const headers = ["row", "error_type", "error", "data"];
    const csv = [
      headers.join(","),
      ...result.errors.map((e) =>
        [e.row, e.errorType, JSON.stringify(e.error), JSON.stringify(e.data)]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `errors_${result.batchId}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  // ============ RENDER ============
  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 p-6">
      <header className="space-y-3">
        <h1 className="text-3xl font-semibold tracking-tight">Bulk Invoice Upload</h1>
        <p className="text-muted-foreground">
          Upload CSV/Excel files. System handles 1 lakh — 10 lakh invoices.
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">Max 50MB</Badge>
          <Badge variant="secondary">CSV / XLSX</Badge>
          <Badge variant="secondary">Auto-detect columns</Badge>
        </div>
      </header>

      {/* STEP 1: type selector */}
      {!result && (
        <Card>
          <CardHeader>
            <CardTitle>1. Invoice Type</CardTitle>
            <CardDescription>Select what kind of invoices you're uploading.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <TypeCard
              active={invoiceType === "sales"}
              onClick={() => { if (!file) setInvoiceType("sales"); }}
              disabled={!!file}
              icon={<Receipt className="h-6 w-6" />}
              title="Sales Invoices"
              desc="Invoices issued to customers"
            />
            <TypeCard
              active={invoiceType === "purchase"}
              onClick={() => { if (!file) setInvoiceType("purchase"); }}
              disabled={!!file}
              icon={<ShoppingCart className="h-6 w-6" />}
              title="Purchase Invoices"
              desc="Invoices received from suppliers"
            />
          </CardContent>
        </Card>
      )}

      {/* STEP 2: dropzone */}
      {!result && (
        <Card>
          <CardHeader>
            <CardTitle>2. File</CardTitle>
            <CardDescription>
              {invoiceType ? "Drop a CSV or Excel file." : "Select an invoice type above first."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!file ? (
              <div
                {...getRootProps()}
                className={cn(
                  "group flex flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-12 text-center transition-colors",
                  invoiceType
                    ? "cursor-pointer hover:bg-accent/30"
                    : "cursor-not-allowed opacity-60",
                  isDragActive && "border-primary bg-accent/40",
                )}
              >
                <input {...getInputProps()} />
                {parsing ? (
                  <Loader2 className="h-10 w-10 animate-spin text-muted-foreground" />
                ) : (
                  <UploadCloud className="h-10 w-10 text-muted-foreground transition-transform group-hover:scale-110" />
                )}
                <div className="space-y-1">
                  <div className="font-medium">
                    {parsing ? "Parsing…" : "Drop CSV or Excel files here"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    or <span className="text-primary underline">click to browse</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    Accepts .csv, .xlsx, .xls — max 50MB
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
                      {fmtBytes(file.size)} · {file.type || file.name.split(".").pop()?.toUpperCase()}
                      {preview && ` · ${preview.totalRows.toLocaleString()} rows`}
                      {preview?.delimiter && ` · delimiter "${preview.delimiter}"`}
                    </div>
                  </div>
                </div>
                <Button variant="ghost" size="icon" onClick={() => reset()} disabled={uploading}>
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 3: preview */}
      {file && preview && !result && (
        <Card>
          <CardHeader>
            <CardTitle>3. Preview</CardTitle>
            <CardDescription>
              First {preview.rows.length} of {preview.totalRows.toLocaleString()} rows
            </CardDescription>
          </CardHeader>
          <CardContent className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {preview.columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.rows.map((r, i) => (
                  <TableRow key={i}>
                    {preview.columns.map((c) => (
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
      )}

      {/* STEP 4: column mapping */}
      {file && preview && invoiceType && !result && (
        <Card>
          <CardHeader>
            <CardTitle>4. Column Mapping</CardTitle>
            <CardDescription>
              Auto-detected from headers and your previous uploads. Review and adjust.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <MappingSection
              title="Required"
              keys={REQUIRED_KEYS}
              invoiceType={invoiceType}
              columns={preview.columns}
              detected={detected}
              mapping={mapping}
              setMapping={setMapping}
              required
            />
            <MappingSection
              title="Optional"
              keys={OPTIONAL_KEYS}
              invoiceType={invoiceType}
              columns={preview.columns}
              detected={detected}
              mapping={mapping}
              setMapping={setMapping}
            />
            {unmappedCols.length > 0 && (
              <div>
                <h3 className="mb-2 text-sm font-semibold">
                  Unmapped Columns
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    Stored as raw_data
                  </span>
                </h3>
                <div className="flex flex-wrap gap-2">
                  {unmappedCols.map((c) => (
                    <Badge key={c} variant="outline">{c}</Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 5: actions / progress */}
      {file && preview && !result && (
        <Card>
          <CardContent className="space-y-4 p-4">
            {!requiredMapped && (
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Map all required fields</AlertTitle>
                <AlertDescription>
                  Required fields must be mapped before uploading.
                </AlertDescription>
              </Alert>
            )}
            {uploading && progress && (
              <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">
                    Processing {progress.processed.toLocaleString()} / {progress.total.toLocaleString()}
                  </span>
                  <span className="text-muted-foreground">
                    {Math.round(progress.rowsPerSec)} rows/s
                  </span>
                </div>
                <Progress value={(progress.processed / Math.max(progress.total, 1)) * 100} />
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
                  <Stat tone="success" label="Imported" value={progress.imported} />
                  <Stat tone="warning" label="Duplicates" value={progress.duplicates} />
                  <Stat tone="destructive" label="Failed" value={progress.failed} />
                  <Stat tone="muted" label="Elapsed" value={fmtMs(progress.elapsedMs)} />
                  <Stat tone="muted" label="ETA" value={fmtMs(progress.etaMs)} />
                </div>
              </div>
            )}
            <div className="flex flex-col gap-2 sm:flex-row">
              {!uploading ? (
                <>
                  <Button
                    onClick={handleUpload}
                    disabled={!requiredMapped || parsing}
                    size="lg"
                    className="flex-1"
                  >
                    Process & Upload
                  </Button>
                  <Button variant="outline" size="lg" onClick={() => reset()}>
                    Cancel
                  </Button>
                </>
              ) : (
                <Button variant="destructive" size="lg" className="flex-1" onClick={cancel}>
                  Cancel Upload
                </Button>
              )}
            </div>
            {!uploading && requiredMapped && (
              <p className="text-xs text-muted-foreground">
                Estimated ~{estimate(preview.totalRows)} for {preview.totalRows.toLocaleString()} rows.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* STEP 6: results */}
      {result && (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              {result.failed === 0 ? (
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              ) : (
                <AlertTriangle className="h-8 w-8 text-yellow-600" />
              )}
              <div>
                <CardTitle>
                  {result.failed === 0 ? "Upload complete" : "Completed with issues"}
                </CardTitle>
                <CardDescription>{file?.name}</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            <Tabs defaultValue="summary">
              <TabsList>
                <TabsTrigger value="summary">Summary</TabsTrigger>
                <TabsTrigger value="errors">
                  Errors {result.errors.length ? `(${result.errors.length})` : ""}
                </TabsTrigger>
              </TabsList>
              <TabsContent value="summary" className="mt-4">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
                  <Stat label="Total" value={result.total.toLocaleString()} tone="muted" />
                  <Stat label="Imported" value={result.imported.toLocaleString()} tone="success" />
                  <Stat label="Duplicates" value={result.duplicates.toLocaleString()} tone="warning" />
                  <Stat label="Failed" value={result.failed.toLocaleString()} tone="destructive" />
                  <Stat label="Time" value={fmtMs(result.elapsedMs)} tone="muted" />
                  <Stat label="Speed" value={`${Math.round(result.rowsPerSec)}/s`} tone="muted" />
                </div>
              </TabsContent>
              <TabsContent value="errors" className="mt-4">
                {!result.errors.length ? (
                  <p className="text-sm text-muted-foreground">No errors.</p>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm text-muted-foreground">
                        Grouped by error type — first 100 shown.
                      </p>
                      <Button variant="outline" size="sm" onClick={downloadErrorsCsv}>
                        <Download className="mr-2 h-4 w-4" />
                        Download CSV
                      </Button>
                    </div>
                    <ErrorGroups errors={result.errors} open={errOpen} setOpen={setErrOpen} />
                  </div>
                )}
              </TabsContent>
            </Tabs>

            <div className="flex flex-wrap gap-2">
              <Button onClick={() => reset()}>Upload Another</Button>
              <Button variant="outline" asChild>
                <Link to="/">View Dashboard</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="border-dashed bg-muted/20">
        <CardContent className="flex items-start gap-3 p-4 text-sm text-muted-foreground">
          <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            Processing runs in your browser and writes to Supabase in 500-row chunks with hash-based
            deduplication. Run <code className="rounded bg-muted px-1">supabase/schema.sql</code> in
            your Supabase SQL editor to enable invoice-type, suppliers, mapping memory, and progress
            tracking.
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TypeCard({
  active, disabled, onClick, icon, title, desc,
}: {
  active: boolean; disabled?: boolean; onClick: () => void;
  icon: React.ReactNode; title: string; desc: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-start gap-3 rounded-lg border-2 p-4 text-left transition-all",
        active ? "border-primary bg-primary/5 shadow-sm" : "border-border hover:border-primary/50",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <div className={cn(
        "rounded-md p-2",
        active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
      )}>
        {icon}
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <div className="text-sm text-muted-foreground">{desc}</div>
      </div>
    </button>
  );
}

function MappingSection({
  title, keys, invoiceType, columns, detected, mapping, setMapping, required,
}: {
  title: string;
  keys: FieldKey[];
  invoiceType: InvoiceType;
  columns: string[];
  detected: Partial<Record<FieldKey, DetectedMapping>>;
  mapping: Partial<Record<FieldKey, string>>;
  setMapping: React.Dispatch<React.SetStateAction<Partial<Record<FieldKey, string>>>>;
  required?: boolean;
}) {
  return (
    <div>
      <h3 className="mb-3 text-sm font-semibold">{title}</h3>
      <div className="space-y-3">
        {keys.map((k) => {
          const def = FIELDS.find((f) => f.key === k)!;
          const det = detected[k];
          const value = mapping[k];
          const isMapped = !!value;
          return (
            <div key={k} className="grid grid-cols-1 items-center gap-3 sm:grid-cols-[1fr_2fr_auto]">
              <div className="flex items-center gap-2">
                <span className="font-medium">{def.label(invoiceType)}</span>
                {required ? (
                  <Badge variant="destructive">Required</Badge>
                ) : (
                  <Badge variant="secondary">Optional</Badge>
                )}
              </div>
              <Select
                value={value ?? "__none__"}
                onValueChange={(v) =>
                  setMapping((m) => ({ ...m, [k]: v === "__none__" ? undefined : v }))
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
              <div className="flex items-center gap-2 text-xs">
                {isMapped ? (
                  <Badge className="bg-green-500/15 text-green-700 hover:bg-green-500/20 dark:text-green-400">
                    ✅ Mapped
                  </Badge>
                ) : required ? (
                  <Badge variant="destructive">⚠️ Required</Badge>
                ) : (
                  <Badge variant="outline">⏭️ Skipped</Badge>
                )}
                {det && isMapped && det.column === value && (
                  <span className="text-muted-foreground">
                    {Math.round(det.confidence * 100)}% · {det.source}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Stat({
  label, value, tone,
}: { label: string; value: number | string; tone: "muted" | "success" | "warning" | "destructive" }) {
  const tones: Record<string, string> = {
    muted: "bg-muted text-foreground",
    success: "bg-green-500/10 text-green-700 dark:text-green-400",
    warning: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400",
    destructive: "bg-destructive/10 text-destructive",
  };
  return (
    <div className={cn("rounded-lg p-3", tones[tone])}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="mt-0.5 text-lg font-semibold">{value}</div>
    </div>
  );
}

function ErrorGroups({
  errors, open, setOpen,
}: {
  errors: UploadResult["errors"];
  open: boolean;
  setOpen: (b: boolean) => void;
}) {
  const groups = useMemo(() => {
    const m = new Map<string, UploadResult["errors"]>();
    for (const e of errors) {
      if (!m.has(e.errorType)) m.set(e.errorType, []);
      m.get(e.errorType)!.push(e);
    }
    return Array.from(m.entries());
  }, [errors]);

  return (
    <div className="space-y-2">
      {groups.map(([type, list]) => (
        <details key={type} className="rounded-lg border" open={open}>
          <summary
            className="flex cursor-pointer items-center justify-between p-3 text-sm font-medium"
            onClick={() => setOpen(!open)}
          >
            <span className="flex items-center gap-2">
              <ChevronRight className="h-4 w-4 transition-transform [details[open]_&]:rotate-90" />
              {type}
            </span>
            <Badge variant="secondary">{list.length}</Badge>
          </summary>
          <div className="max-h-72 overflow-auto border-t">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Row</TableHead>
                  <TableHead>Error</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {list.slice(0, 100).map((e, i) => (
                  <TableRow key={i}>
                    <TableCell className="font-mono">{e.row}</TableCell>
                    <TableCell className="text-destructive">{e.error}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </details>
      ))}
      {/* keep ChevronDown referenced to avoid lint */}
      <ChevronDown className="hidden" />
    </div>
  );
}
