/**
 * ADX 수집 → data/data.json 갱신
 *
 * 실행: 환경변수 ADX_API_KEY, ADX_COMPANY_ID 필요.
 *   node scripts/collect.mjs            # 어제 날짜 수집
 *   node scripts/collect.mjs 2026-06-26 # 특정 날짜 수집
 *
 * - API 키는 환경변수로만 받음 (코드·결과물에 절대 미포함)
 * - 기존 data.json을 읽어 같은 키(date+media+app+os)는 갱신, 신규는 추가
 * - 환율은 공개 API 조회 후 실패 시 fallback
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_PATH = path.join(process.cwd(), 'data', 'data.json');
const FALLBACK_RATE = parseFloat(process.env.FX_FALLBACK_RATE || '1350');
const FX_API_URL = process.env.FX_API_URL || ''; // 예: https://api.exchangerate.host

const ADX_API_KEY = process.env.ADX_API_KEY;
const ADX_COMPANY_ID = process.env.ADX_COMPANY_ID;
const ADX_BASE_URL = process.env.ADX_BASE_URL || 'https://report.adxcorp.kr/api/v2.3';

function yesterday() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}
const toInt = (v) => { const n = parseInt(v ?? 0, 10); return Number.isFinite(n) ? n : 0; };
const toFloat = (v) => { const n = parseFloat(v ?? 0); return Number.isFinite(n) ? n : 0; };
const keyOf = (r) => `${r.report_date}|${r.media_source}|${r.app_name}|${r.os_type}`;

async function getRate(dateStr) {
  if (!FX_API_URL) return FALLBACK_RATE;
  try {
    const res = await fetch(`${FX_API_URL}/${dateStr}?base=USD&symbols=KRW`);
    const j = await res.json();
    const r = j?.rates?.KRW;
    return (r && Number.isFinite(r)) ? r : FALLBACK_RATE;
  } catch {
    return FALLBACK_RATE;
  }
}

async function loadExisting() {
  try {
    const txt = await fs.readFile(DATA_PATH, 'utf-8');
    const j = JSON.parse(txt);
    return Array.isArray(j.rows) ? j.rows : [];
  } catch {
    return [];
  }
}

async function collect(targetDate) {
  if (!ADX_API_KEY || !ADX_COMPANY_ID) {
    throw new Error('환경변수 ADX_API_KEY / ADX_COMPANY_ID 가 필요합니다.');
  }

  const url = new URL(`${ADX_BASE_URL}/report`);
  url.searchParams.set('companyId', ADX_COMPANY_ID);
  url.searchParams.set('fromDate', targetDate);
  url.searchParams.set('toDate', targetDate);

  const res = await fetch(url, { headers: { Authorization: ADX_API_KEY } });
  const data = await res.json();
  if (!data || data.code !== 200) {
    throw new Error(`ADX 응답 비정상: code=${data?.code}`);
  }

  const rate = await getRate(targetDate);
  const newRows = (data.data || []).map((item) => {
    const revenueUsd = toFloat(item.revenue);
    return {
      report_date: item.date || targetDate,
      media_source: 'ADX',
      app_name: item.app,
      os_type: item.osType,
      bundle_id: item.identifier,
      request_count: toInt(item.request),
      attempt_count: toInt(item.attempt),
      fill_count: toInt(item.fill),
      impression_count: toInt(item.impression),
      click_count: toInt(item.click),
      revenue_usd: revenueUsd,
      net_revenue_usd: toFloat(item.netRevenue),
      revenue_krw: Math.round(revenueUsd * rate),
    };
  });

  // 병합: 기존 + 신규 (같은 키는 신규로 덮어씀)
  const existing = await loadExisting();
  const map = new Map(existing.map((r) => [keyOf(r), r]));
  for (const r of newRows) map.set(keyOf(r), r);

  const merged = [...map.values()].sort((a, b) =>
    a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : 0);

  await fs.mkdir(path.dirname(DATA_PATH), { recursive: true });
  await fs.writeFile(DATA_PATH, JSON.stringify({
    updated_at: new Date().toISOString(),
    rows: merged,
  }, null, 2));

  console.log(`[collect] ${targetDate}: ADX ${newRows.length}건 수집, 총 ${merged.length}행 (환율 ${rate})`);
}

const target = process.argv[2] || yesterday();
collect(target).catch((err) => {
  console.error('[collect] 실패:', err.message);
  process.exit(1);
});
