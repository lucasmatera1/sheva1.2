"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MetricBarChartProps = {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: string;
  height?: number;
};

export function MetricBarChart({ data, labelKey, valueKey, color = "#49613d", height = 260 }: MetricBarChartProps) {
  if (!data.length) {
    return <div className="flex h-[260px] items-center justify-center rounded-[1rem] border border-ink/10 bg-white/60 text-sm text-ink/55">Sem dados suficientes para o grafico.</div>;
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(28,42,40,0.08)" />
          <XAxis dataKey={labelKey} tick={{ fill: "#49613d", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#66736f", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ fill: "rgba(185,212,139,0.18)" }} />
          <Bar dataKey={valueKey} radius={[10, 10, 0, 0]}>
            {data.map((entry, index) => (
              <Cell key={`${String(entry[labelKey])}-${index}`} fill={color} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}