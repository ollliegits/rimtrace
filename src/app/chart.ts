import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const axisStyle = { stroke: '#9aa4b2', grid: { stroke: '#2a3340', width: 1 }, ticks: { stroke: '#2a3340' } };
const nullable = (a: number[]) => a.map((v) => (Number.isFinite(v) ? v : null));

export interface ChartSeries {
  label: string;
  stroke: string;
  dash?: number[];
  points?: boolean;
}

/** Liniendiagramm über der Speichennummer, eine Kurve je Eintrag in `series`. */
export function createRunoutChart(el: HTMLElement, spokes: number, unit: string, series: ChartSeries[]) {
  const x = Array.from({ length: spokes }, (_, i) => i);
  const plot = new uPlot(
    {
      width: el.clientWidth || 600,
      height: 220,
      legend: { show: true },
      scales: { x: { time: false } },
      axes: [
        { ...axisStyle, label: 'Speiche', incrs: [1, 2, 4] },
        { ...axisStyle, label: unit },
      ],
      series: [
        { label: 'Speiche', value: (_u, v) => (v == null ? '--' : String(v)) },
        ...series.map((s) => ({
          label: s.label,
          stroke: s.stroke,
          width: 2,
          dash: s.dash,
          points: s.points === false ? { show: false } : { size: 6 },
        })),
      ],
    },
    [x, ...series.map(() => [])] as unknown as uPlot.AlignedData,
    el,
  );
  return {
    spokes,
    count: series.length,
    update(data: number[][]) {
      plot.setData([x, ...data.map(nullable)] as uPlot.AlignedData);
    },
    resize() {
      plot.setSize({ width: el.clientWidth || 600, height: 220 });
    },
  };
}
