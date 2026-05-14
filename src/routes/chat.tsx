import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Bot,
  Send,
  User,
  Sparkles,
  Code2,
  Database,
  Download,
  RefreshCw,
  ChevronDown,
  Loader2,
  Plus,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { formatCurrency, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "Ask About Your Finances" }] }),
  component: ChatPage,
});

type Row = Record<string, unknown>;

interface AIResponse {
  success: boolean;
  answer?: string;
  sql?: string;
  data?: Row[];
  intent?: string;
  execution_time_ms?: number;
  suggested_follow_ups?: string[];
  error?: string;
}

interface UserMessage {
  id: string;
  role: "user";
  content: string;
  ts: number;
}
interface AssistantMessage {
  id: string;
  role: "assistant";
  ts: number;
  query: string;
  loading: boolean;
  response?: AIResponse;
}
type Message = UserMessage | AssistantMessage;

const EXAMPLES = [
  "What were total sales in FY 2023-24?",
  "Compare sales vs purchases for January",
  "Which customer had the highest sales?",
  "Show outstanding invoices over 30 days",
  "Top 5 customers by revenue",
];

function ChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || sending) return;
    const userMsg: UserMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: q,
      ts: Date.now(),
    };
    const assistantId = crypto.randomUUID();
    const placeholder: AssistantMessage = {
      id: assistantId,
      role: "assistant",
      ts: Date.now(),
      query: q,
      loading: true,
    };
    setMessages((m) => [...m, userMsg, placeholder]);
    setInput("");
    setSending(true);

    try {
      const { data, error } = await supabase.functions.invoke<AIResponse>(
        "ai-financial-query",
        { body: { query: q } },
      );
      const response: AIResponse = error
        ? { success: false, error: error.message }
        : (data ?? { success: false, error: "Empty response" });

      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId && msg.role === "assistant"
            ? { ...msg, loading: false, response }
            : msg,
        ),
      );
      if (!response.success) {
        toast.error(response.error ?? "Query failed");
      }
    } catch (e) {
      const err = e instanceof Error ? e.message : "Unexpected error";
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantId && msg.role === "assistant"
            ? {
                ...msg,
                loading: false,
                response: { success: false, error: err },
              }
            : msg,
        ),
      );
      toast.error(err);
    } finally {
      setSending(false);
    }
  }

  function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send(input);
    }
  }

  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Header */}
      <div className="border-b px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
              <Sparkles className="h-5 w-5 text-primary" />
              Ask About Your Finances
            </h1>
            <p className="text-sm text-muted-foreground">
              Get instant answers from your data using AI
            </p>
          </div>
          {messages.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setMessages([])}
              className="gap-1"
            >
              <Plus className="h-4 w-4" /> New chat
            </Button>
          )}
        </div>
      </div>

      {/* Thread */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <EmptyState onPick={(q) => void send(q)} />
          )}
          {messages.map((m) =>
            m.role === "user" ? (
              <UserBubble key={m.id} msg={m} />
            ) : (
              <AssistantBubble
                key={m.id}
                msg={m}
                onFollowUp={(q) => void send(q)}
              />
            ),
          )}
        </div>
      </div>

      {/* Input */}
      <div className="border-t bg-background px-6 py-4">
        <div className="mx-auto max-w-3xl">
          <div className="relative rounded-xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKey}
              placeholder="Ask anything about your invoices, customers, or sales…"
              maxLength={500}
              rows={1}
              className="max-h-40 min-h-[48px] resize-none border-0 bg-transparent pr-24 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <div className="absolute bottom-2 right-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {input.length}/500
              </span>
              <Button
                size="icon"
                onClick={() => void send(input)}
                disabled={!input.trim() || sending}
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </div>
          </div>
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Press Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-6 w-6 text-primary" />
      </div>
      <h2 className="mt-4 text-lg font-semibold">How can I help?</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Try one of these to get started.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        {EXAMPLES.map((q) => (
          <button
            key={q}
            onClick={() => onPick(q)}
            className="rounded-full border bg-card px-3 py-1.5 text-sm text-foreground transition hover:bg-accent"
          >
            {q}
          </button>
        ))}
      </div>
    </div>
  );
}

function UserBubble({ msg }: { msg: UserMessage }) {
  return (
    <div className="flex justify-end gap-3">
      <div className="max-w-[80%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2.5 text-primary-foreground">
        <p className="whitespace-pre-wrap text-sm">{msg.content}</p>
      </div>
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
        <User className="h-4 w-4" />
      </div>
    </div>
  );
}

function AssistantBubble({
  msg,
  onFollowUp,
}: {
  msg: AssistantMessage;
  onFollowUp: (q: string) => void;
}) {
  return (
    <div className="flex gap-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
        <Bot className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        {msg.loading ? <ThinkingCard /> : msg.response ? (
          <ResponseCard response={msg.response} onFollowUp={onFollowUp} query={msg.query} />
        ) : null}
      </div>
    </div>
  );
}

function ThinkingCard() {
  const stages = ["Thinking", "Generating SQL", "Executing", "Formatting"];
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const id = setInterval(
      () => setStage((s) => (s + 1) % stages.length),
      1200,
    );
    return () => clearInterval(id);
  }, []);
  return (
    <Card>
      <CardContent className="flex items-center gap-3 py-4">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        <span className="text-sm text-muted-foreground">{stages[stage]}…</span>
      </CardContent>
    </Card>
  );
}

function ResponseCard({
  response,
  onFollowUp,
  query,
}: {
  response: AIResponse;
  onFollowUp: (q: string) => void;
  query: string;
}) {
  if (!response.success) {
    return (
      <Card className="border-destructive/40">
        <CardContent className="py-4 text-sm">
          <p className="font-medium text-destructive">
            {response.error ?? "Something went wrong"}
          </p>
          <p className="mt-1 text-muted-foreground">
            Try rephrasing your question, or check that data has been uploaded.
          </p>
        </CardContent>
      </Card>
    );
  }

  const data = response.data ?? [];

  function exportCsv() {
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map((row) =>
        headers
          .map((h) => JSON.stringify(row[h] ?? ""))
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `query-result-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-4">
        <p className="text-sm leading-relaxed">{response.answer}</p>

        <DataView data={data} />

        <div className="flex flex-wrap items-center gap-2 pt-2 text-xs text-muted-foreground">
          {response.intent && (
            <Badge variant="secondary" className="font-normal">
              {response.intent}
            </Badge>
          )}
          {typeof response.execution_time_ms === "number" && (
            <span>{response.execution_time_ms} ms</span>
          )}
          <span>· {data.length} rows</span>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={exportCsv}
            disabled={data.length === 0}
            className="gap-1"
          >
            <Download className="h-3.5 w-3.5" /> CSV
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onFollowUp(query)}
            className="gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Run again
          </Button>
        </div>

        {response.sql && <CollapsibleBlock label="SQL" icon={Code2} content={response.sql} mono />}
        {data.length > 0 && (
          <CollapsibleBlock
            label="Raw data"
            icon={Database}
            content={JSON.stringify(data, null, 2)}
            mono
          />
        )}

        {response.suggested_follow_ups && response.suggested_follow_ups.length > 0 && (
          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-muted-foreground">
              Suggested follow-ups
            </p>
            <div className="flex flex-wrap gap-2">
              {response.suggested_follow_ups.map((q) => (
                <button
                  key={q}
                  onClick={() => onFollowUp(q)}
                  className="rounded-full border bg-background px-3 py-1 text-xs transition hover:bg-accent"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function CollapsibleBlock({
  label,
  icon: Icon,
  content,
  mono,
}: {
  label: string;
  icon: typeof Code2;
  content: string;
  mono?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Icon className="h-3.5 w-3.5" />
        Show {label}
        <ChevronDown
          className={cn("h-3.5 w-3.5 transition", open && "rotate-180")}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2">
        <pre
          className={cn(
            "max-h-64 overflow-auto rounded-md bg-muted p-3 text-xs",
            mono && "font-mono",
          )}
        >
          {content}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function DataView({ data }: { data: Row[] }) {
  const shape = useMemo(() => detectShape(data), [data]);
  if (!shape) return null;

  if (shape.kind === "single") {
    const v = shape.value;
    const isMoney = shape.isMoney;
    return (
      <div className="rounded-lg border bg-muted/30 p-6 text-center">
        <div className="text-3xl font-semibold tracking-tight">
          {typeof v === "number"
            ? isMoney
              ? formatCurrency(v)
              : formatNumber(v)
            : String(v)}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{shape.label}</div>
      </div>
    );
  }

  if (shape.kind === "chart") {
    const Chart = shape.chartType === "line" ? LineChart : BarChart;
    const Series = shape.chartType === "line" ? Line : Bar;
    return (
      <Tabs defaultValue="chart">
        <TabsList>
          <TabsTrigger value="chart">Chart</TabsTrigger>
          <TabsTrigger value="table">Table</TabsTrigger>
        </TabsList>
        <TabsContent value="chart" className="pt-2">
          <div className="h-64 w-full">
            <ResponsiveContainer>
              <Chart data={shape.data}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis dataKey={shape.xKey} fontSize={11} />
                <YAxis fontSize={11} />
                <Tooltip />
                {/* @ts-expect-error recharts polymorphic */}
                <Series
                  type="monotone"
                  dataKey={shape.yKey}
                  fill="hsl(var(--primary))"
                  stroke="hsl(var(--primary))"
                />
              </Chart>
            </ResponsiveContainer>
          </div>
        </TabsContent>
        <TabsContent value="table" className="pt-2">
          <DataTable data={data} />
        </TabsContent>
      </Tabs>
    );
  }

  return <DataTable data={data} />;
}

function DataTable({ data }: { data: Row[] }) {
  if (data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No rows returned.</p>
    );
  }
  const headers = Object.keys(data[0]);
  const rows = data.slice(0, 50);
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <Table>
        <TableHeader>
          <TableRow>
            {headers.map((h) => (
              <TableHead key={h}>{h}</TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r, i) => (
            <TableRow key={i}>
              {headers.map((h) => (
                <TableCell key={h} className="whitespace-nowrap">
                  {formatCell(h, r[h])}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {data.length > 50 && (
        <p className="border-t bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          Showing first 50 of {data.length} rows
        </p>
      )}
    </div>
  );
}

function formatCell(key: string, value: unknown) {
  if (value == null) return "—";
  if (typeof value === "number") {
    if (/amount|total|sales|revenue|price|tax|subtotal/i.test(key)) {
      return formatCurrency(value);
    }
    return formatNumber(value);
  }
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

type Shape =
  | { kind: "single"; value: unknown; label: string; isMoney: boolean }
  | {
      kind: "chart";
      chartType: "line" | "bar";
      data: Row[];
      xKey: string;
      yKey: string;
    }
  | { kind: "table" };

function detectShape(data: Row[]): Shape | null {
  if (data.length === 0) return { kind: "table" };
  const keys = Object.keys(data[0]);

  if (data.length === 1 && keys.length === 1) {
    const k = keys[0];
    return {
      kind: "single",
      value: data[0][k],
      label: k,
      isMoney: /amount|total|sales|revenue|price/i.test(k),
    };
  }

  if (data.length >= 2 && data.length <= 50 && keys.length === 2) {
    const numericKey = keys.find((k) => typeof data[0][k] === "number");
    const labelKey = keys.find((k) => k !== numericKey);
    if (numericKey && labelKey) {
      const isTime = /date|month|day|year|period/i.test(labelKey);
      return {
        kind: "chart",
        chartType: isTime ? "line" : "bar",
        data,
        xKey: labelKey,
        yKey: numericKey,
      };
    }
  }

  return { kind: "table" };
}
