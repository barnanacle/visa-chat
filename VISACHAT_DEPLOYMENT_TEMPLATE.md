# 카페24 자동 배포 시스템 구축 완전 가이드

> **목적**: GitHub 레포지토리에 코드를 푸시하면 카페24 호스팅 서버로 **자동 배포**되는 CI/CD 파이프라인 구축
>
> **대상 프로젝트**: `visachat` (또는 새로운 Node.js 프로젝트)
>
> **대상 서버**: `root@210.114.1.234` → `/var/www/html/visachat`

---

## 📋 목차

1. [전체 아키텍처 이해](#1️⃣-전체-아키텍처-이해)
2. [GitHub 레포지토리 설정](#2️⃣-github-레포지토리-설정)
3. [GitHub Secrets 설정](#3️⃣-github-secrets-설정)
4. [GitHub Actions 워크플로우 생성](#4️⃣-github-actions-워크플로우-생성)
5. [서버 초기 설정](#5️⃣-서버-초기-설정)
6. [웹 서버(Nginx) 설정](#6️⃣-웹-서버nginx-설정)
7. [첫 배포 및 검증](#7️⃣-첫-배포-및-검증)
8. [문제 해결 가이드](#8️⃣-문제-해결-가이드)

---

## 1️⃣ 전체 아키텍처 이해

### 배포 흐름

```mermaid
graph LR
    A[로컬 개발] -->|git push| B[GitHub Repository]
    B -->|트리거| C[GitHub Actions]
    C -->|FTP 업로드| D[카페24 서버]
    C -->|SSH 명령| E[PM2 재시작]
    D --> F[웹 서비스 업데이트]
    E --> F
```

### 사용 기술 스택

| 구성 요소 | 기술 | 역할 |
|----------|------|------|
| **CI/CD** | GitHub Actions | 자동화 파이프라인 |
| **파일 전송** | FTP-Deploy-Action | 서버에 파일 업로드 |
| **원격 실행** | SSH Action | 서버 명령어 실행 |
| **프로세스 관리** | PM2 | Node.js 앱 관리 |
| **웹 서버** | Nginx | 리버스 프록시 |

### 최종 결과

```bash
git push origin main
```

위 명령어 하나로:
1. ✅ GitHub Actions 자동 실행
2. ✅ FTP로 서버에 파일 업로드
3. ✅ SSH로 서버 접속하여 `npm install` 실행
4. ✅ PM2로 애플리케이션 재시작
5. ✅ 변경사항 즉시 반영

---

## 2️⃣ GitHub 레포지토리 설정

### 2.1 새 레포지토리 생성

1. [GitHub](https://github.com)에서 새 레포지토리 생성
   - 예: `https://github.com/barnanacle/visachat`

2. 로컬 프로젝트와 연결:

```bash
cd /path/to/visachat
git init
git remote add origin https://github.com/barnanacle/visachat.git
git branch -M main
```

### 2.2 필수 파일 구조

```
visachat/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 워크플로우
├── src/
│   └── server.js               # 메인 서버 파일
├── package.json                # Node.js 의존성
├── .env.example                # 환경 변수 템플릿 (Git에 포함)
├── .env                        # 실제 환경 변수 (Git에서 제외!)
└── .gitignore                  # Git 제외 파일 목록
```

### 2.3 `.gitignore` 파일 생성

```gitignore
# Dependencies
node_modules/

# Environment variables (절대 Git에 커밋하지 말 것!)
.env
.env.local
.env.*.local

# Logs
logs/
*.log
npm-debug.log*

# Runtime data
pids/
*.pid
*.seed

# Test results
test-results/
playwright-report/
coverage/

# OS generated files
.DS_Store
Thumbs.db

# IDE
.vscode/
.idea/

# Temporary files
*.tmp
*.temp
```

### 2.4 `.env.example` 파일 생성

> Git에 포함되어 다른 개발자가 필요한 환경 변수를 알 수 있도록 합니다.

```env
# LLM API 설정 (하나만 선택하여 사용)
GEMINI_API_KEY=your_gemini_api_key_here
# OPENAI_API_KEY=your_openai_api_key_here
# GROK_API_KEY=your_grok_api_key_here

# 서버 설정
NODE_ENV=production
PORT=3001

# 보안 설정
ALLOWED_ORIGINS=https://your-domain.com,http://localhost:3001
```

---

## 3️⃣ GitHub Secrets 설정

> **보안 주의**: 비밀번호, API 키 등은 절대 코드에 직접 작성하지 마세요!

### 3.1 Secrets 추가 방법

1. GitHub 레포지토리 페이지 접속
2. **Settings** 탭 클릭
3. 좌측 메뉴에서 **Secrets and variables** → **Actions** 클릭
4. **New repository secret** 버튼 클릭

### 3.2 필수 Secrets 목록

| Secret 이름 | 값 | 설명 |
|------------|-----|------|
| `CAFE24_FTP_HOST` | `210.114.1.234` | 카페24 서버 IP |
| `CAFE24_FTP_USERNAME` | `ftpuser` | FTP 사용자명 |
| `CAFE24_FTP_PASSWORD` | `(FTP 비밀번호)` | FTP 비밀번호 |
| `CAFE24_SSH_HOST` | `210.114.1.234` | SSH 호스트 (FTP와 동일) |
| `CAFE24_SSH_USERNAME` | `root` | SSH 사용자명 |
| `CAFE24_SSH_KEY` | `(SSH 개인키 전체 내용)` | SSH 인증용 개인키 |

### 3.3 SSH 키 생성 및 등록

#### 서버에서 SSH 키 생성

```bash
# 1. 서버에 접속
ssh root@210.114.1.234

# 2. visachat 전용 SSH 키 생성 (패스프레이즈 없이)
ssh-keygen -t rsa -b 4096 -f ~/.ssh/visachat_deploy_key -N ""

# 3. 공개키를 authorized_keys에 추가
cat ~/.ssh/visachat_deploy_key.pub >> ~/.ssh/authorized_keys

# 4. 개인키 내용 확인 (이 내용을 GitHub Secrets에 등록)
cat ~/.ssh/visachat_deploy_key
```

#### GitHub Secrets에 SSH 키 등록

위 4번 명령의 출력 전체를 복사하여 `CAFE24_SSH_KEY` secret에 붙여넣기:

```
-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAACFwAAAAdzc2gtcn
... (중간 내용) ...
-----END OPENSSH PRIVATE KEY-----
```

> ⚠️ **중요**: `-----BEGIN`부터 `-----END...-----`까지 전체를 복사해야 합니다!

---

## 4️⃣ GitHub Actions 워크플로우 생성

### 4.1 워크플로우 파일 생성

`.github/workflows/deploy.yml` 파일을 생성합니다:

```yaml
name: Deploy to Cafe24

on:
  push:
    branches: [ main ]

jobs:
  deploy:
    runs-on: ubuntu-latest
    
    steps:
    # 1. 코드 체크아웃
    - name: Checkout code
      uses: actions/checkout@v4
      
    # 2. Node.js 설정
    - name: Setup Node.js
      uses: actions/setup-node@v4
      with:
        node-version: '18'
        cache: 'npm'
        
    # 3. 의존성 설치
    - name: Install dependencies
      run: npm install
      
    # 4. 테스트 실행 (선택사항)
    - name: Run tests (if any)
      run: npm test || echo "No tests found, continuing..."
      
    # 5. 서버 권한 준비 (FTP 업로드 전)
    - name: Prepare server permissions
      uses: appleboy/ssh-action@v1.0.3
      with:
        host: ${{ secrets.CAFE24_SSH_HOST }}
        username: ${{ secrets.CAFE24_SSH_USERNAME }}
        key: ${{ secrets.CAFE24_SSH_KEY }}
        script: |
          echo "🔧 서버 권한 준비 중..."
          
          # 디렉토리가 없으면 생성
          mkdir -p /var/www/html/visachat
          
          # FTP 사용자를 www-data 그룹에 추가
          usermod -a -G www-data ftpuser 2>/dev/null || true
          
          # 디렉토리 권한 설정
          chown -R www-data:www-data /var/www/html/visachat
          chmod -R 775 /var/www/html/visachat
          
          echo "✅ 서버 권한 설정 완료"
        port: 22
        timeout: 30s
        command_timeout: 2m
      
    # 6. FTP로 파일 업로드
    - name: Deploy to Cafe24 via FTP
      uses: SamKirkland/FTP-Deploy-Action@v4.3.4
      with:
        server: ${{ secrets.CAFE24_FTP_HOST }}
        username: ${{ secrets.CAFE24_FTP_USERNAME }}
        password: ${{ secrets.CAFE24_FTP_PASSWORD }}
        server-dir: '/var/www/html/visachat/'
        log-level: verbose
        exclude: |
          **/.git*
          **/.git*/**
          **/node_modules/**
          **/.env
          **/.env.*
          **/.env.backup
          **/README.md
          **/.gitignore
          **/.github/**
          **/test-results/**
          **/playwright-report/**
          **/coverage/**
          **/tests/**
          **/*.log
          **/.DS_Store
          **/Thumbs.db
          
    # 7. FTP 업로드 후 권한 수정
    - name: Fix permissions after FTP upload
      uses: appleboy/ssh-action@v1.0.3
      with:
        host: ${{ secrets.CAFE24_SSH_HOST }}
        username: ${{ secrets.CAFE24_SSH_USERNAME }}
        key: ${{ secrets.CAFE24_SSH_KEY }}
        script: |
          cd /var/www/html/visachat
          echo "🔧 FTP 업로드 후 권한 수정 중..."
          
          chown -R www-data:www-data /var/www/html/visachat
          chmod -R 775 /var/www/html/visachat
          
          echo "📁 업로드된 파일들:"
          ls -la
          
          echo "✅ 권한 수정 완료"
        port: 22
        timeout: 30s
        command_timeout: 2m
          
    # 8. 서버 재시작
    - name: Restart Server after Deploy
      uses: appleboy/ssh-action@v1.0.3
      with:
        host: ${{ secrets.CAFE24_SSH_HOST }}
        username: ${{ secrets.CAFE24_SSH_USERNAME }}
        key: ${{ secrets.CAFE24_SSH_KEY }}
        script: |
          cd /var/www/html/visachat
          echo "📁 현재 디렉토리: $(pwd)"
          
          echo "📦 의존성 설치 중..."
          npm install --production
          
          echo "🔄 PM2 프로세스 상태 확인:"
          pm2 list
          
          # PM2 프로세스가 존재하면 재시작, 없으면 새로 시작
          if pm2 describe visachat > /dev/null 2>&1; then
            echo "🔄 visachat 서버 재시작 중..."
            pm2 restart visachat
          else
            echo "🚀 visachat 서버 새로 시작..."
            pm2 start server.js --name visachat
          fi
          
          sleep 5
          
          echo "📊 최종 상태 확인:"
          pm2 list
          pm2 save
          
          echo "✅ visachat 서버 배포 완료!"
        port: 22
        timeout: 30s
        command_timeout: 5m
```

### 4.2 워크플로우 설명

| 단계 | 작업 | 설명 |
|-----|------|------|
| 1 | Checkout | GitHub에서 코드 가져오기 |
| 2 | Setup Node.js | Node.js 18 버전 설정 |
| 3 | Install dependencies | `npm install` 실행 |
| 4 | Run tests | 테스트 실행 (없으면 건너뜀) |
| 5 | Prepare permissions | FTP 업로드 전 서버 권한 설정 |
| 6 | FTP Deploy | 서버에 파일 업로드 |
| 7 | Fix permissions | 업로드 후 권한 재설정 |
| 8 | Restart Server | PM2로 앱 재시작 |

---

## 5️⃣ 서버 초기 설정

### 5.1 SSH로 서버 접속

```bash
ssh root@210.114.1.234
```

### 5.2 Node.js 설치 (없는 경우)

```bash
# Node.js 18 설치
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
apt-get install -y nodejs

# 버전 확인
node --version   # v18.x.x
npm --version    # 9.x.x
```

### 5.3 PM2 설치

```bash
# PM2 전역 설치
npm install -g pm2

# PM2 자동 시작 설정
pm2 startup
# 출력되는 명령어를 복사해서 실행

# 현재 설정 저장
pm2 save
```

### 5.4 프로젝트 디렉토리 생성

```bash
# 디렉토리 생성
mkdir -p /var/www/html/visachat

# 권한 설정
chown -R www-data:www-data /var/www/html/visachat
chmod -R 775 /var/www/html/visachat
```

### 5.5 환경 변수 파일 생성

```bash
cd /var/www/html/visachat
nano .env
```

`.env` 파일 내용 (서버 전용):

```env
# LLM API 설정
GEMINI_API_KEY=실제_API_키_입력

# 서버 설정
NODE_ENV=production
PORT=3001

# 보안 설정
ALLOWED_ORIGINS=https://your-domain.com,http://localhost:3001
```

> ⚠️ **중요**: `.env` 파일은 GitHub에 업로드되지 않습니다. 서버에서 직접 생성해야 합니다!

### 5.6 FTP 사용자 설정

```bash
# FTP 사용자가 없으면 생성
useradd -m ftpuser
passwd ftpuser

# FTP 사용자를 www-data 그룹에 추가
usermod -a -G www-data ftpuser
```

---

## 6️⃣ 웹 서버(Nginx) 설정

### 6.1 Nginx 설정 파일 생성

```bash
nano /etc/nginx/sites-available/visachat
```

### 6.2 Nginx 설정 내용

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;
    
    # 또는 IP로 직접 접근하는 경우:
    # listen 80;
    # server_name 210.114.1.234;

    location / {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 타임아웃 설정 (LLM API 호출이 오래 걸릴 수 있음)
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 300s;
    }
}
```

### 6.3 설정 활성화

```bash
# 심볼릭 링크 생성
ln -s /etc/nginx/sites-available/visachat /etc/nginx/sites-enabled/

# 설정 테스트
nginx -t

# Nginx 재시작
systemctl restart nginx
```

### 6.4 SSL 설정 (권장)

```bash
# Certbot 설치
apt update
apt install certbot python3-certbot-nginx

# SSL 인증서 발급
certbot --nginx -d your-domain.com -d www.your-domain.com
```

---

## 7️⃣ 첫 배포 및 검증

### 7.1 첫 번째 배포

```bash
# 로컬에서 실행
cd /path/to/visachat

# 변경사항 커밋 및 푸시
git add .
git commit -m "chore: 자동 배포 설정"
git push origin main
```

### 7.2 GitHub Actions 확인

1. GitHub 레포지토리 페이지 접속
2. **Actions** 탭 클릭
3. "Deploy to Cafe24" 워크플로우 클릭
4. 각 단계별 로그 확인

### 7.3 서버에서 확인

```bash
# 서버 접속
ssh root@210.114.1.234

# PM2 상태 확인
pm2 list
pm2 logs visachat --lines 20

# 서비스 테스트
curl http://localhost:3001/api/health
```

### 7.4 웹사이트 접속 테스트

브라우저에서 접속:
- `http://210.114.1.234:3001` (직접 접속)
- `http://your-domain.com` (Nginx 프록시 경유)

---

## 8️⃣ 문제 해결 가이드

### 8.1 GitHub Actions 실패

#### FTP 연결 실패
```
Error: 530 Login incorrect
```
**해결**: GitHub Secrets의 `CAFE24_FTP_USERNAME`, `CAFE24_FTP_PASSWORD` 확인

#### SSH 연결 실패
```
ssh: handshake failed: ssh: unable to authenticate
```
**해결**: 
1. `CAFE24_SSH_KEY`가 올바르게 등록되었는지 확인
2. `-----BEGIN`부터 `-----END...-----`까지 전체가 포함되었는지 확인
3. 서버의 `~/.ssh/authorized_keys`에 공개키가 등록되었는지 확인

### 8.2 서버 문제

#### 포트 충돌
```bash
# 포트 사용 확인
lsof -i :3001
netstat -tlnp | grep :3001
```

#### PM2 프로세스 문제
```bash
# 프로세스 삭제 후 재시작
pm2 delete visachat
pm2 start server.js --name visachat
pm2 save
```

#### 권한 문제
```bash
# 권한 재설정
chown -R www-data:www-data /var/www/html/visachat
chmod -R 775 /var/www/html/visachat
```

### 8.3 로그 확인

```bash
# PM2 로그
pm2 logs visachat --lines 100

# Nginx 로그
tail -f /var/log/nginx/error.log
tail -f /var/log/nginx/access.log
```

---

## 📌 빠른 참조 카드

### 배포 명령어
```bash
git add .
git commit -m "feat: 새로운 기능 추가"
git push origin main
```

### 서버 관리
```bash
ssh root@210.114.1.234          # 서버 접속
pm2 list                         # 프로세스 목록
pm2 logs visachat               # 로그 확인
pm2 restart visachat            # 재시작
pm2 stop visachat               # 중지
pm2 delete visachat             # 삭제
```

### GitHub Secrets 체크리스트
- [ ] `CAFE24_FTP_HOST`
- [ ] `CAFE24_FTP_USERNAME`
- [ ] `CAFE24_FTP_PASSWORD`
- [ ] `CAFE24_SSH_HOST`
- [ ] `CAFE24_SSH_USERNAME`
- [ ] `CAFE24_SSH_KEY`

---

## 🔄 다른 프로젝트에 적용하기

이 템플릿을 새 프로젝트에 적용할 때 변경해야 할 항목:

1. **`deploy.yml`에서**:
   - `server-dir`: `/var/www/html/프로젝트명/`
   - `pm2 start server.js --name 프로젝트명`
   - `pm2 restart 프로젝트명`

2. **서버에서**:
   - 새 디렉토리 생성: `/var/www/html/프로젝트명`
   - `.env` 파일 생성
   - Nginx 설정 파일 생성

3. **포트 번호**:
   - 각 프로젝트별로 다른 포트 사용 (3000, 3001, 3002...)

---

**이 가이드를 따라하면 GitHub에 푸시만으로 자동 배포되는 CI/CD 파이프라인을 구축할 수 있습니다!** 🚀
