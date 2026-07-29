import { ask, connect, makeChecker, sleep, startServer, until } from './harness.mjs'

/**
 * 요트 턴제 방 통합 테스트
 * -------------------------------------------------------------
 * 서버에 소켓 3개를 붙여 한 판을 12라운드 끝까지 돌린다.
 * 여기서 지키려는 성질들:
 *   - 관전: 굴린 사람이 아닌 소켓도 "같은 주사위 눈"을 본다
 *   - 권위: 내 차례가 아니면 굴리기·킵·기록이 전부 무시된다
 *   - 진행: 한 바퀴 돌면 라운드 +1, 12라운드 뒤 종료 + 순위
 *   - 복구: 끊겨도 좌석 토큰으로 점수판째 돌아온다
 *   - 정체: 차례인 사람이 사라져도 서버가 대신 플레이해 판이 멈추지 않는다
 */

const PORT = 3971
const CATS = [
  'ones', 'twos', 'threes', 'fours', 'fives', 'sixes',
  'choice', 'fourKind', 'fullHouse', 'smallStraight', 'largeStraight', 'yacht',
]

const srv = await startServer(PORT)
const ok = makeChecker('요트 턴제 방')

try {
  ok.section('방 만들기 / 참가')
  const A = await connect(srv.url)
  const B = await connect(srv.url)
  const C = await connect(srv.url)

  const ackA = await ask(A, 'room:create', '정현')
  ok(ackA.ok === true, '방 생성')
  ok(typeof ackA.code === 'string' && ackA.code.length === 6, '초대 코드 6자리', ackA.code)
  ok(ackA.youId === 'p1', '방장 좌석 p1', ackA.youId)
  ok(typeof ackA.token === 'string' && ackA.token.length > 6, '재접속 토큰 발급')
  const CODE = ackA.code

  const ackB = await ask(B, 'room:join', CODE.toLowerCase(), '상은') // 소문자도 받아야 한다
  ok(ackB.ok === true && ackB.youId === 'p2', '소문자 코드로 참가 → p2', ackB)
  const ackC = await ask(C, 'room:join', CODE, '민서')
  ok(ackC.ok === true && ackC.youId === 'p3', '3번째 참가 → p3', ackC)
  ok((await ask(await connect(srv.url), 'room:join', 'ZZZZZZ', '없는방')).ok === false, '없는 코드 거절')

  await until(() => A.state?.players.length === 3)
  ok(A.state.players.length === 3, '방 상태에 3명')
  ok(A.state.maxPlayers === 6, '최대 6인', A.state.maxPlayers)
  ok(!('token' in A.state.players[0]), 'token 은 방 상태에 안 실린다 (자리 도둑 방지)')
  ok(!('socketId' in A.state.players[0]), 'socketId 도 안 실린다')

  ok.section('정원 초과')
  const extras = []
  for (let i = 0; i < 3; i++) {
    const s = await connect(srv.url)
    extras.push(s)
    await ask(s, 'room:join', CODE, 'x' + i)
  }
  const a7 = await ask(await connect(srv.url), 'room:join', CODE, '일곱')
  ok(a7.ok === false && /가득/.test(a7.error || ''), '7번째는 거절', a7)
  for (const s of extras) s.emit('room:leave')
  await until(() => A.state?.players.length === 3)
  ok(A.state.players.length === 3, '나간 사람은 대기실에서 제거')

  ok.section('게임 시작 / 턴 순서')
  B.emit('room:start')
  await sleep(150)
  ok(A.state.status === 'lobby', '방장 아닌 사람은 시작 못 함')
  A.emit('room:start')
  await until(() => A.state?.status === 'playing')
  ok(A.state.status === 'playing', '게임 시작')
  ok(A.state.turnId === 'p1', '첫 차례는 p1', A.state.turnId)
  ok(A.state.round === 1 && A.state.players[0].rollsLeft === 3, '라운드1 · 굴리기 3번')
  ok(A.state.deadline > Date.now(), '차례 마감시각 설정')

  ok.section('내 차례가 아니면 조작 무시')
  B.emit('game:roll')
  await sleep(150)
  ok(A.state.rollSeq === 0, 'p2 는 굴릴 수 없다', A.state.rollSeq)

  ok.section('굴리기 — 서버가 굴리고 모두가 같은 눈을 본다')
  /* 폰 흔들기 센서(onShake)는 한 제스처로 이벤트를 2~4번(간격 120ms) 낸다.
     그걸 굴리기 1회로 접지 못해 "3회 → 1회" 로 기회가 두 칸 날아갔던 버그의 회귀 테스트.
     멀티에서는 남은 횟수가 서버 값이라, 왕복 지연 동안 중복이 그대로 통과했다. */
  A.emit('game:roll')
  A.emit('game:roll') // 같은 제스처가 만든 중복
  A.emit('game:roll')
  await until(() => A.state?.rollSeq === 1)
  await sleep(250) // 뒤늦게 처리되는 중복이 없는지 확인할 시간
  ok(A.state.rollSeq === 1, '중복 요청 3건이 굴리기 1회로 접힌다', A.state.rollSeq)
  ok(A.state.players[0].rollsLeft === 2 && A.state.players[0].rolled === true, '기회는 하나만 줄어든다 (3→2)', A.state.players[0].rollsLeft)
  const dice1 = A.state.players[0].dice
  ok(dice1.length === 5 && dice1.every((d) => d >= 1 && d <= 6), '주사위 5개 1~6', dice1)
  await until(() => B.state?.rollSeq === 1 && C.state?.rollSeq === 1)
  ok(
    JSON.stringify(B.state.players[0].dice) === JSON.stringify(dice1) &&
      JSON.stringify(C.state.players[0].dice) === JSON.stringify(dice1),
    '관전자 둘 다 같은 눈을 본다',
    [B.state.players[0].dice, C.state.players[0].dice, dice1],
  )

  ok.section('킵 — 고정한 주사위는 다시 굴려도 안 바뀐다')
  A.emit('game:keep', { index: 0 })
  A.emit('game:keep', { index: 1 })
  await until(() => A.state?.players[0].kept[0] && A.state?.players[0].kept[1])
  ok(A.state.players[0].kept.join() === 'true,true,false,false,false', '0·1번 고정')
  await until(() => B.state?.players[0].kept[0] === true)
  ok(B.state.players[0].kept[0] === true, '관전자도 킵 상태를 본다')
  B.emit('game:keep', { index: 3 })
  await sleep(150)
  ok(A.state.players[0].kept[3] === false, '남이 내 주사위를 고정할 수 없다')

  const keptFaces = [dice1[0], dice1[1]]
  await sleep(400) // 실제 플레이는 굴리는 연출 때문에 이보다 느리다
  A.emit('game:roll')
  await until(() => A.state?.rollSeq === 2)
  const dice2 = A.state.players[0].dice
  ok(dice2[0] === keptFaces[0] && dice2[1] === keptFaces[1], '고정한 두 개는 그대로', [dice2, keptFaces])

  ok.section('굴리기는 3번까지')
  await sleep(400)
  A.emit('game:roll')
  await until(() => A.state?.rollSeq === 3)
  ok(A.state.players[0].rollsLeft === 0, '3번 다 씀')
  A.emit('game:roll')
  await sleep(150)
  ok(A.state.rollSeq === 3, '4번째 굴리기 무시')

  ok.section('점수 확정 — 점수는 서버가 계산 / 차례 넘김')
  const expectChoice = A.state.players[0].dice.reduce((a, b) => a + b, 0)
  A.emit('game:score', { categoryId: 'choice' })
  await until(() => A.state?.turnId === 'p2')
  ok(A.state.players[0].sheet.choice === expectChoice, `초이스 = 5개 합(${expectChoice})`)
  ok(A.state.players[0].total === expectChoice, '총점 반영')
  ok(A.state.round === 1, '아직 라운드 1')
  ok(A.state.players[1].dice.join() === '1,2,3,4,5', 'p2 판은 새로 깔림')
  await until(() => C.logs.length === 1)
  ok(C.logs[0]?.nickname === '정현' && C.logs[0]?.score === expectChoice, '기록 로그가 모두에게 방송', C.logs[0])

  ok.section('없는 족보 / 라운드 넘김')
  B.emit('game:roll')
  await until(() => B.state?.players[1].rolled === true)
  await sleep(100)
  B.emit('game:score', { categoryId: 'nope' })
  await sleep(150)
  ok(A.state.turnId === 'p2', '없는 족보는 무시')
  B.emit('game:score', { categoryId: 'choice' })
  await until(() => A.state?.turnId === 'p3')
  C.emit('game:roll')
  await until(() => C.state?.players[2].rolled === true)
  C.emit('game:score', { categoryId: 'choice' })
  await until(() => A.state?.round === 2)
  ok(A.state.round === 2 && A.state.turnId === 'p1', '한 바퀴 돌면 라운드 +1')

  ok.section('재접속 — 끊긴 뒤 토큰으로 자리 복귀')
  const savedSheet = JSON.stringify(A.state.players[1].sheet)
  B.disconnect()
  await until(() => A.state?.players[1].connected === false)
  ok(A.state.players[1].connected === false, 'p2 접속끊김 표시')
  ok(A.state.players.length === 3, '게임 중에는 자리를 남겨 둔다')
  const B2 = await connect(srv.url)
  const ackR = await ask(B2, 'room:rejoin', CODE, ackB.token)
  ok(ackR.ok === true && ackR.youId === 'p2', '토큰으로 p2 자리 복귀', ackR)
  await until(() => A.state?.players[1].connected === true)
  ok(JSON.stringify(A.state.players[1].sheet) === savedSheet, '점수판 그대로')
  ok((await ask(await connect(srv.url), 'room:rejoin', CODE, 'wrong')).ok === false, '틀린 토큰 거절')

  ok.section('남은 판 전부 진행 → 종료/순위')
  const clients = { p1: A, p2: B2, p3: C }
  let guard = 0
  while (A.state.status === 'playing' && guard++ < 200) {
    const turnId = A.state.turnId
    const s = clients[turnId]
    const p = A.state.players.find((x) => x.id === turnId)
    const seq = A.state.rollSeq
    await sleep(380) // 서버의 중복 방지 간격(350ms)보다 크게
    s.emit('game:roll')
    await until(() => A.state.rollSeq > seq)
    const t = A.state.turnSeq
    s.emit('game:score', { categoryId: CATS.find((c) => p.sheet[c] === null) })
    await until(() => A.state.turnSeq !== t || A.state.status !== 'playing')
  }
  ok(A.state.status === 'finished', '12라운드 후 종료', [A.state.status, A.state.round])
  ok(guard < 200, '무한루프 아님', guard)
  await until(() => A.finished !== null)
  const rk = A.finished?.ranking ?? []
  ok(rk.length === 3, '순위 3명 도착', rk)
  ok(rk[0].total >= rk[1].total && rk[1].total >= rk[2].total, '총점 내림차순', rk.map((r) => r.total))
  ok(rk[0].rank === 1, '1등 rank=1')
  ok(
    A.state.players.every((p) => CATS.every((c) => p.sheet[c] !== null)),
    '모두 12칸을 다 채웠다',
  )

  ok.section('다시 하기 → 대기실 초기화')
  C.emit('room:restart')
  await sleep(150)
  ok(A.state.status === 'finished', '방장 아닌 사람은 재시작 못 함')
  A.emit('room:restart')
  await until(() => A.state?.status === 'lobby')
  ok(A.state.players.every((p) => p.total === 0), '점수 초기화')
  ok(A.state.round === 1, '라운드 1')

  ok.section('차례인 사람이 사라져도 판이 멈추지 않는다')
  // 끊긴 사람의 차례는 짧게 기다린 뒤 서버가 대신 굴리고 기록한다
  const D = await connect(srv.url)
  const ackD = await ask(D, 'room:create', '나감이')
  const E = await connect(srv.url)
  await ask(E, 'room:join', ackD.code, '남음이')
  D.emit('room:start')
  await until(() => E.state?.status === 'playing')
  ok(E.state.turnId === 'p1', 'p1 차례로 시작')
  D.disconnect()
  await until(() => E.state?.players[0].connected === false)
  ok(E.state.turnMs < 45000, '끊긴 사람 차례는 제한시간이 짧아진다', E.state.turnMs)
  ok(await until(() => E.state?.rollSeq > 0, 25000), '서버가 대신 굴렸다')
  ok(await until(() => E.state?.turnId === 'p2', 25000), '차례가 넘어갔다', E.state?.turnId)
  ok(E.logs.at(-1)?.auto === true, '자동 기록으로 표시(auto=true)', E.logs.at(-1))
} finally {
  srv.stop()
}

process.exit(ok.done() === 0 ? 0 : 1)
