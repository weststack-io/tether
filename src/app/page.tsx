import prisma from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

type SeverityKey = "high" | "medium" | "low";

const SEVERITY_CARDS: Array<{
  key: SeverityKey;
  label: string;
  containerClass: string;
  countClass: string;
}> = [
  {
    key: "high",
    label: "High",
    containerClass: "bg-red-50 ring-red-200 dark:bg-red-950/30 dark:ring-red-900",
    countClass: "text-red-700 dark:text-red-400",
  },
  {
    key: "medium",
    label: "Medium",
    containerClass:
      "bg-amber-50 ring-amber-200 dark:bg-amber-950/30 dark:ring-amber-900",
    countClass: "text-amber-700 dark:text-amber-400",
  },
  {
    key: "low",
    label: "Low",
    containerClass:
      "bg-blue-50 ring-blue-200 dark:bg-blue-950/30 dark:ring-blue-900",
    countClass: "text-blue-700 dark:text-blue-400",
  },
];

async function getOpenAlertSeverityCounts(): Promise<Record<SeverityKey, number>> {
  const rows = await prisma.alert.groupBy({
    by: ["severity"],
    where: { status: "open" },
    _count: { _all: true },
  });
  const counts: Record<SeverityKey, number> = { high: 0, medium: 0, low: 0 };
  for (const row of rows) {
    if (row.severity === "high" || row.severity === "medium" || row.severity === "low") {
      counts[row.severity] = row._count._all;
    }
  }
  return counts;
}

export default async function DashboardPage() {
  const counts = await getOpenAlertSeverityCounts();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Open alerts by severity
        </p>
      </div>

      <div
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
        data-testid="severity-cards"
      >
        {SEVERITY_CARDS.map((card) => (
          <Card
            key={card.key}
            data-severity={card.key}
            className={card.containerClass}
          >
            <CardHeader>
              <CardTitle>{card.label}</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className={`font-heading text-4xl font-semibold tabular-nums ${card.countClass}`}
                data-testid={`severity-count-${card.key}`}
              >
                {counts[card.key]}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                open alerts
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
