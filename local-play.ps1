# =============================================================
#  요트 다이스 실행 스크립트 (서버 + 클라이언트 한 번에)
#
#  ★ 실행은 되도록 "로컬플레이.bat" 을 더블클릭하세요.
#    (이 .ps1 을 우클릭 실행하면 Windows 실행정책 때문에 창이 바로 닫힐 수 있음)
#
#  이 스크립트가 하는 일:
#   1) (최초 1회) client / server 의존성 설치
#   2) 실시간 서버(Socket.IO, 포트 3001)를 '새 창'에서 실행
#   3) 웹 서버(Vite, https 포트 5173)를 '이 창'에서 실행
#   4) 폰에 입력할 접속 주소를 안내
#
#  ── 폰 테스트 (SSAFY 와이파이는 기기간 통신이 막혀서 핫스팟 권장) ──
#   1) 폰에서 '개인용 핫스팟' 켜기
#   2) 노트북 Wi-Fi 를 그 핫스팟에 연결
#   3) 실행 → 아래 뜨는 https://172.20.10.x:5173 주소를 폰 브라우저에 입력
# =============================================================

# 에러가 나면 메시지를 보여주고 창을 유지 (원인 파악용)
$ErrorActionPreference = 'Stop'
trap {
    Write-Host ""
    Write-Host "‼️ 오류가 발생했습니다:" -ForegroundColor Red
    Write-Host $_ -ForegroundColor Red
    Write-Host ""
    Read-Host "엔터를 누르면 종료합니다"
    exit 1
}

# 방금 Node를 설치한 경우에도 인식되도록 PATH 새로고침
$env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [System.Environment]::GetEnvironmentVariable("Path", "User")

# node 실행 파일 위치 확인
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { throw "node 를 찾을 수 없습니다. Node.js 설치 후 다시 시도하세요." }

$root = $PSScriptRoot
$client = Join-Path $root "client"
$server = Join-Path $root "server"

# 최초 실행 시 의존성 설치 (npm.cmd 를 직접 호출 → 실행정책 영향 안 받음)
$npmCmd = Join-Path (Split-Path $node) "npm.cmd"
if (-not (Test-Path (Join-Path $client "node_modules"))) {
    Write-Host "[안내] client 의존성 설치 중... (처음 한 번, 조금 걸립니다)" -ForegroundColor Yellow
    Push-Location $client; & $npmCmd install; Pop-Location
}
if (-not (Test-Path (Join-Path $server "node_modules"))) {
    Write-Host "[안내] server 의존성 설치 중..." -ForegroundColor Yellow
    Push-Location $server; & $npmCmd install; Pop-Location
}

# 1) 실시간 서버를 새 창에서 실행 (node 로 직접 실행)
Write-Host "[1/2] 실시간 서버(포트 3001)를 새 창에서 시작합니다..." -ForegroundColor Cyan
$serverCmd = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User'); Set-Location '$server'; node index.js"
Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $serverCmd

Start-Sleep -Seconds 2

# 접속 주소 안내 (Wi-Fi/핫스팟에 잡힌 사설 IP)
$ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)' } |
    Select-Object -ExpandProperty IPAddress

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " 폰 브라우저 주소창에 아래 주소 중 하나를 입력하세요:" -ForegroundColor Green
if ($ips) { foreach ($ip in $ips) { Write-Host ("    https://{0}:5173/" -f $ip) -ForegroundColor White } }
else { Write-Host "    (사설 IP 없음 — 핫스팟/와이파이 연결을 확인하세요)" -ForegroundColor Yellow }
Write-Host ""
Write-Host " PC에서 테스트하려면:  https://localhost:5173/" -ForegroundColor White
Write-Host " * 인증서 경고가 뜨면 '고급 -> 계속 진행'(아이폰은 '웹사이트 방문')" -ForegroundColor DarkGray
Write-Host " * 방 만들기 -> 링크/코드를 친구에게 공유하면 같이 플레이!" -ForegroundColor DarkGray
Write-Host "==================================================================" -ForegroundColor Green
Write-Host ""

# 2) 웹 서버(Vite)를 이 창에서 직접 실행 (node 로 vite 실행 → 실행정책 영향 안 받음)
Set-Location $client
& $node "node_modules/vite/bin/vite.js"
