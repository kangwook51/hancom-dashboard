/**
 * 광고 성과 분석 엔진
 * 순수 함수 모음 — 브라우저/Node 양쪽에서 동작.
 * 입력 행(row) 스키마:
 *   { report_date, media_source, app_name, os_type,
 *     request_count, fill_count, impression_count, click_count, revenue_krw }
 */

const round = (n, d = 0) => {
  const f = Math.pow(10, d);
  return Math.round((Number(n) || 0) * f) / f;
};

// ── 파생 지표 ───────────────────────────────────────────────
// eCPM = 노출 1000회당 매출 (원). 광고 단가의 핵심 척도.
function eCPM(revenue, impressions) {
  return impressions > 0 ? (revenue / impressions) * 1000 : 0;
}
// Fill Rate = 충전/요청 (%). 광고 재고 확보율.
function fillRate(fill, request) {
  return request > 0 ? (fill / request) * 100 : null;
}
// Show Rate = 노출/충전 (%). 충전된 광고가 실제 노출된 비율.
function showRate(impressions, fill) {
  return fill > 0 ? (impressions / fill) * 100 : null;
}

const YM = (d) => String(d).slice(0, 7); // 'YYYY-MM'

// 특정 월/필터의 지표 합계 + 파생지표
function aggregate(rows, ym, { media, app, os } = {}) {
  const f = rows.filter((r) =>
    YM(r.report_date) === ym &&
    (!media || media === 'All' || r.media_source === media) &&
    (!app || r.app_name === app) &&
    (!os || r.os_type === os));

  const sum = (k) => f.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const revenue = sum('revenue_krw');
  const impressions = sum('impression_count');
  const clicks = sum('click_count');
  const request = sum('request_count');
  const fill = sum('fill_count');

  return {
    revenue, impressions, clicks, request, fill,
    ctr: impressions > 0 ? round((clicks / impressions) * 100, 2) : 0,
    ecpm: round(eCPM(revenue, impressions), 0),
    fillRate: fillRate(fill, request) === null ? null : round(fillRate(fill, request), 1),
    showRate: showRate(impressions, fill) === null ? null : round(showRate(impressions, fill), 1),
  };
}

// ── 기여도 분해 ─────────────────────────────────────────────
// 이번 달 vs 저번 달, 각 (채널·앱·OS) 조합의 매출 변동액을 계산해
// 절대 기여액 큰 순으로 정렬. 전체 변동에서 각자 몇 %를 차지하는지 포함.
function contribution(rows, curYm, prevYm) {
  const key = (r) => `${r.media_source}||${r.app_name}||${r.os_type}`;
  const agg = (ym) => {
    const m = new Map();
    rows.filter((r) => YM(r.report_date) === ym).forEach((r) => {
      m.set(key(r), (m.get(key(r)) || 0) + (Number(r.revenue_krw) || 0));
    });
    return m;
  };
  const cur = agg(curYm), prev = agg(prevYm);
  const keys = new Set([...cur.keys(), ...prev.keys()]);

  const totalDelta = [...keys].reduce((s, k) => s + ((cur.get(k) || 0) - (prev.get(k) || 0)), 0);

  const items = [...keys].map((k) => {
    const [media, app, os] = k.split('||');
    const c = cur.get(k) || 0, p = prev.get(k) || 0;
    const delta = c - p;
    return {
      media, app, os, current: c, prev: p, delta,
      pctOfTotal: totalDelta !== 0 ? round((delta / totalDelta) * 100, 0) : 0,
    };
  }).filter((i) => i.delta !== 0)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

  return { totalDelta, items };
}

// ── 매출 폭포수 분해 ────────────────────────────────────────
// 매출 = 노출 × (eCPM/1000). 매출 변동을 '노출 요인'과 '단가(eCPM) 요인'으로 분리.
// ΔRev ≈ (Δ노출 × 이전eCPM/1000) + (Δecpm × 현재노출/1000)
function revenueWaterfall(cur, prev) {
  const prevRev = prev.revenue;
  const impEffect = ((cur.impressions - prev.impressions) * prev.ecpm) / 1000;
  const ecpmEffect = ((cur.ecpm - prev.ecpm) * cur.impressions) / 1000;
  return {
    prevRevenue: round(prevRev, 0),
    impressionEffect: round(impEffect, 0), // 노출 변화 기여
    ecpmEffect: round(ecpmEffect, 0),      // 단가 변화 기여
    curRevenue: round(cur.revenue, 0),
    // 상호작용항 등으로 미세 오차 발생 가능 → 잔차로 흡수
    residual: round(cur.revenue - prevRev - impEffect - ecpmEffect, 0),
  };
}

// ── 적응형 이상 감지 ────────────────────────────────────────
// 각 (채널·앱·OS) 지면의 과거 N개월 매출로 평균·표준편차를 구하고,
// 이번 달이 평균에서 몇 표준편차(z) 떨어졌는지로 이상 판정.
// 고정 임계치보다 오탐이 적음. 데이터가 적으면(<3개월) 판정 보류.
function adaptiveAnomalies(rows, curYm, lookback = 6) {
  const months = [...new Set(rows.map((r) => YM(r.report_date)))].sort();
  const idx = months.indexOf(curYm);
  if (idx < 0) return [];
  const hist = months.slice(Math.max(0, idx - lookback), idx); // 현재월 제외 과거

  const key = (r) => `${r.media_source}||${r.app_name}||${r.os_type}`;
  const revByKeyMonth = new Map(); // key -> {ym: rev}
  rows.forEach((r) => {
    const k = key(r);
    if (!revByKeyMonth.has(k)) revByKeyMonth.set(k, {});
    const o = revByKeyMonth.get(k);
    o[YM(r.report_date)] = (o[YM(r.report_date)] || 0) + (Number(r.revenue_krw) || 0);
  });

  const out = [];
  for (const [k, byMonth] of revByKeyMonth) {
    const histVals = hist.map((m) => byMonth[m] || 0).filter((_, i) => hist[i] in byMonth);
    if (histVals.length < 3) continue; // 표본 부족 → 판정 보류
    const mean = histVals.reduce((a, b) => a + b, 0) / histVals.length;
    const variance = histVals.reduce((a, b) => a + (b - mean) ** 2, 0) / histVals.length;
    const sd = Math.sqrt(variance);
    const cur = byMonth[curYm] || 0;
    if (sd === 0) continue;
    const z = (cur - mean) / sd;
    if (Math.abs(z) >= 2.5) { // 2.5σ 이상 벗어남 (완만한 추세는 제외)
      const [media, app, os] = k.split('||');
      out.push({
        media, app, os, current: round(cur, 0), mean: round(mean, 0),
        z: round(z, 1), direction: z < 0 ? 'drop' : 'spike',
      });
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

const engine = { round, eCPM, fillRate, showRate, aggregate, contribution, revenueWaterfall, adaptiveAnomalies, YM };
if (typeof module !== 'undefined') module.exports = engine;
