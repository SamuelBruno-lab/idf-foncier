"use client";

type KpiItem = {
  label: string;
  value: string;
};

type Props = {
  items: KpiItem[];
};

export default function FoncierKpiBanner({ items }: Props) {
  if (items.length === 0) return null;

  return (
    <div className="grid grid-cols-3 gap-2 rounded-xl bg-neutral-900 px-3 py-2.5 text-white">
      {items.map((kpi) => (
        <div key={kpi.label} className="text-center">
          <div className="text-base font-bold tabular-nums">{kpi.value}</div>
          <div className="text-[10px] uppercase tracking-wide text-neutral-400">
            {kpi.label}
          </div>
        </div>
      ))}
    </div>
  );
}
