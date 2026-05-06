import prisma from "@/lib/db";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { TriggerIngestionButton } from "@/components/dashboard/TriggerIngestionButton";

export const dynamic = "force-dynamic";

type SeverityKey = "high" | "medium" | "low";
type RegulatorKey = "SEC" | "FINRA" | "CFPB" | "OCC";

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

const REGULATOR_CARDS: Array<{
  key: RegulatorKey;
  label: string;
  description: string;
}> = [
  { key: "SEC", label: "SEC", description: "Securities and Exchange Commission" },
  { key: "FINRA", label: "FINRA", description: "Financial Industry Regulatory Authority" },
  { key: "CFPB", label: "CFPB", description: "Consumer Financial Protection Bureau" },
  { key: "OCC", label: "OCC", description: "Office of the Comptroller of the Currency" },
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

async function getOpenAlertRegulatorCounts(): Promise<Record<RegulatorKey, number>> {
  const rows = await prisma.alert.findMany({
    where: { status: "open" },
    select: { regulatoryItem: { select: { regulator: true } } },
  });
  const counts: Record<RegulatorKey, number> = { SEC: 0, FINRA: 0, CFPB: 0, OCC: 0 };
  for (const row of rows) {
    const reg = row.regulatoryItem.regulator;
    if (reg === "SEC" || reg === "FINRA" || reg === "CFPB" || reg === "OCC") {
      counts[reg] += 1;
    }
  }
  return counts;
}

export default async function DashboardPage() {
  const [severityCounts, regulatorCounts] = await Promise.all([
    getOpenAlertSeverityCounts(),
    getOpenAlertRegulatorCounts(),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            Open alerts by severity
          </p>
        </div>
        <TriggerIngestionButton />
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
                {severityCounts[card.key]}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                open alerts
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <section className="space-y-3">
        <div>
          <h2 className="font-heading text-lg font-semibold">By regulator</h2>
          <p className="text-sm text-muted-foreground">
            Open alerts grouped by source regulator
          </p>
        </div>
        <div
          className="grid grid-cols-2 gap-4 sm:grid-cols-4"
          data-testid="regulator-cards"
        >
          {REGULATOR_CARDS.map((card) => (
            <Card key={card.key} data-regulator={card.key}>
              <CardHeader>
                <CardTitle>{card.label}</CardTitle>
              </CardHeader>
              <CardContent>
                <div
                  className="font-heading text-4xl font-semibold tabular-nums"
                  data-testid={`regulator-count-${card.key}`}
                >
                  {regulatorCounts[card.key]}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {card.description}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}
