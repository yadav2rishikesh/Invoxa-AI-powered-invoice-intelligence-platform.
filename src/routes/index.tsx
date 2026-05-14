import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/")({
  component: Index,
});

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? "https://tzyftwiookdvqxzllbbd.supabase.co";

function Index() {
  const [status, setStatus] = useState<string>("⏳ Testing connection...");

  useEffect(() => {
    (async () => {
      const { error } = await supabase.from("test").select("count");
      if (!error) {
        setStatus("✅ Database accessible");
      } else if (
        error.message?.toLowerCase().includes("relation") &&
        error.message?.toLowerCase().includes("does not exist")
      ) {
        setStatus("⚠️ No tables yet (this is fine - we'll add them next)");
      } else {
        setStatus(`❌ Connection failed: ${error.message}`);
      }
    })();
  }, []);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Supabase Connection Test</CardTitle>
          <CardDescription>Live check against your project</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div>
            <div className="text-muted-foreground">Supabase URL</div>
            <div className="break-all font-mono">{SUPABASE_URL}</div>
          </div>
          <div>
            <div className="text-muted-foreground">Status</div>
            <div className="font-medium">{status}</div>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
