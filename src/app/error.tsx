"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { TriangleAlertIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// UI-003: route-level error boundary. When a server component throws (DB
// outage, malformed payload, missing data) Next.js catches the error and
// renders this fallback in place of the segment. The boundary fires a
// `toast.error` with the message so the failure is surfaced to the
// reviewer the same way client-side fetch failures already are (see
// TriggerIngestionButton). The page never goes blank — the fallback
// card stays in the layout shell so navigation still works.
//
// In production Next.js obscures the original message coming from server
// components and only forwards a generic string + a digest. We surface
// whichever message the boundary receives plus the digest (when present)
// so support / logs can correlate the toast with a server-side trace.
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const displayMessage =
    error?.message && error.message.trim().length > 0
      ? error.message
      : "Something went wrong while loading this page.";

  useEffect(() => {
    toast.error(displayMessage, {
      id: error?.digest ?? "route-error",
      description: error?.digest
        ? `Reference: ${error.digest}`
        : undefined,
    });
  }, [displayMessage, error?.digest]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="route-error"
      data-error-digest={error?.digest ?? ""}
      className="flex flex-col items-start gap-4 rounded-lg border border-red-200 bg-red-50 p-6 text-sm shadow-sm dark:border-red-900 dark:bg-red-950/40"
    >
      <div className="flex items-center gap-3">
        <TriangleAlertIcon
          aria-hidden="true"
          className="size-5 text-red-600 dark:text-red-400"
        />
        <div className="space-y-1">
          <h2
            data-testid="route-error-title"
            className="font-heading text-lg font-semibold text-red-900 dark:text-red-100"
          >
            Something went wrong
          </h2>
          <p
            data-testid="route-error-message"
            className="text-red-800 dark:text-red-200"
          >
            {displayMessage}
          </p>
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        onClick={() => reset()}
        data-testid="route-error-retry"
      >
        Try again
      </Button>
    </div>
  );
}
