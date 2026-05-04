export default async function AlertDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="flex items-center justify-center h-64">
      <p className="text-muted-foreground text-lg">
        Alert Detail ({id}) — coming soon
      </p>
    </div>
  );
}
