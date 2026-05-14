import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/dashboard";

export const Route = createFileRoute("/dashboard")({
  head: () => ({ meta: [{ title: "Finance Dashboard" }] }),
  component: Dashboard,
});
