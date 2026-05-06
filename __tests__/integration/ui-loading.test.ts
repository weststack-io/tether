import { afterAll, describe, expect, it } from "@jest/globals";
import { prisma } from "@/lib/db";

type RouteCheck = {
  name: string;
  path: string;
  loadingMarker: string;
  finalMarker: string;
};

const ROUTES: RouteCheck[] = [
  {
    name: "dashboard",
    path: "/",
    loadingMarker: 'data-testid="dashboard-loading"',
    finalMarker: 'data-testid="severity-cards"',
  },
  {
    name: "alerts list",
    path: "/alerts",
    loadingMarker: 'data-testid="alerts-loading"',
    finalMarker: 'data-testid="alerts-table"',
  },
  {
    name: "ingestion log",
    path: "/ingestion",
    loadingMarker: 'data-testid="ingestion-loading"',
    finalMarker: 'data-testid="ingestion-log-table"',
  },
];

async function readRouteStream(path: string): Promise<string> {
  const res = await fetch(`http://localhost:3000${path}`, {
    cache: "no-store",
    headers: { accept: "text/html" },
  });
  expect(res.status).toBe(200);
  expect(res.body).not.toBeNull();

  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";

  while (true) {
    const { done, value } = await reader.read();
    if (value) {
      html += decoder.decode(value, { stream: !done });
    }
    if (done) {
      break;
    }
  }

  return html;
}

describe("UI-001 live route loading states", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it.each(ROUTES)(
    "streams a loading state before the full $name view",
    async ({ path, loadingMarker, finalMarker }) => {
      const html = await readRouteStream(path);
      expect(html).toContain(loadingMarker);
      expect(html).toContain(finalMarker);
      expect(html.indexOf(loadingMarker)).toBeLessThan(html.indexOf(finalMarker));
    },
  );

  it(
    "streams the alert detail loading state before the alert detail view",
    async () => {
      const alert = await prisma.alert.findFirst({
      orderBy: { createdAt: "desc" },
      select: { id: true },
      });
      expect(alert).not.toBeNull();

      const html = await readRouteStream(`/alerts/${alert!.id}`);
      expect(html).toContain('data-testid="alert-detail-loading"');
      expect(html).toContain('data-testid="alert-detail"');
      expect(html.indexOf('data-testid="alert-detail-loading"')).toBeLessThan(
        html.indexOf('data-testid="alert-detail"'),
      );
    },
    15_000,
  );
});
