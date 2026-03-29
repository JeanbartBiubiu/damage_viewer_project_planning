/**
 * SimChart — ECharts 折线图封装
 *
 * 从 ChartSeries[] 渲染 ECharts 折线图。
 * 使用动态 import 加载 echarts，首次加载会显示 loading。
 */

import { useEffect, useRef, useState } from 'react';
import { Spin, Typography } from '@arco-design/web-react';
import type { ChartSeries } from '../types';

type SimChartProps = {
  series: ChartSeries[];
  height?: number;
};

const PALETTE = ['#165dff', '#f53f3f', '#00b42a', '#f77234', '#722ed1', '#0fc6c2', '#eb2f96'];

// 缓存 echarts 模块
let echartsModule: any = null;
let echartsLoading = false;
let echartsError: string | null = null;
const waiters: Array<() => void> = [];

async function loadEcharts(): Promise<any> {
  if (echartsModule) return echartsModule;
  if (echartsError) return null;

  if (echartsLoading) {
    return new Promise<any>((resolve) => {
      waiters.push(() => resolve(echartsModule));
    });
  }

  echartsLoading = true;
  try {
    echartsModule = await import('echarts');
    echartsLoading = false;
    waiters.forEach((fn) => fn());
    waiters.length = 0;
    return echartsModule;
  } catch (err) {
    echartsError = err instanceof Error ? err.message : String(err);
    echartsLoading = false;
    waiters.forEach((fn) => fn());
    waiters.length = 0;
    return null;
  }
}

export function SimChart({ series, height = 320 }: SimChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const [ready, setReady] = useState(!!echartsModule);
  const [loadError, setLoadError] = useState<string | null>(echartsError);

  // 加载 echarts
  useEffect(() => {
    if (echartsModule) {
      setReady(true);
      return;
    }
    loadEcharts().then((mod) => {
      if (mod) {
        setReady(true);
      } else {
        setLoadError(echartsError ?? '加载 ECharts 失败');
      }
    });
  }, []);

  // 渲染图表
  useEffect(() => {
    if (!ready || !echartsModule || !containerRef.current) return;

    if (!chartRef.current) {
      chartRef.current = echartsModule.init(containerRef.current);
    }

    const option = {
      tooltip: { trigger: 'axis' },
      legend: { data: series.map((s) => s.name), bottom: 0 },
      grid: { top: 16, right: 24, bottom: 40, left: 56 },
      xAxis: { type: 'value', axisLabel: { fontSize: 11 } },
      yAxis: { type: 'value', axisLabel: { fontSize: 11 } },
      series: series.map((s, i) => ({
        name: s.name,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 2 },
        data: s.data.map((p) => [p.x, p.y]),
        color: s.color ?? PALETTE[i % PALETTE.length],
      })),
    };

    chartRef.current.setOption(option, true);
  }, [series, ready]);

  // 响应容器尺寸变化
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      chartRef.current?.resize();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 卸载时销毁
  useEffect(() => {
    return () => {
      chartRef.current?.dispose();
      chartRef.current = null;
    };
  }, []);

  if (series.length === 0) return null;

  if (loadError) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Typography.Text type="error" style={{ fontSize: 12 }}>
          {loadError}。请运行 npm i echarts 安装图表库。
        </Typography.Text>
      </div>
    );
  }

  if (!ready) {
    return (
      <div style={{ height, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Spin tip="加载图表库…" />
      </div>
    );
  }

  return <div ref={containerRef} style={{ width: '100%', height }} />;
}
