"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

type MetricLineChartProps = {
  data: Array<Record<string, string | number>>;
  labelKey: string;
  valueKey: string;
  color?: string;
  height?: number;
};

export function MetricLineChart({ data, labelKey, valueKey, color = "#20352e", height = 280 }: MetricLineChartProps) {
  if (!data.length) {
    return <div className="flex h-[280px] items-center justify-center rounded-[1rem] border border-ink/10 bg-white/60 text-sm text-ink/55">Sem dados suficientes para o grafico.</div>;
  }

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 12, right: 12, left: -24, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="rgba(28,42,40,0.08)" />
          <XAxis dataKey={labelKey} tick={{ fill: "#49613d", fontSize: 12 }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fill: "#66736f", fontSize: 12 }} axisLine={false} tickLine={false} />
          <Tooltip cursor={{ stroke: "rgba(73,97,61,0.2)", strokeWidth: 1 }} />
          <Line type="monotone" dataKey={valueKey} stroke={color} strokeWidth={3} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}