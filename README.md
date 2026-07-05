# 한컴 매체 통합 광고 성과 대시보드 (서버리스)

서버·DB·월 비용 없이 동작하는 대시보드입니다.
ADX 데이터는 GitHub Actions가 **하루 1회 자동 수집**해 `data/data.json`에 쌓고,
`dashboard.html`은 그 파일을 읽어 차트·지표를 그립니다. 모비위드 정산서는 화면에서 직접 업로드합니다.

## 구성

```
hancom-dashboard-static/
├── dashboard.html              대시보드 본체 (이 파일 하나로 동작)
├── data/
│   └── data.json               누적 광고 데이터 (Actions가 갱신)
├── scripts/
│   └── collect.mjs             ADX 수집 스크립트
└── .github/workflows/
    └── collect.yml             매일 자동 수집 설정
```

## 어떻게 쓰나

### 가장 빠르게 — 지금 당장 보기
`dashboard.html`을 더블클릭하면 브라우저에서 열립니다.
모비위드 정산서(.xlsx)를 하단 업로더에 끌어다 놓으면 즉시 반영됩니다.
(이 방식만으로도 모비위드 데이터는 충분히 활용 가능합니다.)

> 단, 더블클릭으로 연 경우 브라우저 보안정책상 `data.json` 자동 로드가 막힐 수 있습니다.
> ADX 데이터까지 보려면 아래 GitHub Pages 방식을 권장합니다.

### 자동 수집 + 공유 — GitHub Pages (무료)

**1. 저장소 만들기**
이 폴더를 GitHub 저장소에 올립니다.
```bash
cd hancom-dashboard-static
git init
git add .
git commit -m "정적 광고 대시보드"
git branch -M main
git remote add origin https://github.com/<본인계정>/hancom-dashboard-static.git
git push -u origin main
```

**2. API 키를 Secrets에 등록** (코드에 키를 넣지 않기 위함)
저장소 → Settings → Secrets and variables → Actions → New repository secret 에서 추가:
- `ADX_API_KEY` — AD(X) 발급 키
- `ADX_COMPANY_ID` — AD(X) 회사 ID
- (선택) `ADX_BASE_URL`, `FX_API_URL`, `FX_FALLBACK_RATE`

**3. 자동 수집 켜기**
저장소 → Actions 탭에서 워크플로를 활성화합니다.
- 매일 한국시간 새벽 2시에 자동 실행됩니다.
- 지금 바로 받고 싶으면 Actions → "ADX 일일 수집" → Run workflow (날짜 입력 가능).
- 실행되면 `data/data.json`이 갱신·커밋됩니다.

**4. 페이지 공개**
저장소 → Settings → Pages → Source를 `main` 브랜치로 지정.
잠시 후 `https://<본인계정>.github.io/hancom-dashboard-static/dashboard.html` 주소가 생깁니다.
이 주소를 팀에 공유하면 누구나 최신 데이터를 봅니다.

### 내 PC에서 수동 수집 (Actions 없이)
```bash
export ADX_API_KEY=발급키
export ADX_COMPANY_ID=회사ID
node scripts/collect.mjs            # 어제 데이터
node scripts/collect.mjs 2026-06-26 # 특정 날짜
```
`data/data.json`이 갱신됩니다.

## 분석 기능 (전문가용)

매출 숫자만 보여주는 것을 넘어, '왜 이렇게 됐는지'를 자동으로 분석합니다.

**수익화 지표** — 매출·노출 외에 eCPM(노출 1000회당 수익), Fill Rate(요청 대비 충전율), CTR을 전월 대비와 함께 표시합니다. eCPM은 매출 하락이 '노출 감소'인지 '단가 하락'인지 구분해주는 핵심 지표입니다.

**매출 폭포수 분해** — 전월→이번달 매출 변동을 '노출 요인'과 '단가(eCPM) 요인'으로 쪼개서 보여줍니다. 예를 들어 노출은 늘었는데 매출이 제자리면, 단가가 떨어진 것이므로 조치 방향이 명확해집니다.

**기여도 분석** — 이번달 매출 변동을 어느 채널·앱·지면이 만들었는지 변동액 순으로 자동 정렬합니다. 표를 눈으로 훑지 않아도 원인 지면을 바로 찾습니다.

**적응형 이상 감지** — 각 지면의 과거 6개월 평균·표준편차를 기준으로 평소와 다른 움직임(2.5σ 이상)을 감지합니다. 고정 임계치(±30%)보다 오탐이 적어, 원래 들쭉날쭉한 지면과 안정적인 지면을 구분해 판단합니다.

**앱·지면별 상세표** — 채널·앱·OS별로 매출·전월비·eCPM·Fill·노출·클릭을 한눈에 비교합니다.

이 모든 계산은 브라우저 안에서 이뤄지므로 서버·비용이 필요 없습니다. 원인을 단정하지 않고 '어디를 봐야 하는지'를 좁혀주는 용도입니다.

## 동작 원리 요약
| 데이터 | 수집 방식 | 갱신 주기 |
|--------|-----------|-----------|
| ADX | GitHub Actions 자동 (키는 Secrets에 숨김) | 하루 1회 |
| 모비위드 | 화면에서 엑셀 업로드 | 즉시 |
| 환율 | 수집 시 공개 API 조회 (실패 시 fallback) | 수집 시점 |

## 한계 (이 방식의 트레이드오프)

- ADX는 **실시간이 아니라 하루 1회** 갱신입니다. 즉시 최신이 필요하면 상시 서버 방식이 필요합니다.
- 모비위드 업로드분은 브라우저 메모리에만 있어, 새로고침하면 사라집니다.
  매번 같은 파일을 올리거나, 영구 저장이 필요하면 별도 처리가 필요합니다.
- ADX API는 보안상 브라우저에서 직접 호출할 수 없어(키 노출·CORS), 수집을 Actions가 대신합니다.

## 비용
GitHub Actions(비공개 저장소 월 2,000분 무료, 이 작업은 1회 1~2분)와
GitHub Pages(무료) 범위 안에서 동작하므로 **사실상 0원**입니다.
