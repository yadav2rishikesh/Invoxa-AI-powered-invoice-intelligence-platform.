import { createFileRoute } from "@tanstack/react-router";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { MessageSquare } from "lucide-react";

export const Route = createFileRoute("/chat")({
  head: () => ({ meta: [{ title: "AI Chat" }] }),
  component: () => (
    <div className="mx-auto w-full max-w-3xl p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5" /> AI Chat
          </CardTitle>
          <CardDescription>Coming soon</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Ask questions about your invoices and customers — assistant integration is on the roadmap.
        </CardContent>
      </Card>
    </div>
  ),
});
