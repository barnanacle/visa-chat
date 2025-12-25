---
description: source_data 디렉토리의 PDF 파일을 벡터DB로 빌드하고 배포
---

# RAG 소스 데이터 업데이트

source_data 디렉토리에 PDF 파일이 추가되거나 변경되었을 때 실행합니다.

## 실행 단계

// turbo-all

1. source_data 디렉토리 확인
```bash
ls -la /Users/ryu/Antigravity/visachat/source_data/
```

2. 벡터 DB 빌드 (변경된 파일만 처리됨)
```bash
cd /Users/ryu/Antigravity/visachat && npm run build-vectordb
```

3. 변경사항 커밋
```bash
cd /Users/ryu/Antigravity/visachat && git add vectordb_data.json .pdf-hash && git commit -m "RAG 데이터 업데이트"
```

4. 서버에 배포
```bash
cd /Users/ryu/Antigravity/visachat && git push origin main
```

## 결과 확인

- 배포 완료까지 약 1분 소요
- https://visachat.bluedawn.kr 에서 테스트 가능
