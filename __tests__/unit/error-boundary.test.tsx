// UI-003: route-level error boundary unit test.
//
// `src/app/error.tsx` is the fallback Next.js renders when a server
// component throws. The component fires `toast.error` in a useEffect and
// shows a static fallback card with a retry button. This test exercises the
// SSR'd markup contract — fields that other tests (Playwright, integration)
// rely on as anchors.

import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import RouteError from "@/app/error";

describe("UI-003 route-level error boundary", () => {
  it("renders the fallback card with the error message", () => {
    const html = renderToStaticMarkup(
      <RouteError
        error={Object.assign(new Error("Simulated DB outage"), {
          digest: "DIGEST_ABC",
        })}
        reset={() => {}}
      />,
    );
    expect(html).toContain('data-testid="route-error"');
    expect(html).toContain('data-testid="route-error-title"');
    expect(html).toContain("Something went wrong");
    expect(html).toContain('data-testid="route-error-message"');
    expect(html).toContain("Simulated DB outage");
    expect(html).toContain('data-testid="route-error-retry"');
    expect(html).toContain('data-error-digest="DIGEST_ABC"');
  });

  it("falls back to a generic message when the error has no message", () => {
    const html = renderToStaticMarkup(
      <RouteError error={new Error("")} reset={() => {}} />,
    );
    expect(html).toContain("Something went wrong while loading this page.");
  });
});
