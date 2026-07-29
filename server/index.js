// =============================================================
//  요트 다이스 실시간 멀티플레이 서버 (Socket.IO)
// -------------------------------------------------------------
//  역할:
//   - 방 만들기 / 6자리 입장코드로 참가 / 대기실 (최대 6인)
//   - "턴제" 진행 — 한 사람씩 돌아가며 3번 굴리고 한 칸을 확정한다
//   - 모든 플레이어 상태(주사위/킵/점수/총점)를 방 전체에 실시간 브로드캐스트
//
//  설계 메모:
//   - 주사위는 "서버가" 굴린다. 이유가 둘 있다.
//     ① 관전 — 지금 차례인 사람의 주사위를 모두가 똑같이 봐야 한다.
//        클라가 굴려 보고하면 도착 전까지 남들 화면이 비고, 순서도 어긋난다.
//     ② 점수도 서버가 계산한다 (클라가 보낸 점수를 믿지 않는다).
//   - 자리(좌석) id 는 p1~p6 으로 고정. 소켓 id 는 재접속하면 바뀌므로
//     플레이어 식별에 쓰지 않는다. 재접속은 본인만 아는 token 으로 한다.
//   - 방 상태는 서버 메모리에만 저장(DB 없음). 서버 재시작하면 초기화.
// =============================================================

import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs'
import express from 'express'
import { Server } from 'socket.io'

const PORT = process.env.PORT || 3001
const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 빌드된 클라이언트(client/dist)가 있으면 이 서버가 앱까지 서빙 → 원격(ngrok)에서 한 포트로.
const DIST = path.resolve(__dirname, '../client/dist')

// 12개 족보 중 "윗줄"(보너스 계산용)
const UPPER_IDS = ['ones', 'twos', 'threes', 'fours', 'fives', 'sixes']
const ALL_CATEGORY_IDS = [
  ...UPPER_IDS,
  'choice',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'yacht',
]
const TOTAL_ROUNDS = ALL_CATEGORY_IDS.length // 12
const MAX_ROLLS = 3
const UPPER_BONUS_THRESHOLD = 63
const UPPER_BONUS_POINTS = 35
const REACTION_TYPES = ['like', 'laugh', 'shock', 'clap', 'gg']

const MAX_PLAYERS = 6
const ROOM_CODE_LEN = 6 // 초대 코드 6자리
const SEAT_IDS = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']

// 턴 제한시간. 다 쓰면 서버가 대신 굴리고 가장 점수가 높은 칸에 기록한다.
//  → 한 사람이 폰을 놓고 가도 게임이 멈추지 않는다.
const TURN_MS = 45000
// 접속이 끊긴 사람의 차례는 오래 기다리지 않는다 (재접속 여유만 준다)
const AFK_TURN_MS = 8000
// 자동으로 굴린 뒤 "구르는 걸 볼 시간"을 주고 나서 기록한다
const AUTO_ROLL_VIEW_MS = 2600

/* 같은 차례에서 굴리기 요청이 이보다 촘촘히 오면 중복으로 보고 무시한다.
   폰 흔들기 센서는 한 번의 제스처로 이벤트를 2~4번(간격 120ms) 발생시킨다.
   클라이언트에도 디바운스가 있지만(useRollInput), 남은 횟수는 서버가 가진 값이라
   여기서도 막아 두지 않으면 클라 버그 하나로 기회가 통째로 날아간다.
   굴리는 연출이 1.5~3.2초라 정상 플레이가 이 간격에 걸릴 일은 없다. */
const MIN_ROLL_GAP_MS = 350

// code -> Room
const rooms = new Map()

// 폰 컨트롤러 페어링: code -> { displayId, controllers: Set<socketId> }
//  한 노트북(display)에 여러 폰(controller)을 붙일 수 있게 컨트롤러 목록을 추적한다.
//  (연결 수를 display 에 실시간으로 알려 UI 에 "연결된 폰 N개" 를 띄운다)
const pairs = new Map()

// --- 유틸 ---

/** 6자리 초대 코드 (헷갈리는 글자 0,O,1,I 제외) */
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from(
      { length: ROOM_CODE_LEN },
      () => alphabet[Math.floor(Math.random() * alphabet.length)],
    ).join('')
  } while (rooms.has(code)) // 중복 방지
  return code
}

/** 재접속용 비밀 토큰 — 본인에게만 보낸다(방 상태에는 안 실린다) */
function makeToken() {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6)
}

/** 폰 컨트롤러 페어링용 4자리 코드 (게임 방 코드와 별개) */
function makePairCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (io.sockets.adapter.rooms.has('pair:' + code))
  return code
}

/** 온라인 핑퐁 매치 코드 (pp: 방) */
function makePpCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (io.sockets.adapter.rooms.has('pp:' + code))
  return code
}

/** 매치 방 코드 (접두어별: 'rt'=리듬탭, 'rx'=반응속도배틀 등). pp 와 같은 규칙. */
function makeMatchCode(prefix) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (io.sockets.adapter.rooms.has(prefix + ':' + code))
  return code
}

/** 빈 점수판 */
function emptySheet() {
  const sheet = {}
  for (const id of ALL_CATEGORY_IDS) sheet[id] = null
  return sheet
}

/** 주사위 5개로 이 족보에 기록하면 몇 점인지 (client/src/game/yacht.ts 와 같은 규칙) */
function scoreFor(id, values) {
  const counts = [0, 0, 0, 0, 0, 0, 0]
  for (const v of values) counts[v] += 1
  const sum = values.reduce((a, b) => a + b, 0)
  const has = (arr) => arr.every((n) => counts[n] > 0)

  switch (id) {
    case 'ones':
      return 1 * counts[1]
    case 'twos':
      return 2 * counts[2]
    case 'threes':
      return 3 * counts[3]
    case 'fours':
      return 4 * counts[4]
    case 'fives':
      return 5 * counts[5]
    case 'sixes':
      return 6 * counts[6]
    case 'choice':
      return sum
    case 'fourKind':
      return counts.some((c) => c >= 4) ? sum : 0
    case 'fullHouse':
      return counts.some((c) => c === 3) && counts.some((c) => c === 2) ? sum : 0
    case 'smallStraight':
      return has([1, 2, 3, 4]) || has([2, 3, 4, 5]) || has([3, 4, 5, 6]) ? 15 : 0
    case 'largeStraight':
      return has([1, 2, 3, 4, 5]) || has([2, 3, 4, 5, 6]) ? 30 : 0
    case 'yacht':
      return counts.some((c) => c === 5) ? 50 : 0
    default:
      return 0
  }
}

/**
 * 시간이 다 됐을 때 대신 고를 칸.
 * 남은 칸 중 점수가 가장 높은 곳. 전부 0점이면 정의 순서상 앞쪽(에이스 등 손실이 작은 칸).
 */
function bestCategory(player) {
  let best = null
  let bestScore = -1
  for (const id of ALL_CATEGORY_IDS) {
    if (player.sheet[id] !== null) continue
    const s = scoreFor(id, player.dice)
    if (s > bestScore) {
      best = id
      bestScore = s
    }
  }
  return best
}

/** 총점 계산 (윗줄 63점 이상이면 보너스 +35) */
function computeTotal(sheet) {
  let base = 0
  for (const id of ALL_CATEGORY_IDS) base += sheet[id] ?? 0
  let upper = 0
  for (const id of UPPER_IDS) upper += sheet[id] ?? 0
  const bonus = upper >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0
  return base + bonus
}

/** 새 플레이어 객체 (id 는 좌석 p1~p6, token 은 재접속용 비밀값) */
function makePlayer(seatId, nickname, socketId) {
  return {
    id: seatId,
    token: makeToken(),
    socketId,
    nickname: String(nickname || '').trim().slice(0, 12) || '익명',
    connected: true,
    sheet: emptySheet(),
    dice: [1, 2, 3, 4, 5], // 지금 판에 놓인 주사위
    kept: [false, false, false, false, false], // 남기기로 한 주사위
    rollsLeft: MAX_ROLLS,
    rolled: false, // 이번 차례에 한 번이라도 굴렸는가
    lastRollAt: 0, // 중복 굴리기 요청을 걸러내기 위한 시각
    total: 0,
  }
}

/** 비어 있는 좌석 id 하나 (없으면 null) */
function freeSeat(room) {
  return SEAT_IDS.find((id) => !room.players.some((p) => p.id === id)) ?? null
}

/** 지금 차례인 플레이어 (대기실/종료 상태면 undefined) */
function currentPlayer(room) {
  return room.status === 'playing' ? room.players[room.turn] : undefined
}

/** 클라이언트에 보낼 방 상태(그대로 전체 전송 → 클라는 이걸로 화면 렌더) */
function roomState(room) {
  const cur = currentPlayer(room)
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status, // 'lobby' | 'playing' | 'finished'
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    maxPlayers: MAX_PLAYERS,
    turnId: cur ? cur.id : null, // 지금 차례인 좌석
    turnSeq: room.turnSeq, // 차례가 넘어갈 때마다 +1 (클라: 판 리셋)
    rollSeq: room.rollSeq, // 굴릴 때마다 +1 (클라: 굴리기 연출 재생)
    deadline: room.deadline ?? null, // 이번 차례 마감(epoch ms)
    turnMs: room.turnMs, // 진행바 계산용 총 길이
    players: room.players.map((p) => ({
      // token/socketId 는 절대 내보내지 않는다 (남의 자리를 뺏을 수 있다)
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      sheet: p.sheet,
      dice: p.dice,
      kept: p.kept,
      rollsLeft: p.rollsLeft,
      rolled: p.rolled,
      total: p.total,
    })),
  }
}

/** 방 전체에 최신 상태 방송 */
function broadcast(io, room) {
  io.to(room.code).emit('room:state', roomState(room))
}

/** 총점 순위 (동점은 같은 등수) */
function ranking(room) {
  const sorted = [...room.players].sort((a, b) => b.total - a.total)
  let rank = 0
  let prev = null
  return sorted.map((p, i) => {
    if (prev === null || p.total !== prev) rank = i + 1
    prev = p.total
    return { id: p.id, nickname: p.nickname, total: p.total, rank }
  })
}

// --- 턴 진행 ---

function clearTurnTimer(room) {
  if (room.timer) {
    clearTimeout(room.timer)
    room.timer = null
  }
}

/**
 * 이번 차례의 제한시간을 걸어 둔다.
 * 끊긴 사람이면 짧게(재접속 여유만) 주고, 시간이 다 되면 서버가 대신 플레이한다.
 */
function armTurnTimer(io, room) {
  clearTurnTimer(room)
  const p = currentPlayer(room)
  if (!p) return
  const ms = p.connected ? TURN_MS : AFK_TURN_MS
  room.turnMs = ms
  room.deadline = Date.now() + ms
  const seq = room.turnSeq
  room.timer = setTimeout(() => {
    room.timer = null
    if (room.turnSeq !== seq) return // 그 사이에 차례가 넘어갔다
    autoPlay(io, room)
  }, ms + 150)
}

/** 차례 시작 — 판을 새로 깔고 굴리기 3번을 준다 */
function beginTurn(io, room) {
  const p = currentPlayer(room)
  if (!p) return
  p.dice = [1, 2, 3, 4, 5]
  p.kept = [false, false, false, false, false]
  p.rollsLeft = MAX_ROLLS
  p.rolled = false
  p.lastRollAt = 0
  room.turnSeq += 1
  armTurnTimer(io, room)
}

/** 실제로 굴린다 — kept 인 주사위는 그대로, 나머지만 새로 */
function rollDice(room, p) {
  p.lastRollAt = Date.now()
  p.dice = p.dice.map((v, i) => (p.kept[i] ? v : 1 + Math.floor(Math.random() * 6)))
  p.rollsLeft = Math.max(0, p.rollsLeft - 1)
  p.rolled = true
  room.rollSeq += 1
}

/** 점수 확정 → 다음 차례로 */
function applyScore(io, room, p, categoryId, auto) {
  const score = scoreFor(categoryId, p.dice)
  p.sheet[categoryId] = score
  p.total = computeTotal(p.sheet)
  io.to(room.code).emit('room:log', {
    seq: room.rollSeq * 100 + room.turnSeq, // 화면 표시용 고유 키
    playerId: p.id,
    nickname: p.nickname,
    categoryId,
    score,
    auto: !!auto,
    round: room.round,
  })
  advanceTurn(io, room)
}

/** 시간 초과/접속 끊김 — 서버가 대신 굴리고 가장 높은 칸에 기록 */
function autoPlay(io, room) {
  const p = currentPlayer(room)
  if (!p) return
  if (!p.rolled) {
    // 한 번도 안 굴렸으면 굴려는 준다. 구르는 연출을 볼 시간을 주고 기록.
    rollDice(room, p)
    broadcast(io, room)
    const seq = room.turnSeq
    room.timer = setTimeout(() => {
      room.timer = null
      if (room.turnSeq !== seq) return
      const cur = currentPlayer(room)
      if (cur) applyScore(io, room, cur, bestCategory(cur), true)
    }, AUTO_ROLL_VIEW_MS)
    return
  }
  applyScore(io, room, p, bestCategory(p), true)
}

/** 다음 사람 차례로. 한 바퀴 돌면 라운드 +1, 12라운드를 다 돌면 종료 */
function advanceTurn(io, room) {
  clearTurnTimer(room)
  let turn = room.turn + 1
  let round = room.round
  if (turn >= room.players.length) {
    turn = 0
    round += 1
  }

  if (round > TOTAL_ROUNDS) {
    room.status = 'finished'
    room.deadline = null
    room.turnSeq += 1
    io.to(room.code).emit('room:finished', { ranking: ranking(room) })
    broadcast(io, room)
    return
  }

  room.turn = turn
  room.round = round
  beginTurn(io, room)
  broadcast(io, room)
}

/** 대기실로 되돌리기 (새 게임 준비) */
function resetRoom(room) {
  clearTurnTimer(room)
  room.status = 'lobby'
  room.round = 1
  room.turn = 0
  room.deadline = null
  room.turnMs = TURN_MS
  for (const p of room.players) {
    p.sheet = emptySheet()
    p.dice = [1, 2, 3, 4, 5]
    p.kept = [false, false, false, false, false]
    p.rollsLeft = MAX_ROLLS
    p.rolled = false
    p.total = 0
  }
}

// --- 서버 시작 ---

const app = express()
app.get('/health', (_req, res) => res.type('text').send('ok'))

// 빌드 결과가 있으면 정적 서빙 + SPA 폴백 (원격 배포용)
const hasDist = fs.existsSync(path.join(DIST, 'index.html'))
if (hasDist) {
  app.use(express.static(DIST))
  app.get('*', (_req, res) => res.sendFile(path.join(DIST, 'index.html')))
}

const httpServer = createServer(app)

const io = new Server(httpServer, {
  cors: { origin: '*' }, // 프로토타입이라 전체 허용
})

io.on('connection', (socket) => {
  // 이 소켓이 속한 방 코드 (나갈 때 정리용)
  let joinedCode = null

  // ===== 폰 컨트롤러 페어링 (노트북=화면 / 폰=스윙 컨트롤러) =====
  let pairCode = null
  let pairRole = null // 'display' | 'controller'
  let pairPlayer = 1 // 컨트롤러 순번 (1=P1, 2=P2)

  /** 노트북(게임 화면)이 페어링 코드 발급 */
  socket.on('pair:create', (ack) => {
    const code = makePairCode()
    pairCode = code
    pairRole = 'display'
    socket.join('pair:' + code)
    pairs.set(code, { displayId: socket.id, controllers: new Set() })
    ack?.({ code })
  })

  /** 폰(컨트롤러)이 코드로 연결 (여러 대 가능) */
  socket.on('pair:join', (rawCode, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const entry = pairs.get(code)
    if (!entry) {
      ack?.({ ok: false, error: '연결할 게임을 찾을 수 없어요. 코드를 확인하세요.' })
      return
    }
    pairCode = code
    pairRole = 'controller'
    socket.join('pair:' + code)
    entry.controllers.add(socket.id)
    // 순번(플레이어 번호) = 현재까지 붙은 컨트롤러 수 (1,2,3,…)
    pairPlayer = entry.controllers.size
    const count = entry.controllers.size
    // display(및 다른 컨트롤러)에 "새로 연결됨 + 현재 연결 수" 알림
    socket.to('pair:' + code).emit('ctrl:connected', { player: pairPlayer, count })
    ack?.({ ok: true, player: pairPlayer, count })
  })

  /** 폰 스윙 → 같은 페어링의 노트북으로 중계 (누가 눌렀는지 player 포함) */
  socket.on('ctrl:swing', () => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:swing', { player: pairPlayer })
  })

  /* ── 입력 지연 측정 (노트북 ↔ 폰 왕복) ──
     노트북이 ping 을 던지면 폰이 그대로 pong 으로 돌려준다. 노트북은 왕복 시간의
     절반을 "폰 입력이 늦게 도착하는 시간"으로 본다. 서버는 내용을 안 보고 중계만. */
  socket.on('ctrl:ping', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:ping', data)
  })
  socket.on('ctrl:pong', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:pong', { ...data, player: pairPlayer })
  })

  /** 폰 슬라이스(터치패드 좌표) → 노트북 슬래셔로 중계 ({x,y: 0~1 정규화, t:'down'|'move'|'up'}) */
  socket.on('ctrl:slash', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:slash', { ...data, player: pairPlayer })
  })

  /** 폰 모션 조준(기울기) → 노트북 슬래셔 블레이드 위치로 중계 ({x,y: 0~1 정규화}) */
  socket.on('ctrl:aim', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:aim', { ...data, player: pairPlayer })
  })

  /** 노트북 → 폰: 실제로 공을 맞춘 순간 진동/피드백 신호 중계 ({player, kind}) */
  socket.on('game:hit', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('ctrl:hit', data)
  })

  /** 노트북 → 폰: 어떤 게임의 컨트롤러인지 알려서 폰 UI 를 맞춘다 ({game}) */
  socket.on('disp:game', (data) => {
    if (pairCode) socket.to('pair:' + pairCode).emit('disp:game', data)
  })

  /** 노트북(리듬 스윙) → 폰: 매 박 신호 → 폰이 진동으로 비트를 손에 전달 */
  socket.on('game:beat', () => {
    if (pairCode) socket.to('pair:' + pairCode).emit('game:beat')
  })

  // ===== 온라인 1:1 매치 (A=host 시뮬 / B=guest) =====
  let ppCode = null

  socket.on('pp:create', (ack) => {
    const code = makePpCode()
    ppCode = code
    socket.join('pp:' + code)
    ack?.({ code })
  })

  socket.on('pp:join', (rawCode, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = io.sockets.adapter.rooms.get('pp:' + code)
    if (!room || room.size === 0) {
      ack?.({ ok: false, error: '방을 찾을 수 없어요. 코드를 확인하세요.' })
      return
    }
    if (room.size >= 2) {
      ack?.({ ok: false, error: '이미 꽉 찬 방이에요.' })
      return
    }
    ppCode = code
    socket.join('pp:' + code)
    socket.to('pp:' + code).emit('pp:opponent_joined') // 호스트에게 알림
    ack?.({ ok: true })
  })

  /** 호스트가 만든 권위 상태를 상대에게 중계 */
  socket.on('pp:state', (data) => {
    if (ppCode) socket.to('pp:' + ppCode).emit('pp:state', data)
  })
  /** 게스트 스윙을 호스트에게 중계 */
  socket.on('pp:swing', () => {
    if (ppCode) socket.to('pp:' + ppCode).emit('pp:swing')
  })
  /** 매치 상대에게 이탈 알림 */
  socket.on('disconnect', () => {
    if (ppCode) socket.to('pp:' + ppCode).emit('pp:left')
  })

  /** 페어링 상대에게 연결 종료 알림 (+ 현재 연결 수) */
  socket.on('disconnect', () => {
    if (!pairCode) return
    const entry = pairs.get(pairCode)
    if (pairRole === 'controller') {
      if (entry) entry.controllers.delete(socket.id)
      socket
        .to('pair:' + pairCode)
        .emit('ctrl:disconnected', { player: pairPlayer, count: entry ? entry.controllers.size : 0 })
    } else if (pairRole === 'display') {
      // 노트북(화면)이 나가면 컨트롤러들에 알리고 페어링 정리
      socket.to('pair:' + pairCode).emit('display:disconnected')
      pairs.delete(pairCode)
    }
  })

  // ===== 리듬 탭 온라인 1:1 (rt:*) =====
  //  같은 시드/난이도의 "완전히 같은 곡"을 둘이 플레이하고 점수를 비교.
  //  각자 자기 화면에서 판정 → 진행상황(점수/콤보/정확도)만 서로 중계.
  let rtCode = null
  socket.on('rt:create', (ack) => {
    const code = makeMatchCode('rt')
    rtCode = code
    socket.join('rt:' + code)
    ack?.({ code })
  })
  socket.on('rt:join', (rawCode, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = io.sockets.adapter.rooms.get('rt:' + code)
    if (!room || room.size === 0) return ack?.({ ok: false, error: '방을 찾을 수 없어요. 코드를 확인하세요.' })
    if (room.size >= 2) return ack?.({ ok: false, error: '이미 꽉 찬 방이에요.' })
    rtCode = code
    socket.join('rt:' + code)
    socket.to('rt:' + code).emit('rt:opponent_joined') // 호스트에게 알림
    ack?.({ ok: true })
  })
  /** 호스트가 고른 곡(시드/난이도/시작시각)을 상대에게 전파 */
  socket.on('rt:start', (data) => {
    if (rtCode) socket.to('rt:' + rtCode).emit('rt:start', data)
  })
  /** 진행 상황(점수/콤보/정확도/완료) 서로 중계 */
  socket.on('rt:progress', (data) => {
    if (rtCode) socket.to('rt:' + rtCode).emit('rt:progress', data)
  })
  socket.on('disconnect', () => {
    if (rtCode) socket.to('rt:' + rtCode).emit('rt:left')
  })

  // ===== 반응속도 배틀 온라인 1:1 (rx:*) — 호스트가 신호 타이밍을 관장 =====
  //  host 가 라운드마다 랜덤 대기 후 신호를 쏜다. 각자 자기 신호부터의 반응(ms)을
  //  측정해 host 로 보고 → host 가 승패 판정 후 결과를 다시 뿌린다.
  let rxCode = null
  socket.on('rx:create', (ack) => {
    const code = makeMatchCode('rx')
    rxCode = code
    socket.join('rx:' + code)
    ack?.({ code })
  })
  socket.on('rx:join', (rawCode, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = io.sockets.adapter.rooms.get('rx:' + code)
    if (!room || room.size === 0) return ack?.({ ok: false, error: '방을 찾을 수 없어요. 코드를 확인하세요.' })
    if (room.size >= 2) return ack?.({ ok: false, error: '이미 꽉 찬 방이에요.' })
    rxCode = code
    socket.join('rx:' + code)
    socket.to('rx:' + code).emit('rx:opponent_joined')
    ack?.({ ok: true })
  })
  /** host→guest: 라운드 대기 시작 알림 */
  socket.on('rx:arm', (data) => {
    if (rxCode) socket.to('rx:' + rxCode).emit('rx:arm', data)
  })
  /** host→guest: 신호! (동시에 host 도 자기 화면에서 신호 표시) */
  socket.on('rx:signal', () => {
    if (rxCode) socket.to('rx:' + rxCode).emit('rx:signal')
  })
  /** guest→host: 내 반응 보고 ({ms} 또는 {falseStart:true}) */
  socket.on('rx:react', (data) => {
    if (rxCode) socket.to('rx:' + rxCode).emit('rx:react', data)
  })
  /** host→guest: 라운드 결과/점수 */
  socket.on('rx:round', (data) => {
    if (rxCode) socket.to('rx:' + rxCode).emit('rx:round', data)
  })
  socket.on('disconnect', () => {
    if (rxCode) socket.to('rx:' + rxCode).emit('rx:left')
  })

  // ===== 요트 다이스 턴제 방 (room:*) =====
  //  joinedCode = 내가 들어간 방 코드 / mySeat = 내 좌석 id(p1~p6)
  let mySeat = null

  /** 내 방/내 플레이어를 한 번에 (없으면 null) */
  function ctx() {
    const room = rooms.get(joinedCode)
    if (!room) return null
    const player = room.players.find((p) => p.id === mySeat)
    if (!player) return null
    return { room, player }
  }

  /** 지금 내 차례인가 (조작 요청을 받아 줄지 판단) */
  function myTurn(room, player) {
    return room.status === 'playing' && currentPlayer(room)?.id === player.id
  }

  /** 방 만들기 → 6자리 초대 코드 발급 + 바로 입장 */
  socket.on('room:create', (nickname, ack) => {
    const code = makeRoomCode()
    const host = makePlayer('p1', nickname, socket.id)
    const room = {
      code,
      hostId: host.id,
      status: 'lobby',
      round: 1,
      turn: 0,
      turnSeq: 0,
      rollSeq: 0,
      deadline: null,
      turnMs: TURN_MS,
      timer: null,
      players: [host],
    }
    rooms.set(code, room)
    socket.join(code)
    joinedCode = code
    mySeat = host.id
    ack?.({ ok: true, code, youId: host.id, token: host.token })
    broadcast(io, room)
  })

  /** 초대 코드로 참가 */
  socket.on('room:join', (rawCode, nickname, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = rooms.get(code)
    if (!room) {
      ack?.({ ok: false, error: '방을 찾을 수 없어요. 코드를 확인해 주세요.' })
      return
    }
    if (room.status !== 'lobby') {
      ack?.({ ok: false, error: '이미 시작한 방이에요.' })
      return
    }
    const seat = room.players.length >= MAX_PLAYERS ? null : freeSeat(room)
    if (!seat) {
      ack?.({ ok: false, error: `방이 가득 찼어요. (최대 ${MAX_PLAYERS}명)` })
      return
    }
    const p = makePlayer(seat, nickname, socket.id)
    room.players.push(p)
    socket.join(code)
    joinedCode = code
    mySeat = p.id
    ack?.({ ok: true, code, youId: p.id, token: p.token })
    broadcast(io, room)
  })

  /**
   * 재접속 — 폰이 잠기거나 네트워크가 끊기면 소켓 id 가 바뀐다.
   * 발급받은 token 으로 원래 좌석을 되찾는다 (게임 중에도 가능).
   */
  socket.on('room:rejoin', (rawCode, token, ack) => {
    const code = String(rawCode || '').toUpperCase().trim()
    const room = rooms.get(code)
    if (!room) {
      ack?.({ ok: false, error: '방이 사라졌어요.' })
      return
    }
    const p = room.players.find((pl) => pl.token === token)
    if (!p) {
      ack?.({ ok: false, error: '자리를 찾을 수 없어요.' })
      return
    }
    p.socketId = socket.id
    p.connected = true
    socket.join(code)
    joinedCode = code
    mySeat = p.id
    ack?.({ ok: true, code, youId: p.id, token: p.token })
    // 끊긴 사이 짧게 걸려 있던 제한시간을 원래대로 돌려준다
    if (myTurn(room, p)) armTurnTimer(io, room)
    broadcast(io, room)
  })

  /** 게임 시작 (방장만) */
  socket.on('room:start', () => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    if (room.hostId !== player.id || room.status !== 'lobby') return
    if (room.players.length < 1) return
    resetRoom(room)
    room.status = 'playing'
    beginTurn(io, room)
    broadcast(io, room)
  })

  /** 굴리기 — 주사위는 서버가 굴린다 (모두가 같은 눈을 본다) */
  socket.on('game:roll', () => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    if (!myTurn(room, player)) return
    if (player.rollsLeft <= 0) return
    // 한 번의 흔들기가 만든 중복 요청 — 조용히 무시 (기회를 먹지 않는다)
    if (Date.now() - player.lastRollAt < MIN_ROLL_GAP_MS) return
    rollDice(room, player)
    broadcast(io, room)
  })

  /** 주사위 고정/해제 (내 차례 · 한 번은 굴린 뒤에만) */
  socket.on('game:keep', ({ index } = {}) => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    if (!myTurn(room, player) || !player.rolled) return
    const i = Number(index)
    if (!Number.isInteger(i) || i < 0 || i > 4) return
    player.kept[i] = !player.kept[i]
    broadcast(io, room)
  })

  /** 점수 확정 → 다음 사람 차례. 점수는 서버가 계산한다 */
  socket.on('game:score', ({ categoryId } = {}) => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    if (!myTurn(room, player) || !player.rolled) return
    if (!ALL_CATEGORY_IDS.includes(categoryId)) return
    if (player.sheet[categoryId] !== null) return // 이미 채운 칸
    applyScore(io, room, player, categoryId, false)
  })

  /** 리액션 → 방 전체에 중계 */
  socket.on('reaction:send', ({ type } = {}) => {
    const c = ctx()
    if (!c || !REACTION_TYPES.includes(type)) return
    io.to(c.room.code).emit('reaction:recv', { playerId: c.player.id, type })
  })

  /** 다시 하기 (방장만) → 대기실로 */
  socket.on('room:restart', () => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    if (room.hostId !== player.id) return
    resetRoom(room)
    broadcast(io, room)
  })

  /** 방에서 나가기 (허브로 돌아감) */
  socket.on('room:leave', () => {
    const c = ctx()
    joinedCode = null
    mySeat = null
    if (!c) return
    const { room, player } = c
    socket.leave(room.code)
    dropPlayer(io, room, player, true)
  })

  /** 연결 종료 — 자리는 남겨 두고(재접속 가능) 끊긴 것으로 표시 */
  socket.on('disconnect', () => {
    const c = ctx()
    if (!c) return
    const { room, player } = c
    // 이미 다른 소켓이 이 좌석을 되찾았다면(재접속) 건드리지 않는다
    if (player.socketId !== socket.id) return
    dropPlayer(io, room, player, false)
  })
})

/**
 * 플레이어 이탈 처리.
 *  - 대기실이거나 직접 나갔으면 자리에서 제거
 *  - 게임 중 연결만 끊긴 거면 자리를 남겨 둔다 (token 으로 재접속)
 *  - 방장이 빠지면 남은 사람 중 첫 번째가 방장
 *  - 아무도 안 남으면 방 삭제
 */
function dropPlayer(io, room, player, explicit) {
  const wasTurn = currentPlayer(room)?.id === player.id
  player.connected = false

  const remove = explicit || room.status !== 'playing'
  let wrapped = false
  if (remove) {
    const at = room.players.indexOf(player)
    room.players.splice(at, 1)
    // 앞사람이 빠지면 차례 인덱스가 한 칸 밀린다
    if (at < room.turn) room.turn -= 1
    if (room.turn >= room.players.length) {
      // 마지막 자리가 빠졌다 → 한 바퀴 돈 것으로 보고 다음 라운드로
      room.turn = 0
      wrapped = true
    }
  }

  if (room.hostId === player.id) {
    const next = room.players.find((p) => p.connected) ?? room.players[0]
    if (next) room.hostId = next.id
  }

  if (!room.players.some((p) => p.connected)) {
    clearTurnTimer(room)
    rooms.delete(room.code)
    return
  }

  // 게임 중에 차례인 사람이 빠졌다면 게임이 멈추지 않게 처리
  if (room.status === 'playing') {
    if (remove && wasTurn) {
      // 그 자리가 사라졌으니 같은 인덱스에 온 다음 사람부터 (라운드 경계 반영)
      if (wrapped) room.round += 1
      if (room.round > TOTAL_ROUNDS) {
        clearTurnTimer(room)
        room.status = 'finished'
        room.deadline = null
        room.turnSeq += 1
        io.to(room.code).emit('room:finished', { ranking: ranking(room) })
      } else {
        beginTurn(io, room)
      }
    } else if (wasTurn) {
      armTurnTimer(io, room) // 짧게 기다린 뒤 서버가 대신 플레이
    }
  }
  broadcast(io, room)
}

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[YORR] 서버 실행 중 → http://0.0.0.0:${PORT}`)
  console.log(hasDist ? '  (빌드된 앱 서빙 중 — 원격/배포 모드)' : '  (앱은 vite dev 5173 에서 · 소켓만 3001)')
})
