type StatCardProps = {
  label: string;
  value: string;
  hint: string;
};

export function StatCard({ label, value, hint }: StatCardProps) {
  return (
    <article className="panel p-5">
      <div className="text-xs font-medium text-[#71819B]">{label}</div>
      <div className="mt-2.5 text-[28px] font-bold tracking-[-0.03em] text-[#17243A]">{value}</div>
      <div className="mt-2 text-xs text-[#8190A5]">{hint}</div>
    </article>
  );
}
