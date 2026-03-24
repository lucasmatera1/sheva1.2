type StatCardProps = {
  label: string;
  value: string;
  help: string;
};

export function StatCard({ label, value, help }: StatCardProps) {
  return (
    <div className="rounded-[1.75rem] border border-ink/10 bg-white/82 p-5 shadow-panel backdrop-blur">
      <p className="text-xs uppercase tracking-[0.3em] text-brand-strong">{label}</p>
      <p className="mt-3 text-3xl font-semibold text-ink">{value}</p>
      <p className="mt-2 text-sm text-ink/65">{help}</p>
    </div>
  );
}