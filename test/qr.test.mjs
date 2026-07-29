import QRCode from '../client/node_modules/qrcode/lib/index.js'
import jsQR from 'jsqr'
import { makeChecker } from './harness.mjs'

/**
 * QR 왕복 테스트
 * -------------------------------------------------------------
 * QR 은 "만들어 놓고 눈으로는 맞는지 알 수 없는" 종류의 산출물이다.
 * 잘못 만들어도 화면에는 그럴싸한 흑백 격자가 보이고, 폰으로 찍을 때
 * 비로소 실패한다. 그래서 만든 뒤 **다시 디코드해서** 같은 문자열이
 * 나오는지 확인한다 (인코더/디코더가 서로 다른 구현이라 의미가 있다).
 */
const ok = makeChecker('QR 코드')

/** QR 모듈 격자를 RGBA 비트맵으로 (디코더에 먹이려고) */
function toBitmap(matrix, scale = 8, quiet = 4) {
  const n = matrix.size
  const w = (n + quiet * 2) * scale
  const data = new Uint8ClampedArray(w * w * 4).fill(255)
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!matrix.data[y * n + x]) continue // 0 = 흰색
      for (let dy = 0; dy < scale; dy++) {
        for (let dx = 0; dx < scale; dx++) {
          const px = ((y + quiet) * scale + dy) * w + ((x + quiet) * scale + dx)
          data[px * 4] = 0
          data[px * 4 + 1] = 0
          data[px * 4 + 2] = 0
        }
      }
    }
  }
  return { data, w }
}

const cases = [
  ['로컬 플레이 (핫스팟 IP)', 'https://172.20.10.3:5173/?ctrl=K7M2'],
  ['배포 주소', 'https://yorr-arcade.onrender.com/?ctrl=AB34'],
  ['요트 방 초대 링크', 'https://yorr-arcade.onrender.com/?room=K7M2QX'],
  ['긴 주소 + 포트', 'https://xxxx-yyyy-zzzz.ngrok-free.dev:443/?ctrl=WXYZ'],
]

ok.section('만든 QR 을 다시 디코드해서 같은 문자열이 나오는지')
for (const [label, url] of cases) {
  const matrix = QRCode.create(url, { errorCorrectionLevel: 'M' }).modules
  const { data, w } = toBitmap(matrix)
  const decoded = jsQR(data, w, w)
  ok(decoded?.data === url, `${label} — ${matrix.size}×${matrix.size} 모듈`, {
    expected: url,
    got: decoded?.data ?? null,
  })
}

ok.section('SVG 출력 (화면에 그대로 넣는 형태)')
const svg = await QRCode.toString(cases[0][1], { type: 'svg', margin: 2 })
ok(svg.startsWith('<svg') && svg.includes('</svg>'), 'SVG 문자열 생성')
ok(!svg.includes('<script'), 'SVG 안에 script 없음 (그대로 삽입해도 안전)')
ok(svg.includes('viewBox'), 'viewBox 있음 → 크기 반응형으로 넣을 수 있다')

process.exit(ok.done() === 0 ? 0 : 1)
