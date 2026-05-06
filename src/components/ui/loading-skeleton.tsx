type SkeletonProps = {
  className?: string;
  testId?: string;
};

export function Skeleton({ className = "", testId }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      data-testid={testId}
      className={`animate-pulse rounded-md bg-muted/70 ${className}`.trim()}
    />
  );
}
