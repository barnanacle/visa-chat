# 🛂 VisaChat Project

> 대한민국 출입국 업무 관련 비자/체류 전문 상담 AI 챗봇

## 📋 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **도메인** | `https://visachat.bluedawn.kr` |
| **서버 IP** | `210.114.1.234` |
| **서버 경로** | `/var/www/html/visachat` |
| **GitHub** | `https://github.com/barnanacle/visa-chat` |
| **호스팅** | 카페24 |
| **LLM** | OpenAI GPT-4o-mini |
| **지원 언어** | 한국어, English, 中文, Русский, 日本語, Tiếng Việt, ภาษาไทย |

---

## 🏗️ 시스템 아키텍처

```
사용자 (visachat.bluedawn.kr)
         ↓
    Apache (443/80)
         ↓
    Node.js (3002) + Express
         ↓
   ┌─────┴─────┐
   ↓           ↓
ChromaDB    서식 파일
 (RAG)     (167개 HWP)
```

---

## 📁 디렉토리 구조

```
visachat/
├── index.js                 # RAG 시스템 메인 (LangChain + ChromaDB)
├── server.js                # 서버 진입점
├── package.json             # 의존성
├── ecosystem.config.cjs     # PM2 설정
│
├── public/                  # 프론트엔드
│   ├── index.html           # SEO + OG태그 + 애드센스
│   ├── script.js            # 마크다운 파서 포함
│   ├── style.css            # 레이아웃 (100vh 고정)
│   ├── forms/               # ⭐ 서식 파일 (167개 HWP)
│   │   ├── *.hwp
│   │   └── forms-list.json  # 서식 메타데이터
│   ├── og-image.png         # SNS 공유 이미지
│   └── favicon.svg
│
├── source_data/             # ⭐ RAG 소스 PDF (서버 업로드 안됨)
│   ├── 사증민원_매뉴얼.pdf
│   ├── 체류민원_매뉴얼.pdf
│   ├── 국적법.pdf
│   └── ...
│
├── document_forms/          # 서식 원본 (public/forms로 복사됨)
│
├── scripts/
│   └── build-vectordb.js    # PDF → 벡터DB 빌드 스크립트
│
├── vectordb_data.json       # ⭐ 빌드된 벡터 데이터 (서버 업로드)
├── .pdf-hash                # PDF 변경 감지용 해시
│
├── .github/workflows/
│   └── deploy.yml           # GitHub Actions 자동 배포
│
├── .agent/workflows/
│   └── update-source-data.md  # 슬래시 커맨드 워크플로우
│
├── .env                     # 환경 변수 (OPENAI_API_KEY 등)
├── .gitignore
└── PROJECT.md               # 이 파일
```

---

## ⚙️ 핵심 기능

### 1. RAG 기반 비자 상담
- **벡터 DB**: ChromaDB (서버 메모리)
- **임베딩**: OpenAI text-embedding-3-small
- **LLM**: GPT-4o-mini
- **청크 수**: 942개 (2024-12-26 기준)

### 2. 서식 파일 다운로드
- **서식 수**: 167개 HWP
- **다운로드 URL**: `https://visachat.bluedawn.kr/forms/파일명.hwp`
- 챗봇이 질문에 맞게 서식 다운로드 링크 제공

### 3. 마크다운 렌더링
- 굵은 글씨 (`**bold**`)
- 제목 (`####`)
- 글머리 기호 (`-` → `•`)
- 링크 (`[텍스트](URL)`) - URL 내 공백 허용

### 4. 광고 (AdSense)
- 입력창 하단 고정 배너 (90px)
- `data-full-width-responsive="false"`

---

## 🔄 업데이트 시퀀스

### 📌 RAG 소스 데이터 업데이트

source_data에 PDF 추가/변경 시:

```bash
# 1. PDF 파일을 source_data/ 디렉토리에 추가
cp 새로운_문서.pdf /Users/ryu/Antigravity/visachat/source_data/

# 2. 벡터 DB 빌드 (변경 감지 자동)
cd /Users/ryu/Antigravity/visachat
npm run build-vectordb

# 3. 커밋 및 배포
git add vectordb_data.json .pdf-hash
git commit -m "RAG 데이터 업데이트: [설명]"
git push origin main

# 약 1분 후 자동 배포 완료
```

**또는 슬래시 커맨드**: `/update-source-data`

---

### � 서식 파일 업데이트

document_forms에 HWP 추가/변경 시:

```bash
# 1. HWP 파일을 document_forms/ 디렉토리에 추가
cp 새서식.hwp /Users/ryu/Antigravity/visachat/document_forms/

# 2. public/forms/로 복사
cp document_forms/*.hwp public/forms/

# 3. forms-list.json 재생성
node -e "
const fs = require('fs');
const files = fs.readdirSync('./public/forms').filter(f => f.endsWith('.hwp'));
const forms = files.map(file => ({
    name: file.replace('.hwp', ''),
    file: file,
    url: '/forms/' + encodeURIComponent(file)
}));
const output = {
    version: '1.1',
    updatedAt: new Date().toISOString(),
    totalForms: forms.length,
    forms: forms
};
fs.writeFileSync('./public/forms/forms-list.json', JSON.stringify(output, null, 2));
console.log('Created forms-list.json with', forms.length, 'forms');
"

# 4. 커밋 및 배포
git add public/forms
git commit -m "서식 추가: [설명]"
git push origin main
```

---

### 📌 코드 변경 후 배포

```bash
git add .
git commit -m "설명"
git push origin main
# GitHub Actions가 자동으로 FTP 업로드 + PM2 재시작
```

---

## 📊 현재 상태 (2024-12-26)

| 항목 | 상태 |
|------|------|
| **레이아웃** | ✅ 완벽 (100vh 고정, 채팅창 스크롤) |
| **광고** | ✅ 고정 배너 90px |
| **RAG 데이터** | ✅ 942 청크 (9개 PDF) |
| **서식 파일** | ✅ 167개 HWP |
| **마크다운 파서** | ✅ 링크/제목/글머리 정상 |
| **다국어 지원** | ✅ 7개 언어 |
| **SEO** | ✅ OG태그, JSON-LD, hreflang |

---

## 🔑 환경 변수 (.env)

```
OPENAI_API_KEY=sk-...
ADMIN_KEY=...
```

---

## 📝 주요 커밋 웨이포인트

| 커밋 | 설명 |
|------|------|
| `dca3223` | 마크다운 공백 URL 수정 완료 |
| `b3ec6cb` | 고정 크기 배너 광고 완성 |
| `7a63385` | 글머리 기호 중복 수정 |

---

## 🔗 참고 자료

- [출입국관리법](https://www.law.go.kr)
- [하이코리아](https://www.hikorea.go.kr)
- [출입국외국인정책본부](https://www.immigration.go.kr)
