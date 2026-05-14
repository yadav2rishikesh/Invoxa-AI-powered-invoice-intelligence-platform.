import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers" }] }),
  component: () => (
    <div className="mx-auto w-full max-w-5xl p-6">
      <Card>
        <CardHeader><CardTitle className="capitalize">suppliers</CardTitle></CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Coming soon. This page is a placeholder.
        </CardContent>
      </Card>
    </div>
  ),
});
