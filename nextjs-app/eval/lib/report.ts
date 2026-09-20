import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GateResult, ReportRow } from './types';

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** eval/reports/<release>.csv — exactly the PRD's columns (spec 17 §3). */
export function writeCsv(release: string, rows: ReportRow[]): string {
  const header = [
    'Contract_ID', 'Contract_Type', 'Term_Name', 'Expected_Value', 'AI_Extracted_Value',
    'Expected_Page', 'AI_Page', 'Confidence_Score', 'F1_Match', 'Expert_Rating', 'Notes',
    'Prompt_Version',
  ];
  const body = rows.map((row) => header.map((h) => csvCell(row[h as keyof ReportRow])).join(','));
  const path = resolve(process.cwd(), 'eval/reports', `${release}.csv`);
  mkdirSync(resolve(process.cwd(), 'eval/reports'), { recursive: true });
  writeFileSync(path, [header.join(','), ...body].join('\n') + '\n');
  return path;
}

export function writeSummary(release: string, summary: unknown): string {
  const path = resolve(process.cwd(), 'eval/reports', `${release}.summary.json`);
  mkdirSync(resolve(process.cwd(), 'eval/reports'), { recursive: true });
  writeFileSync(path, JSON.stringify(summary, null, 2) + '\n');
  return path;
}

export function gate(
  name: string,
  metric: string,
  value: number | null,
  threshold: number,
  comparison: 'gte' | 'lte',
): GateResult {
  const passed =
    value === null ? null : comparison === 'gte' ? value >= threshold : value <= threshold;
  return { gate: name, metric, value, threshold, comparison, passed };
}

export function formatGate(result: GateResult): string {
  const symbol = result.passed === null ? '—' : result.passed ? 'PASS' : 'FAIL';
  const value =
    result.value === null
      ? 'no data'
      : result.metric.includes('ms')
        ? `${Math.round(result.value)}ms`
        : `${(result.value * 100).toFixed(1)}%`;
  const bound = result.metric.includes('ms')
    ? `${result.threshold}ms`
    : `${(result.threshold * 100).toFixed(0)}%`;
  const direction = result.comparison === 'gte' ? '≥' : '≤';
  return `  ${symbol.padEnd(4)}  ${result.gate.padEnd(34)} ${value.padStart(9)}  (target ${direction} ${bound})`;
}
