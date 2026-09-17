"use client";
import { useEffect, useRef } from "react";
import {
  CandlestickSeries,
  ColorType,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type LogicalRange,
  type UTCTimestamp,
} from "lightweight-charts";
import {
  calculateEMA,
  calculateSMA,
  calculateVWAP,
  type Candle,
} from "@/lib/simulator";
export type Overlay = "sma" | "ema" | "vwap";
const time = (value: number) => value as UTCTimestamp;
export function MarketChart({
  candles,
  overlays,
  horizontalLine,
  onLoadOlder,
}: {
  candles: Candle[];
  overlays: Overlay[];
  horizontalLine?: number;
  onLoadOlder: () => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candleSeries = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeSeries = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef<ISeriesApi<"Line">[]>([]);
  const range = useRef<LogicalRange | null>(null);
  const loading = useRef(false);
  const loadOlder = useRef(onLoadOlder);
  useEffect(() => {
    loadOlder.current = onLoadOlder;
  }, [onLoadOlder]);
  useEffect(() => {
    if (!container.current) return;
    const instance = createChart(container.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#090d14" },
        textColor: "#8c98ab",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: "#18202c" },
        horzLines: { color: "#18202c" },
      },
      rightPriceScale: { borderColor: "#263041" },
      timeScale: {
        borderColor: "#263041",
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        vertLine: { color: "#7182ff66" },
        horzLine: { color: "#7182ff66" },
      },
    });
    const series = instance.addSeries(CandlestickSeries, {
      upColor: "#2bbf88",
      downColor: "#ef5d6f",
      borderVisible: false,
      wickUpColor: "#2bbf88",
      wickDownColor: "#ef5d6f",
    });
    const volume = instance.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "",
    });
    volume
      .priceScale()
      .applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const visible = (next: LogicalRange | null) => {
      range.current = next;
      if (next && next.from < 15 && !loading.current) {
        loading.current = true;
        loadOlder.current();
        setTimeout(() => {
          loading.current = false;
        }, 800);
      }
    };
    instance.timeScale().subscribeVisibleLogicalRangeChange(visible);
    chart.current = instance;
    candleSeries.current = series;
    volumeSeries.current = volume;
    return () => {
      instance.timeScale().unsubscribeVisibleLogicalRangeChange(visible);
      lines.current = [];
      candleSeries.current = null;
      volumeSeries.current = null;
      range.current = null;
      instance.remove();
      chart.current = null;
    };
  }, []);
  useEffect(() => {
    if (!chart.current || !candleSeries.current) return;
    const oldRange = range.current;
    candleSeries.current.setData(
      candles.map((item) => ({
        time: time(item.time),
        open: Number(item.open),
        high: Number(item.high),
        low: Number(item.low),
        close: Number(item.close),
      })),
    );
    volumeSeries.current?.setData(
      candles.map((item) => ({
        time: time(item.time),
        value: Number(item.volume),
        color:
          Number(item.close) >= Number(item.open) ? "#2bbf8844" : "#ef5d6f44",
      })),
    );
    lines.current.forEach((line) => chart.current?.removeSeries(line));
    lines.current = [];
    const add = (points: { time: number; value: number }[], color: string) => {
      const line = chart.current!.addSeries(LineSeries, {
        color,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      });
      line.setData(
        points.map((point) => ({ time: time(point.time), value: point.value })),
      );
      lines.current.push(line);
    };
    if (overlays.includes("sma")) add(calculateSMA(candles, 20), "#f5bf62");
    if (overlays.includes("ema")) add(calculateEMA(candles, 20), "#b886f8");
    if (overlays.includes("vwap")) add(calculateVWAP(candles), "#55b8e8");
    if (horizontalLine !== undefined)
      candleSeries.current.createPriceLine({
        price: horizontalLine,
        color: "#9da7ff",
        lineWidth: 1,
        axisLabelVisible: true,
        title: "H",
      });
    if (oldRange) chart.current.timeScale().setVisibleLogicalRange(oldRange);
    else chart.current.timeScale().fitContent();
  }, [candles, overlays, horizontalLine]);
  return (
    <div
      ref={container}
      className="market-chart"
      aria-label="Interactive market chart"
    />
  );
}
