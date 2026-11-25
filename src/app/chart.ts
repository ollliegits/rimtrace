import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

const axisStyle = { stroke: '#9aa4b2', grid: { stroke: '#2a3340', width: 1 }, ticks: { stroke: '#2a3340' } };
const nullable = (a: number[]) => a.map((v) => (Number.isFinite(v) ? v : null));

/** Liniendiagramm über der Speichennummer: Messwert gegen Ground Truth. */
export function createRunoutChart(el: HTMLElement, spokes: number, unit: string) {
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
        { label: 'Messwert', stroke: '#4cc2ff', width: 2, points: { size: 6 } },
        { label: 'Ground Truth', stroke: '#9aa4b2', width: 2, dash: [6, 4], points: { show: false } },
      ],
    },
    [x, [], []] as unknown as uPlot.AlignedData,
    el,
  );
  return {
    spokes,
    update(measured: number[], truth: number[]) {
      plot.setData([x, nullable(measured), nullable(truth)] as uPlot.AlignedData);
    },
    resize() {
      plot.setSize({ width: el.clientWidth || 600, height: 220 });
    },
  };
}
