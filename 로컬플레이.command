#!/bin/bash
# =============================================================
#  YORR 로컬 실행 스크립트 (macOS 용) — Finder 에서 더블클릭
#
#  윈도우는 "로컬플레이.bat", 맥은 이 파일을 쓴다.
#  (.bat / .ps1 은 윈도우 전용이라 맥에서 실행되지 않음)
#
#  하는 일:
#   1) (최초 1회) client / server 의존성 설치
#   2) 실시간 서버(Socket.IO, 포트 3001)를 백그라운드로 실행
#   3) 웹 서버(Vite, https 포트 5173)를 이 창에서 실행
#   4) 폰에 입력할 접속 주소를 안내
#
#  ── 폰 테스트 ──
#   1) 폰에서 '개인용 핫스팟' 켜기 (또는 맥/폰을 같은 와이파이에)
#   2) 맥 Wi-Fi 를 그 핫스팟에 연결
#   3) 실행 → 아래 뜨는 https://172.20.10.x:5173 주소를 폰 브라우저에 입력
# =============================================================

set -e
cd "$(dirname "$0")"

ROOT="$(pwd)"
CLIENT="$ROOT/client"
SERVER="$ROOT/server"

# nvm 으로 설치한 node 도 잡히게 PATH 보강 (Finder 더블클릭은 로그인 셸이 아님)
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

if ! command -v node >/dev/null 2>&1; then
  echo "‼️ node 를 찾을 수 없습니다. Node.js 설치 후 다시 시도하세요."
  echo "   (예:  brew install node   또는  https://nodejs.org )"
  read -r -p "엔터를 누르면 종료합니다 " _
  exit 1
fi

echo "node $(node -v) / npm $(npm -v)"
echo

# 최초 실행 시 의존성 설치
if [ ! -d "$CLIENT/node_modules" ]; then
  echo "[안내] client 의존성 설치 중... (처음 한 번, 조금 걸립니다)"
  (cd "$CLIENT" && npm install)
fi
if [ ! -d "$SERVER/node_modules" ]; then
  echo "[안내] server 의존성 설치 중..."
  (cd "$SERVER" && npm install)
fi

# 1) 실시간 서버를 백그라운드로 실행 (이 창을 닫으면 같이 종료됨)
echo "[1/2] 실시간 서버(포트 3001)를 시작합니다..."
(cd "$SERVER" && node index.js) &
SERVER_PID=$!
cleanup() { kill "$SERVER_PID" 2>/dev/null || true; }
trap cleanup EXIT INT TERM

sleep 2

# 웹 서버 포트 고르기.
#  Docker(Colima/Lima)나 다른 터널이 5173 의 IPv4 를 미리 점유하고 있으면,
#  vite 는 IPv6 에만 붙어버린다 → 맥 localhost 는 되는데 폰(IPv4)은 안 되는 상황.
#  그래서 IPv4/IPv6 둘 다 비어있는 포트를 찾아서 쓴다.
PORT=$(node -e '
const net = require("net");
const free = (p, host) => new Promise((res) => {
  const s = net.createServer();
  s.once("error", () => res(false));
  s.once("listening", () => s.close(() => res(true)));
  s.listen(p, host);
});
(async () => {
  for (let p = 5173; p < 5200; p++) {
    if ((await free(p, "0.0.0.0")) && (await free(p, "::"))) { console.log(p); return; }
  }
  console.log("");
})();')

if [ -z "$PORT" ]; then
  echo "‼️ 5173~5199 에 빈 포트가 없습니다. 다른 개발 서버를 끄고 다시 시도하세요."
  read -r -p "엔터를 누르면 종료합니다 " _
  exit 1
fi
if [ "$PORT" != "5173" ]; then
  echo "[안내] 5173 이 다른 프로그램(Docker/터널 등)에 잡혀 있어 $PORT 포트를 씁니다."
fi

# 접속 주소 안내 (Wi-Fi/핫스팟에 잡힌 사설 IP)
IPS=$(ifconfig 2>/dev/null | awk '/inet /{print $2}' \
      | grep -E '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' || true)

echo
echo "=================================================================="
echo " 폰 브라우저 주소창에 아래 주소 중 하나를 입력하세요:"
if [ -n "$IPS" ]; then
  for ip in $IPS; do echo "    https://$ip:$PORT/"; done
else
  echo "    (사설 IP 없음 — 핫스팟/와이파이 연결을 확인하세요)"
fi
echo
echo " 맥에서 테스트하려면:  https://127.0.0.1:$PORT/"
echo " * 인증서 경고가 뜨면 '고급 -> 계속 진행'(아이폰은 '웹사이트 방문')"
echo " * 방 만들기 -> 링크/코드를 친구에게 공유하면 같이 플레이!"
echo "=================================================================="
echo

# 2) 웹 서버(Vite)를 이 창에서 실행 (Ctrl+C 로 전체 종료)
#    --host 0.0.0.0 : IPv4 에 명시적으로 바인딩 (폰이 IPv4 로 들어온다)
#    --strictPort   : 위에서 확인한 포트를 그대로 쓰게 (조용히 옮겨가면 안내 주소와 어긋남)
cd "$CLIENT"
node node_modules/vite/bin/vite.js --host 0.0.0.0 --port "$PORT" --strictPort
