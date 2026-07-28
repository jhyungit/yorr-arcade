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

# 지금 비어 있는 포트 찾기.
#  안 하면 Vite 가 조용히 다음 포트로 옮겨가는데(5173 사용중 → 5174) 아래 안내문은
#  이미 5173 으로 출력돼 버려서 "어디로 들어가야 하지?" 가 된다.
function Find-FreePort([int]$from) {
    for ($p = $from; $p -lt ($from + 20); $p++) {
        if (-not (Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue)) { return $p }
    }
    return $from
}

# 폰이 들어올 수 있는 실제 IP 하나.
#  ★ "사설 IP 대역"으로 거르면 안 된다. WSL·Hyper-V 가상 어댑터가 172.16~31 대역이라
#    같이 걸리고, 반대로 학교 와이파이가 주는 70.x 같은 주소는 빠진다.
#    물리 어댑터(-Physical)이면서 연결된 것만 보고, 무선을 우선한다.
function Get-PhoneIp {
    $cands = Get-NetAdapter -Physical -ErrorAction SilentlyContinue |
        Where-Object { $_.Status -eq 'Up' } |
        ForEach-Object {
            $name = $_.Name
            Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
                Where-Object { $_.IPAddress -notlike '169.254.*' } |
                ForEach-Object { [pscustomobject]@{ Ip = $_.IPAddress; Name = $name } }
        }
    if (-not $cands) { return $null }
    # 무선(Wi-Fi / 무선) 어댑터 우선 — 폰은 와이파이·핫스팟으로 붙는다
    $wifi = $cands | Where-Object { $_.Name -match 'Wi-?Fi|무선' } | Select-Object -First 1
    if ($wifi) { return $wifi }
    return ($cands | Select-Object -First 1)
}

$port = Find-FreePort 5173
$phone = Get-PhoneIp

# 1) 실시간 서버를 새 창에서 실행 (node 로 직접 실행)
if (Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue) {
    Write-Host "[안내] 포트 3001 에 이미 서버가 떠 있어 새로 띄우지 않습니다." -ForegroundColor Yellow
    Write-Host "       (예전 창이 남아 있는 것일 수 있습니다. 이상하면 그 창들을 닫고 다시 실행하세요.)" -ForegroundColor DarkGray
} else {
    Write-Host "[1/2] 실시간 서버(포트 3001)를 새 창에서 시작합니다..." -ForegroundColor Cyan
    $serverCmd = "`$env:Path=[System.Environment]::GetEnvironmentVariable('Path','Machine')+';'+[System.Environment]::GetEnvironmentVariable('Path','User'); Set-Location '$server'; node index.js"
    Start-Process powershell -ArgumentList "-NoExit", "-NoProfile", "-Command", $serverCmd
    Start-Sleep -Seconds 2
}

Write-Host ""
Write-Host "==================================================================" -ForegroundColor Green
Write-Host "  이 노트북에서 할 때  →  " -ForegroundColor Green -NoNewline
Write-Host ("https://localhost:{0}/" -f $port) -ForegroundColor White
if ($phone) {
    Write-Host "  폰에서 접속할 때     →  " -ForegroundColor Green -NoNewline
    Write-Host ("https://{0}:{1}/" -f $phone.Ip, $port) -ForegroundColor White
} else {
    Write-Host "  폰에서 접속할 때     →  (연결된 와이파이가 없습니다)" -ForegroundColor Yellow
}
Write-Host "==================================================================" -ForegroundColor Green
Write-Host " * 인증서 경고가 뜨면 '고급 -> 계속 진행' (아이폰은 '웹사이트 방문')" -ForegroundColor DarkGray
Write-Host " * 폰으로 조종하려면: 노트북 화면에서 폰 연결 코드를 발급 -> 폰에 입력" -ForegroundColor DarkGray
Write-Host ""

Write-Host "웹 서버를 시작합니다... (이 창을 닫거나 Ctrl+C 를 누르면 종료)" -ForegroundColor DarkGray
Write-Host ""

# 2) 웹 서버(Vite)를 이 창에서 직접 실행 (node 로 vite 실행 → 실행정책 영향 안 받음)
#    --strictPort  : 위에서 고른 포트를 못 쓰면 조용히 옮기지 말고 바로 실패해라.
#                    (안내문과 실제 주소가 어긋나는 게 제일 헷갈린다)
#    --logLevel warn: Vite 가 자기 주소 목록(가상 어댑터까지 7~8줄)을 또 뿌리는 걸 막는다.
#                    위에 두 줄만 남기려는 게 목적. 오류·경고는 그대로 보인다.
Set-Location $client
& $node "node_modules/vite/bin/vite.js" --port $port --strictPort --logLevel warn
