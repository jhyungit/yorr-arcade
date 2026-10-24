import { ask, connect, makeChecker, sleep, startServer, until } from './harness.mjs'

/**
 * 방 채팅 통합 테스트
 * -------------------------------------------------------------
 *   - 같은 방에만 간다 (다른 방 소켓은 못 받는다)
 *   - 이름·색은 서버 좌석 정보 기준 (클라가 보낸 값 무시)
 *   - 공백 제거 · 100자 자르기 · 빈 메시지 무시
 *   - 1초에 2개까지 — 넘치면 무시하고 본인에게만 안내
 *   - 입장/재접속 때 기록 전달, 입장·퇴장 시스템 메시지
 *   - 방이 사라지면 기록도 사라진다
 */

const PORT = 3974
const srv = await startServer(PORT)
const ok = makeChecker('방 채팅')

/** 채팅 이벤트를 쌓아 두는 소켓 */
async function chatter() {
  const s = await connect(srv.url)
  s.msgs = []
  s.history = null
  s.notices = []
  s.on('chat:msg', (m) => s.msgs.push(m))
  s.on('chat:history', (h) => {
    s.history = h
  })
  s.on('chat:notice', (n) => s.notices.push(n))
  return s
}
const said = (s) => s.msgs.filter((m) => !m.system)

try {
  const A = await chatter()
  const B = await chatter()
  const X = await chatter() // 다른 방
  const { code } = await ask(A, 'room:create', '정현')
  await ask(X, 'room:create', '딴방')
  await until(() => A.history !== null)
  ok(Array.isArray(A.history) && A.history.length === 0, '방 만들면 빈 기록')

  ok.section('입장 알림 · 같은 방에만')
  await ask(B, 'room:join', code, '상은')
  await until(() => A.msgs.length > 0)
  ok(A.msgs[0]?.system === true && /상은/.test(A.msgs[0].text), '입장 시스템 메시지', A.msgs[0])

  A.emit('chat:send', { text: 'hack' }) // 문자열 아님 → 무시
  A.emit('chat:send', '  안녕하세요  ')
  await until(() => said(B).length > 0)
  const m = said(B)[0]
  ok(m?.text === '안녕하세요', '앞뒤 공백 제거', m)
  ok(m?.playerId === 'p1' && m?.name === '정현' && m?.color === '#5B8DEF', '이름·색은 서버 좌석 기준', m)
  ok(typeof m?.id === 'string' && typeof m?.ts === 'number', 'id·ts 포함')
  ok(said(A).length === 1, '보낸 본인도 받는다')
  await sleep(100)
  ok(X.msgs.length === 0, '다른 방에는 안 간다', X.msgs)

  ok.section('빈 메시지 · 길이')
  await sleep(1100)
  B.emit('chat:send', '    ')
  B.emit('chat:send', 'ㅋ'.repeat(150))
  await until(() => said(A).length === 2)
  ok(said(A).length === 2, '빈 메시지는 무시')
  ok(said(A)[1]?.text.length === 100, '100자로 자른다', said(A)[1]?.text.length)

  ok.section('rate limit (1초 2개)')
  await sleep(1100)
  const before = said(A).length
  for (let i = 0; i < 4; i++) B.emit('chat:send', 'spam' + i)
  await until(() => B.notices.length >= 2)
  await sleep(100)
  ok(said(A).length - before === 2, '2개만 통과', said(A).length - before)
  ok(B.notices.length === 2, '초과분은 본인에게 안내', B.notices)
  ok(A.notices.length === 0, '안내는 다른 사람에게 안 간다')
  await sleep(1100)
  B.emit('chat:send', '다시 됨')
  ok(await until(() => said(A).at(-1)?.text === '다시 됨'), '1초 뒤엔 다시 보낼 수 있다')

  ok.section('입장·재접속 시 기록')
  const C = await chatter()
  const ackC = await ask(C, 'room:join', code, '민서')
  await until(() => C.history !== null)
  ok(C.history.some((h) => h.text === '안녕하세요'), '늦게 온 사람도 기록을 받는다')
  ok(!C.history.some((h) => h.system && /민서/.test(h.text)), '자기 입장 알림은 기록이 아니라 실시간으로')
  ok(await until(() => C.msgs.some((h) => h.system && /민서/.test(h.text))), '…그리고 실시간으로 한 번')

  ok.section('최근 50개만 · 재접속 시 기록')
  A.emit('room:start')
  await until(() => C.state?.status === 'playing')
  // 3명이 1초에 2개씩 → 50개를 넘길 만큼 (rate limit 안쪽)
  for (let i = 0; i < 9; i++) {
    for (const [s, n] of [[A, 'a'], [B, 'b'], [C, 'c']]) {
      s.emit('chat:send', n + i + '-1')
      s.emit('chat:send', n + i + '-2')
    }
    await sleep(1050)
  }
  ok(said(A).length > 50, '50개 넘게 오갔다', said(A).length)
  C.disconnect()
  ok(await until(() => A.msgs.at(-1)?.system && /민서.*끊/.test(A.msgs.at(-1).text)), '게임 중 끊김 알림')
  const C2 = await chatter()
  const r2 = await ask(C2, 'room:rejoin', code, ackC.token)
  ok(r2.ok === true, '토큰으로 재접속')
  await until(() => C2.history !== null)
  ok(C2.history.length === 50, '기록은 최근 50개만', C2.history.length)
  ok(/민서.*끊/.test(C2.history.at(-1)?.text), '마지막 기록 = 가장 최근(끊김 알림)', C2.history.at(-1))
  ok(await until(() => A.msgs.some((h) => h.system && /민서.*다시/.test(h.text))), '재접속 알림')

  ok.section('방이 사라지면 기록도 정리')
  A.emit('room:leave')
  B.emit('room:leave')
  C2.emit('room:leave')
  await sleep(200)
  const E = await chatter()
  const r = await ask(E, 'room:rejoin', code, 'anything')
  ok(r.ok === false, '모두 나가면 방이 사라진다 (기록은 방 객체에 붙어 함께 정리)')
} finally {
  srv.stop()
}

process.exit(ok.done() === 0 ? 0 : 1)
