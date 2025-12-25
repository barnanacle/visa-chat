# 🛂 Visachat Project

> 대한민국 출입국 업무 관련 비자/체류 전문 상담 챗봇

## 📋 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **도메인** | `visachat.bluedawn.kr` |
| **서버 IP** | `210.114.1.234` |
| **서버 경로** | `/var/www/html/visachat` |
| **GitHub** | `https://github.com/barnanacle/visa-chat` |
| **호스팅** | 카페24 |

## 🎯 프로젝트 목표

1. **RAG 기반 비자 상담 챗봇**
   - 대화형 UI (점성술 챗봇 스타일)
   - 한국어/영어/일본어/중국어/베트남어 지원
   - ChromaDB 벡터 검색 + 키워드 매칭

2. **정부 서식 파일 다운로드 서비스**
   - 서식 파일 DB 구축
   - 채팅창을 통한 서식 요청 및 다운로드
   - 출입국 관련 필수 서식 제공

## 🏗️ 시스템 아키텍처

```
사용자 (visachat.bluedawn.kr)
         ↓
    Apache (443/80)
         ↓
    Node.js (3002)
         ↓
   ┌─────┴─────┐
   ↓           ↓
ChromaDB    서식 DB
(RAG)      (Forms)
```

## 📁 소스 코드 현황

### 로컬 (`/Users/ryu/Antigravity/visachat`)
```
visachat/
├── index.js              # RAG 시스템 메인 (LangChain + ChromaDB)
├── server.js             # 서버 진입점
├── package.json          # 의존성 (LangChain, ChromaDB 등)
├── ecosystem.config.cjs  # PM2 설정
├── public/               # 프론트엔드
│   ├── index.html
│   ├── script.js
│   └── style.css
├── documents/            # RAG 문서 (추가 필요)
├── logs/                 # 로그 디렉토리
├── .env                  # 환경 변수
├── .gitignore
└── PROJECT.md
```
**상태**: ✅ 서버 코드 동기화 완료

### 서버 (`/var/www/html/visachat`)
```
visachat/
├── index.js            # RAG 시스템 메인
├── server.js           # 서버 진입점
├── documents/          # RAG 문서
├── chroma_db/          # 벡터 DB
├── logs/               # 로그
└── ...
```
**상태**: 고급 RAG 시스템 (LangChain + ChromaDB)

### GitHub (`barnanacle/visa-chat`)
```
visa-chat/
├── .vscode/
├── index.html          # 프론트엔드 (public/와 동일)
├── script.js
└── style.css
```
**상태**: 프론트엔드만 존재 (9 commits), 백엔드/RAG 시스템 없음
**언어**: CSS 47.8%, JavaScript 44.8%, HTML 7.4%

---

## 📅 프로젝트 로드맵

### Phase 1: 코드베이스 통합 ✅
- [x] 서버 RAG 코드 로컬로 동기화
- [x] 프론트엔드 업데이트
- [x] 모델 gpt-4o-mini로 변경

### Phase 2: CI/CD 파이프라인 구축 (진행 중)
- [x] GitHub Actions 워크플로우 생성
- [ ] GitHub Secrets 설정
- [ ] 서버 SSH 키 생성
- [ ] 서버 Apache/PM2 설정
- [ ] SSL 인증서 설정
- [ ] 첫 배포 테스트

### Phase 3: 서식 파일 시스템 ⏳
- [ ] 서식 파일 DB 스키마 설계
- [ ] 서식 파일 수집 및 분류
- [ ] 서식 검색/다운로드 API 구현
- [ ] 챗봇과 서식 시스템 통합

### Phase 4: UI/UX 개선 ⏳
- [ ] 대화형 UI 디자인 개선
- [ ] 서식 다운로드 UI 추가
- [ ] 반응형 디자인 적용
- [ ] 사용자 경험 최적화

### Phase 5: 테스트 및 배포 ⏳
- [ ] 기능 테스트
- [ ] 성능 최적화
- [ ] 최종 배포 및 모니터링

---

## 📝 작업 로그

### 2024-12-25
- 프로젝트 디렉토리 구조 정리 (backend/frontend → 루트)
- `.env`, `.gitignore` 파일 생성
- 서버 상태 분석 완료
- 프로젝트 방향성 문서화

---

## 🔗 참고 자료

- [출입국관리법](https://www.law.go.kr)
- [하이코리아](https://www.hikorea.go.kr)
- [출입국외국인정책본부](https://www.immigration.go.kr)
