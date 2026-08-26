import {
  AreaSeries,
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type SeriesType,
  type UTCTimestamp
} from 'lightweight-charts';

type Row = { time: UTCTimestamp; open: number; high: number; low: number; close: number; volume: number | null };

const RANGES = [
  { label: '1M', days: 31 },
  { label: '6M', days: 186 },
  { label: '1Y', days: 366 },
  { label: '5Y', days: 1827 },
  { label: 'All', days: Infinity }
] as const;

type RangeLabel = (typeof RANGES)[number]['label'];

/** Beyond this many bars candlesticks stop being legible, so wide ranges switch to a line. */
const CANDLE_RANGES: RangeLabel[] = ['1M', '6M', '1Y'];
const DEFAULT_RANGE: RangeLabel = '6M';

function toTimestamp(isoDate: string): UTCTimestamp {
  return (Date.parse(`${isoDate}T00:00:00Z`) / 1000) as UTCTimestamp;
}

/**
 * Parses the dataset's CSVs with a plain splitter rather than a library.
 *
 * Safe only because these three schemas are fixed and contain no quoted fields: dates and numbers
 * only. The reference tables DO contain quoted commas, but they are never fetched at runtime, they
 * are baked into the manifest at build time by the quote-aware reader in scripts/lib/csv-store.ts.
 */
function parse(text: string, valueColumn: string): Row[] {
  const lines = text.trim().split('\n');
  const header = (lines[0] ?? '').trim().split(',');
  const at = (name: string) => header.indexOf(name);
  const iDate = at('published_date');
  const iValue = at(valueColumn);
  const iOpen = at('open');
  const iHigh = at('high');
  const iLow = at('low');
  const iVol = at('traded_quantity');

  const rows: Row[] = [];
  for (const line of lines.slice(1)) {
    const f = line.trim().split(',');
    const date = f[iDate];
    const raw = f[iValue];
    if (!date || !raw) continue;
    const close = Number(raw);
    if (!Number.isFinite(close)) continue;
    const vol = iVol >= 0 ? Number(f[iVol] ?? '') : NaN;
    rows.push({
      time: toTimestamp(date),
      open: iOpen >= 0 ? Number(f[iOpen] ?? raw) : close,
      high: iHigh >= 0 ? Number(f[iHigh] ?? raw) : close,
      low: iLow >= 0 ? Number(f[iLow] ?? raw) : close,
      close,
      volume: Number.isFinite(vol) ? vol : null
    });
  }
  return rows;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/**
 * Applies alpha to a design token's colour without assuming it is 6-digit hex.
 *
 * Custom properties are returned verbatim by getComputedStyle (unlike standard colour properties,
 * they are never normalised to rgb()), so tokens.css happening to use hex today does not guarantee
 * it stays hex tomorrow. String-concatenating a hex alpha suffix would silently produce an invalid
 * colour the moment the token becomes rgb()/hsl()/a named colour, and lightweight-charts's own
 * colour parser throws on anything it cannot resolve, so the bars would break rather than just look
 * wrong.
 *
 * `color-mix()` was tried first since it accepts any valid CSS colour syntax, but lightweight-charts
 * does not resolve it: it round-trips the colour through a hidden element's `style.color` and reads
 * `getComputedStyle(...).color` back, expecting an `rgb()`/`rgba()` string; in the headless Chromium
 * used to verify this (see task-4-report.md), that round-trip on a `color-mix()` input threw "Failed
 * to parse color" instead of serialising to `rgb()`. So this function does the same DOM round-trip
 * itself and builds the final `rgba()` string by hand, which the library's parser is guaranteed to
 * accept regardless of what CSS colour syntax the token holds.
 */
function withAlpha(color: string, percent: number): string {
  const probe = document.createElement('div');
  probe.style.color = color;
  document.body.appendChild(probe);
  const resolved = getComputedStyle(probe).color;
  document.body.removeChild(probe);
  const channels = resolved.match(/\d+(\.\d+)?/g);
  if (!channels) return color;
  const [r, g, b] = channels;
  return `rgba(${r}, ${g}, ${b}, ${percent / 100})`;
}

export function mountChart(root: HTMLElement): void {
  const csvUrl = root.dataset.csvUrl ?? '';
  const valueColumn = root.dataset.valueColumn ?? 'close';
  const canCandle = root.dataset.kind === 'ohlc';
  const hasVolume = root.dataset.hasVolume === 'true';
  const caption = root.querySelector<HTMLElement>('[data-chart-caption]');
  const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-range]'));
  const maybeContainer = root.querySelector<HTMLElement>('[data-chart-canvas]');
  const maybeStatus = root.querySelector<HTMLElement>('[data-chart-status]');
  if (!maybeContainer || !maybeStatus) return;
  // Narrowed once here; nested closures below (render/load) keep the non-null type through these.
  const container: HTMLElement = maybeContainer;
  const status: HTMLElement = maybeStatus;

  let chart: IChartApi | null = null;
  let rows: Row[] = [];
  let active: RangeLabel = DEFAULT_RANGE;
  // lightweight-charts 5.2.1's IChartApi has no `series()` accessor (confirmed by reading
  // dist/typings.d.ts), so the series created by the previous render must be tracked here and
  // removed explicitly rather than discovered from the chart itself.
  let activeSeries: ISeriesApi<SeriesType>[] = [];

  function render(): void {
    if (!chart || rows.length === 0) return;
    const range = RANGES.find(r => r.label === active) ?? RANGES[1];
    const cutoff = rows[rows.length - 1]!.time - range.days * 86400;
    const visible = range.days === Infinity ? rows : rows.filter(r => r.time >= cutoff);
    const useCandles = canCandle && CANDLE_RANGES.includes(active);

    for (const s of activeSeries) chart.removeSeries(s);
    activeSeries = [];

    if (useCandles) {
      // Bullish filled, bearish hollow: direction must survive greyscale and colourblindness, so
      // colour alone is never the only signal (design-system/nepal-market-data/MASTER.md, the green
      // rule and the anti-patterns list both call this out explicitly). downColor is transparent so
      // the bearish body renders hollow; borderDownColor and wickDownColor stay solid so the outline
      // and wick remain visibly red. Do not "tidy" this back to a symmetric downColor fill.
      const s = chart.addSeries(CandlestickSeries, {
        upColor: token('--primary'),
        downColor: 'transparent',
        borderUpColor: token('--primary'),
        borderDownColor: token('--destructive'),
        wickUpColor: token('--primary'),
        wickDownColor: token('--destructive')
      });
      s.setData(visible);
      activeSeries.push(s);
      if (hasVolume) {
        const v = chart.addSeries(HistogramSeries, { priceScaleId: '', priceFormat: { type: 'volume' } });
        v.setData(
          visible
            .filter(r => r.volume !== null)
            .map(r => ({
              time: r.time,
              value: r.volume as number,
              color: r.close >= r.open ? withAlpha(token('--primary'), 40) : withAlpha(token('--destructive'), 40)
            }))
        );
        v.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
        activeSeries.push(v);
      }
    } else {
      const s = chart.addSeries(AreaSeries, { lineColor: token('--primary'), topColor: 'transparent', bottomColor: 'transparent' });
      s.setData(visible.map(r => ({ time: r.time, value: r.close })));
      activeSeries.push(s);
    }

    chart.timeScale().fitContent();
    if (caption) {
      caption.textContent = useCandles
        ? `${visible.length} sessions, shown as candles.`
        : `${visible.length} sessions, shown as a closing-price line: this range holds more sessions than candles can show legibly.`;
    }
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.range === active));
  }

  async function load(): Promise<void> {
    try {
      const res = await fetch(csvUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      rows = parse(await res.text(), valueColumn);
      if (rows.length === 0) throw new Error('no rows');
      status.hidden = true;
      chart = createChart(container, {
        height: 420,
        layout: { background: { color: 'transparent' }, textColor: token('--muted-foreground') },
        grid: { vertLines: { color: token('--border') }, horzLines: { color: token('--border') } },
        rightPriceScale: { borderColor: token('--border') },
        timeScale: { borderColor: token('--border') }
      });

      // A range wider than the available history would render an identical view, so disable rather
      // than hide it: 42 symbols have fewer than 5 rows and one has a single row.
      const span = (rows[rows.length - 1]!.time - rows[0]!.time) / 86400;
      for (const b of buttons) {
        const r = RANGES.find(x => x.label === b.dataset.range);
        if (r && r.days !== Infinity && r.days > span) b.disabled = true;
      }
      if (RANGES.find(r => r.label === DEFAULT_RANGE)!.days > span) active = 'All';

      render();
      new ResizeObserver(() => chart?.applyOptions({ width: container.clientWidth })).observe(container);
    } catch (error) {
      // The prerendered latest numbers and the OHLC table are already on the page, so a failed
      // fetch degrades the chart only. The page is never blank.
      status.hidden = false;
      status.textContent = 'The chart could not load. The table below has the same data.';
      console.error(`Chart data failed for ${csvUrl}`, error);
    }
  }

  for (const b of buttons) {
    b.addEventListener('click', () => {
      if (b.disabled) return;
      active = (b.dataset.range as RangeLabel) ?? DEFAULT_RANGE;
      render();
    });
  }

  void load();
}

for (const el of document.querySelectorAll<HTMLElement>('[data-price-chart]')) mountChart(el);
