import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

// Farben wie style.css (--muted, --border), Schrift system-ui
const axisStyle = {
  stroke: '#5b6b72',
  font: '12px system-ui, -apple-system, sans-serif',
  labelFont: '600 12px system-ui, -apple-system, sans-serif',
  grid: { stroke: '#e3eaec', width: 1 },
  ticks: { stroke: '#d9e2e4' },
};
const height = 240;
const nullable = (a: number[]) => a.map((v) => (Number.isFinite(v) ? v : null));

export interface ChartSeries {
  label: string;
  stroke: string;
  dash?: number[];
  points?: boolean;
}

/** Liniendiagramm über der Speichennummer, eine Kurve je Eintrag in `series`. */
export function createRunoutChart(el: HTMLElement, spokes: number, unit: string, series: ChartSeries[], firstSpoke = 0) {
  const x = Array.from({ length: spokes }, (_, i) => i + firstSpoke);
  const plot = new uPlot(
    {
      width: el.clientWidth || 600,
      height,
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
      plot.setSize({ width: el.clientWidth || 600, height });
    },
  };
}
