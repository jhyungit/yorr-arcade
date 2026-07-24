import { io, type Socket } from 'socket.io-client'

/**
 * 앱 전체가 공유하는 Socket.IO 클라이언트(싱글턴).
 *
 * io() 를 인자 없이 부르면 "현재 페이지와 같은 주소"로 연결한다.
 * 개발 중에는 vite.config.ts 의 프록시가 /socket.io 요청을
 * localhost:3001(요트 서버)로 넘겨준다.
 * → 폰에서도 5173 한 포트로만 접속하면 실시간 통신이 된다.
 */
export const socket: Socket = io({
  autoConnect: true,
  transports: ['websocket', 'polling'],
  // ngrok 무료 터널의 브라우저 경고 페이지를 우회 (polling 요청에 헤더 부착)
  extraHeaders: { 'ngrok-skip-browser-warning': 'true' },
})
