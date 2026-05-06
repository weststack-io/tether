"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2Icon, PlayIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Polls /api/ingestion/log and resolves when the run with `runId` is no
// longer in 'running' state. Falls back to a timeout so we never hang
// forever if the orchestrator silently dies (the toast still surfaces a
// non-success outcome).
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

type LogRun = {
  id: string;
  status: string;
  itemsProcessed: number | null;
  itemsFlagged: number | null;
  itemsSuppressed: number | null;
};

type LogResponse = {
  runs: LogRun[];
};

async function fetchRun(runId: string): Promise<LogRun | null> {
  // pageSize=50 covers the common case where a manual trigger sits within
  // the most-recent runs; if a deployment is processing >50 concurrent
  // runs we'll widen the window, but for a demo this is plenty.
  const res = await fetch(`/api/ingestion/log?pageSize=50`, {
    cache: "no-store",
  });
  if (!res.ok) return null;
  const body = (await res.json()) as LogResponse;
  return body.runs.find((r) => r.id === runId) ?? null;
}

export function TriggerIngestionButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const handleClick = useCallback(async () => {
    if (pending) return;
    setPending(true);

    let runId: string | null = null;
    const startToastId = toast.loading("Starting ingestion run…");

    try {
      const res = await fetch("/api/ingestion/trigger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          `Trigger failed: HTTP ${res.status}${text ? ` ${text}` : ""}`,
        );
      }
      const body = (await res.json()) as { runId: string; status: string };
      runId = body.runId;
      toast.loading(`Ingestion run ${runId.slice(0, 8)}… in progress`, {
        id: startToastId,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(message, { id: startToastId });
      setPending(false);
      return;
    }

    const startedAt = Date.now();
    const id = runId;
    while (!cancelledRef.current) {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        toast.warning(
          "Ingestion run is taking longer than expected; check the activity log.",
          { id: startToastId },
        );
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      if (cancelledRef.current) break;

      const run = await fetchRun(id);
      if (run && run.status !== "running") {
        if (run.status === "completed") {
          const flagged = run.itemsFlagged ?? 0;
          const processed = run.itemsProcessed ?? 0;
          toast.success(
            `Ingestion run completed: ${processed} processed, ${flagged} flagged`,
            { id: startToastId },
          );
        } else {
          toast.error(`Ingestion run ended with status: ${run.status}`, {
            id: startToastId,
          });
        }
        // Refresh the server component so severity counts pick up any
        // newly-created alerts.
        router.refresh();
        break;
      }
    }

    setPending(false);
  }, [pending, router]);

  return (
    <Button
      type="button"
      variant="default"
      onClick={handleClick}
      disabled={pending}
      data-testid="trigger-ingestion-button"
      data-pending={pending ? "true" : "false"}
    >
      {pending ? (
        <>
          <Loader2Icon className="animate-spin" data-icon="inline-start" />
          Running…
        </>
      ) : (
        <>
          <PlayIcon data-icon="inline-start" />
          Trigger Ingestion
        </>
      )}
    </Button>
  );
}
