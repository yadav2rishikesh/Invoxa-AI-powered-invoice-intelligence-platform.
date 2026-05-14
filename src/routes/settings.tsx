import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/settings")({
  head: () => ({ meta: [{ title: "Settings" }] }),
  component: () => (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Card>
        <CardHeader><CardTitle className="capitalize">settings</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Coming soon. This page is a placeholder.
        </CardContent>
      </Card>
    </div>
  ),
});
