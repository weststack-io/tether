import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import DashboardLoading from "@/app/loading";
import AlertsLoading from "@/app/alerts/loading";
import AlertDetailLoading from "@/app/alerts/[id]/loading";
import IngestionLoading from "@/app/ingestion/loading";

describe("UI-001 route loading components", () => {
  it("renders the dashboard loading skeleton", () => {
    const html = renderToStaticMarkup(<DashboardLoading />);
    expect(html).toContain('data-testid="dashboard-loading"');
    expect(html).toContain("animate-pulse");
  });

  it("renders the alerts list loading skeleton", () => {
    const html = renderToStaticMarkup(<AlertsLoading />);
    expect(html).toContain('data-testid="alerts-loading"');
    expect(html).toContain("animate-pulse");
  });

  it("renders the alert detail loading skeleton", () => {
    const html = renderToStaticMarkup(<AlertDetailLoading />);
    expect(html).toContain('data-testid="alert-detail-loading"');
    expect(html).toContain("animate-pulse");
  });

  it("renders the ingestion log loading skeleton", () => {
    const html = renderToStaticMarkup(<IngestionLoading />);
    expect(html).toContain('data-testid="ingestion-loading"');
    expect(html).toContain("animate-pulse");
  });
});
