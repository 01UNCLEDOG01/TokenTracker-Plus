<div align="center">
  <img src="./dashboard/public/app-icon.png" width="96" height="96" alt="TokenTracker Plus Logo" />
  <h1>TokenTracker Plus (TT-plus)</h1>
  <p><strong>55개 AI 코딩 도구와 IDE에서 실제 토큰 비용, 세션 구조, 실시간 생성 속도를 추적</strong></p>
  <p>
    <a href="./README.md">简体中文</a> · <a href="./README.zh-TW.md">繁體中文</a> · <a href="./README.en.md">English</a> · <a href="./README.ja.md">日本語</a> · <b>한국어</b> · <a href="./README.pt-BR.md">Português (BR)</a>
  </p>
</div>

> 💡 이 저장소는 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)(MIT)를 기반으로 확장한 포크입니다. **100% 로컬 우선**, **정가 기준 과금**, **세션 계층 분석**, **실시간 tok/s 측정**이 목표입니다. 원본의 저작권은 원 작성자에게 있으며, 이 포크 역시 MIT로 공개됩니다.

[✨ 주요 기능](#-주요-기능) · [⚡ 빠른 시작](#-빠른-시작) · [💰 과금과 히트맵](#-과금과-히트맵) · [🔒 프라이버시](#-프라이버시) · [📜 사용 가이드](./docs/getting-started.zh-CN.md) · [❤️ 지원하기](./SPONSOR.md)

## ✨ 주요 기능

- 🔌 **55개 도구 자동 연결(설정 불필요)** —— Claude Code / Codex / Cursor / Qoder / Kimi 등 55개 AI 코딩 도구의 로컬 로그를 자동 감지. 로그인·API 키·클라우드 불필요.
- 💰 **무료 모델도 정가로 계상** —— 업스트림의 `-free` → 0원 규칙을 거부하고, 무료 라우트도 공식 정가로 평가. 공짜로 쓴 가치를 한눈에 확인.
- ⚡ **밀리초 단위 tok/s 스트림** —— 청크별 지속 시간과 추론 토큰을 분리해 세션 단위 생성 속도를 정확히 측정.
- 🌲 **세션 계층 분석** —— 메인 세션 / 서브에이전트 / 도구 호출 단위로 비용이 큰 작업을 추적.
- 📊 **Lv0~Lv7 8단계 히트맵** —— 하루 30억 토큰 초과의 '특이점(Singularity)' 단계 포함. 2D/3D 동시 지원.
- 🏆 **업적 65종 + 칭호 17종 완전 오프라인 판정** —— Steam 스타일 토스트, 3D 메달, Canvas 전투 보고서 내보내기.
- 🪟 **Windows 데스크톱 통합** —— 트레이 상주, 펫, 쿼터 위젯. 설치 프로그램에 Node 동봉(빌드 불필요).
- 🌍 **글로벌 모델 보드(설정 불필요)** — Artificial Analysis 공식 리더보드를 직접 가져옵니다: 80+ 모델의 지능 점수, 입력/출력/캐시 가격, 컨텍스트, 출력 속도. API 키 불필요, 로컬 캐시 자동 갱신.
- 🎁 **프로바이더 특전 가이드** — 무료 활용이 가능한 32개 AI 서비스 총정리: 신규 가입 적립금·매일 무료·장기 유효 터·출석 특전가 카테고리/검색으로 정리되고, 각 카드에 초대 링크와 공식 링크를 함께 제공합니다.
- 🔒 **100% 로컬** —— 기록하는 것은 수치뿐. 코드와 프롬프트는 저장·전송되지 않습니다.

## ⚡ 빠른 시작

**Windows는 빌드 불필요**: [Releases](https://github.com/01UNCLEDOG01/TokenTracker-plus/releases)에서 `TokenTracker-plus-Setup-v*.exe`를 내려받아 설치하세요. 처음이라면 [입문 가이드](./docs/getting-started.zh-CN.md)(중국어)를 먼저 읽어보세요.

```bash
git clone https://github.com/01UNCLEDOG01/TokenTracker-plus.git
cd TokenTracker-plus
npm install
node bin/tracker.js   # 첫 실행: 훅 자동 설치 + 동기화 + Dashboard 열기
node bin/tracker.js status   # 55개 도구 연결 상태
node bin/tracker.js doctor   # 진단
```

로컬 Dashboard는 `http://localhost:7680`. 지원 도구 전체 목록은 [중국어 README](./README.md#-支持的-ai-工具列表55-款)를 참고하세요(CLI / VS Code 확장 / IDE 총 55종).

## 💰 과금과 히트맵

`cost = Σ(tokens × 정가)`. LiteLLM 공식 요금 + 로컬 재정의. 미공개 가격 모델은 금액을 지어내지 않고 토큰만 기록. 히트맵은 P30~P95 분위 + Lv7(≥30억 토큰/일) 8단계.

## 🔒 프라이버시

토큰 수·시각·모델명·추정 금액 같은 수치만 로컬 `~/.tokentracker/`에 기록합니다. 프롬프트·응답·코드 본문은 저장·전송하지 않습니다. 쿠키/키가 필요한 것은 일부 쿼터 카드뿐이며 핵심 기능에는 불필요합니다. WorkBuddy 쿼터 카드(두 에디션 모두)는 데스크톱 앱이 실행 중일 때만 읽힙니다(플랜 + 일일 보너스 크레딧).

## 📄 라이선스

MIT. 업스트림 [xiufengsun/TokenTracker](https://github.com/xiufengsun/TokenTracker)에 감사드립니다. 자세한 내용은 [중국어 버전](./README.md)을 참고하세요.
