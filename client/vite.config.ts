import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import basicSsl from '@vitejs/plugin-basic-ssl'

// Vite 설정.
// - react(): JSX/TSX + Fast Refresh
// - tailwindcss(): Tailwind v4 (별도 config 파일 없이 CSS의 @import 로 동작)
// - basicSsl(): 로컬에서 https 로 뜨게 해주는 자체 서명 인증서 플러그인.
//   (DeviceMotion 센서는 https(보안 컨텍스트)에서만 동작하므로 로컬도 https 로 띄운다.)
export default defineConfig({
  plugins: [react(), tailwindcss(), basicSsl()],
  build: {
    rollupOptions: {
      output: {
        // three 는 게임 코드보다 훨씬 크고 거의 안 바뀐다 → 별도 청크로 빼면
        // 게임을 고쳐도 폰이 three 를 다시 안 받는다 (핫스팟/셀룰러에서 체감 큼).
        manualChunks: { three: ['three'] },
      },
    },
  },
  // 시작할 때 화면을 지우지 않는다 — 로컬플레이.bat 이 먼저 출력한
  // "노트북용 / 폰용" 접속 주소 두 줄이 지워지면 안 된다.
  clearScreen: false,
  server: {
    // 0.0.0.0 로 바인딩 → 같은 와이파이의 폰에서 노트북 IP로 직접 접속 가능.
    // (ngrok 을 쓰면 인터넷 어디서든 접속 가능하지만, 같은 공유기라면 이 방법이 더 빠름)
    host: true,
    port: 5173,
    // ngrok / cloudflared 같은 터널이 만들어주는 임의의 호스트 주소를 허용.
    // 프로토타입이라 편의상 모든 호스트를 허용한다. (운영에서는 특정 도메인만 넣는 게 안전)
    allowedHosts: true,
    // Socket.IO 서버(localhost:3001)로 프록시.
    // → 폰은 5173 한 포트로만 접속하면 되고(추가 포트 노출 X), CORS 문제도 없다.
    //   /socket.io 로 들어오는 (WebSocket 포함) 요청을 서버로 넘긴다.
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true, // WebSocket 프록시 켜기
        changeOrigin: true,
      },
    },
  },
})
