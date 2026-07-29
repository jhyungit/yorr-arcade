import { ask, connect, makeChecker, sleep, startServer } from './harness.mjs'

/**
 * 폰 컨트롤러 ↔ 게임 화면 중계 테스트
 * -------------------------------------------------------------
 * "폰 연동이 안 되던" 회귀를 잡기 위한 테스트. 당시 원인은 둘이었다.
 *   ① 노트북이 disp:game 으로 'yacht' 를 안 보내서 폰 UI 가 'idle' 로 남았다
 *   ② 요트 화면에 ctrl:swing 리스너가 없어서 흔들어도 아무 일이 없었다
 * 서버는 중계만 하므로 여기서는 "중계가 되는지" 와 "게임 이름이 그대로 가는지" 를 본다.
 */

const PORT = 3972

const srv = await startServer(PORT)
const ok = makeChecker('폰 컨트롤러 중계')

try {
  const laptop = await connect(srv.url) // 게임 화면(display)
  const phone = await connect(srv.url) // 컨트롤러

  const swings = []
  const vibes = []
  let phoneGame = null
  laptop.on('ctrl:swing', (d) => swings.push(d))
  phone.on('disp:game', (d) => {
    phoneGame = d?.game
  })
  phone.on('ctrl:hit', (d) => vibes.push(d))

  ok.section('페어링')
  const pc = await ask(laptop, 'pair:create')
  ok(typeof pc.code === 'string' && pc.code.length === 4, '화면이 4자리 페어링 코드 발급', pc.code)
  ok((await ask(phone, 'pair:join', pc.code)).ok === true, '폰이 코드로 연결')
  ok((await ask(await connect(srv.url), 'pair:join', 'ZZZZ')).ok === false, '없는 코드 거절')

  ok.section('화면 → 폰: 지금 어느 게임인지 (disp:game)')
  for (const g of ['yacht', 'pingpong', 'rhythm', 'reaction', 'slasher', 'idle']) {
    laptop.emit('disp:game', { game: g })
    await sleep(60)
    ok(phoneGame === g, `game='${g}' 가 폰까지 전달`, phoneGame)
  }

  ok.section('폰 → 화면: 흔들기 (ctrl:swing)')
  phone.emit('ctrl:swing')
  await sleep(150)
  ok(swings.length === 1, '스윙 1회 도착', swings)
  ok(swings[0]?.player === 1, '몇 번째 폰인지 실려 온다', swings[0])

  ok.section('화면 → 폰: 진동 신호 (game:hit)')
  // 요트 주사위 착지는 player 를 안 실어 보낸다 = "붙어 있는 폰 전부" 라는 뜻
  laptop.emit('game:hit', { kind: 'dice' })
  await sleep(150)
  ok(vibes.length === 1 && vibes[0].kind === 'dice', '폰이 진동 신호 수신', vibes)
  ok(vibes[0].player === undefined, 'player 미지정 = 모든 폰 대상', vibes[0])

  ok.section('화면이 나가면 폰에 알린다')
  const bye = new Promise((r) => phone.once('display:disconnected', () => r(true)))
  laptop.disconnect()
  ok((await Promise.race([bye, sleep(1500)])) === true, '폰이 display:disconnected 수신')
} finally {
  srv.stop()
}

process.exit(ok.done() === 0 ? 0 : 1)
