export function Header() {
  return (
    <header className="sticky top-0 z-10 border-b bg-background px-6 py-3 flex items-center gap-4">
      <h1 className="text-lg font-semibold">Tether</h1>
      <span className="text-sm text-muted-foreground">Regulatory Drift Detector</span>
    </header>
  );
}
