export function getChartColors() {
  const style = getComputedStyle(document.documentElement);
  return {
    bg: style.getPropertyValue('--chart-bg').trim() || 'transparent',
    text: style.getPropertyValue('--chart-text').trim(),
    grid: style.getPropertyValue('--chart-grid').trim(),
    line: style.getPropertyValue('--chart-line').trim(),
    crosshairBorder: style.getPropertyValue('--chart-crosshair-border').trim(),
    tooltipBg: style.getPropertyValue('--chart-tooltip-bg').trim(),
    tooltipBorder: style.getPropertyValue('--chart-tooltip-border').trim(),
    tooltipText: style.getPropertyValue('--chart-tooltip-text').trim(),
  };
}
