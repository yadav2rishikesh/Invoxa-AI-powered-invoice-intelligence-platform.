import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/reports")({
  head: () => ({ meta: [{ title: "Reports" }] }),
  component: () => (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Card>
        <CardHeader><CardTitle className="capitalize">reports</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Coming soon. This page is a placeholder.
        </CardContent>
      </Card>
    </div>
  ),
});
