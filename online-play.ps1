# =============================================================
#  원격 온라인 실행 (ngrok) — 다른 인터넷의 친구와 플레이
#
#  ★ 실행은 온라인플레이.bat 더블클릭 권장.
#
#  하는 일:
#   1) 클라이언트 빌드 (client/dist)
#   2) Node 서버(3001)가 빌드된 앱 + 소켓을 함께 서빙 (새 창)
#   3) ngrok 으로 3001 을 인터넷 https 주소로 공개
#   → 뜨는 https://xxxx.ngrok-free.app 주소를 친구에게 공유하면 접속/플레이.
#
#  ── 최초 1회 준비 ──
#   - ngrok 설치:  winget install --id Ngrok.Ngrok
#   - https://dashboard.ngrok.com 가입 → 토큰 복사 →  ngrok config add-authtoken <토큰>
# =============================================================

$ErrorActionPreference = 'Stop'
trap {
  Write-Host ""
  Write-Host "‼️ 오류: $_" -ForegroundColor Red
  Read-Host "엔터를 누르면 종료"
  exit 1
}

# 방금 설치한 Node/ngrok 도 인식되도록 PATH 새로고침
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

$root = $PSScriptRoot
$client = Join-Path $root "client"
$server = Join-Path $root "server"

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node 를 찾을 수 없습니다. Node.js 설치 후 다시 시도하세요." }
$ngrok = (Get-Command ngrok -ErrorAction SilentlyContinue).Source
if (-not $ngrok) { throw "ngrok 미설치입니다.  winget install --id Ngrok.Ngrok  로 설치 후 다시 실행하세요." }
$npm = Join-Path (Split-Path $node) "npm.cmd"

# 의존성 설치 (최초 1회)
if (-not (Test-Path (Join-Path $client "node_modules"))) { Push-Location $client; & $npm install; Pop-Location }
if (-not (Test-Path (Join-Path $server "node_modules"))) { Push-Location $server; & $npm install; Pop-Location }

# 1) 클라이언트 빌드
Write-Host "[1/3] 클라이언트 빌드 중..." -ForegroundColor Cyan
Push-Location $client
& $node "node_modules/vite/bin/vite.js" build
Pop-Location

# 2) 서버(3001) 새 창에서 실행 (빌드된 앱 + 소켓 서빙)
Write-Host "[2/3] 서버(3001) 실행 (새 창)..." -ForegroundColor Cyan
$serverCmd = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User'); Set-Location '$server'; node index.js"
Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $serverCmd
Start-Sleep -Seconds 2

# 3) ngrok 터널
Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " 아래 출력에서 https://....ngrok-free.app 주소를 찾아" -ForegroundColor Green
Write-Host " 친구에게 공유하세요! (나도 그 주소로 접속해서 플레이)" -ForegroundColor Green
Write-Host " * 처음 접속 시 ngrok 경고 페이지가 뜨면 'Visit Site' 클릭." -ForegroundColor DarkGray
Write-Host " * 토큰 오류가 나면: ngrok config add-authtoken <토큰> (dashboard.ngrok.com)" -ForegroundColor DarkGray
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""
& $ngrok http 3001
