// =============================================================
//  요트 다이스 실시간 멀티플레이 서버 (Socket.IO)
// -------------------------------------------------------------
//  역할:
//   - 방 만들기 / 입장코드로 참가 / 대기실
//   - "동시 플레이" 라운드 진행 (모두가 각자 굴리고, 각자 한 칸씩 점수 확정)
//   - 모든 플레이어 상태(주사위/점수/총점)를 방 전체에 실시간 브로드캐스트
//
//  설계 메모:
//   - 주사위는 "클라이언트에서" 굴린다(센서/로컬 계산). 서버는 결과값만 받아 공유.
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
const ROUND_MS = 25000 // 라운드 제한시간(마감 deadline 계산용)
const REACTION_TYPES = ['like', 'laugh', 'shock', 'clap', 'gg']

// code -> Room
const rooms = new Map()

// 폰 컨트롤러 페어링: code -> { displayId, controllers: Set<socketId> }
//  한 노트북(display)에 여러 폰(controller)을 붙일 수 있게 컨트롤러 목록을 추적한다.
//  (연결 수를 display 에 실시간으로 알려 UI 에 "연결된 폰 N개" 를 띄운다)
const pairs = new Map()

// --- 유틸 ---

/** 4자리 방 코드 (헷갈리는 글자 0,O,1,I 제외) */
function makeRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code
  do {
    code = Array.from({ length: 4 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('')
  } while (rooms.has(code)) // 중복 방지
  return code
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

/** 총점 계산 (윗줄 63점 이상이면 보너스 +35) */
function computeTotal(sheet) {
  let base = 0
  for (const id of ALL_CATEGORY_IDS) base += sheet[id] ?? 0
  let upper = 0
  for (const id of UPPER_IDS) upper += sheet[id] ?? 0
  const bonus = upper >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_POINTS : 0
  return base + bonus
}

/** 새 플레이어 객체 */
function makePlayer(id, nickname) {
  return {
    id,
    nickname: nickname?.slice(0, 12) || '익명',
    connected: true,
    sheet: emptySheet(),
    dice: [1, 1, 1, 1, 1], // 현재 보이는 주사위
    rollsLeft: MAX_ROLLS,
    rolledThisRound: false,
    done: false, // 이번 라운드에 점수를 확정했는가
    total: 0,
  }
}

/** 클라이언트에 보낼 방 상태(그대로 전체 전송 → 클라는 이걸로 화면 렌더) */
function roomState(room) {
  return {
    code: room.code,
    hostId: room.hostId,
    status: room.status, // 'lobby' | 'playing' | 'finished'
    round: room.round,
    totalRounds: TOTAL_ROUNDS,
    deadline: room.deadline ?? null, // 이번 라운드 마감(epoch ms)
    players: room.players.map((p) => ({
      id: p.id,
      nickname: p.nickname,
      connected: p.connected,
      sheet: p.sheet,
      dice: p.dice,
      rollsLeft: p.rollsLeft,
      rolledThisRound: p.rolledThisRound,
      done: p.done,
      total: p.total,
    })),
  }
}

/** 방 전체에 최신 상태 방송 */
function broadcast(io, room) {
  io.to(room.code).emit('room:state', roomState(room))
}

/** 라운드의 모든 (접속중인) 플레이어가 점수를 확정했으면 다음 라운드로 */
function maybeAdvanceRound(room) {
  const active = room.players.filter((p) => p.connected)
  if (active.length === 0) return
  const allDone = active.every((p) => p.done)
  if (!allDone) return

  if (room.round >= TOTAL_ROUNDS) {
    room.status = 'finished'
    room.deadline = null
    return
  }
  // 다음 라운드 준비
  room.round += 1
  room.deadline = Date.now() + ROUND_MS
  for (const p of room.players) {
    p.done = false
    p.rollsLeft = MAX_ROLLS
    p.rolledThisRound = false
    p.dice = [1, 1, 1, 1, 1]
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

  /** 방 만들기 */
  socket.on('room:create', (nickname, ack) => {
    const code = makeRoomCode()
    const room = {
      code,
      hostId: socket.id,
      status: 'lobby',
      round: 1,
      deadline: null,
      players: [makePlayer(socket.id, nickname)],
    }
    rooms.set(code, room)
    socket.join(code)
    joinedCode = code
    ack?.({ ok: true, code, youId: socket.id })
    broadcast(io, room)
  })

  /** 입장코드로 참가 */
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
    if (room.players.length >= 8) {
      ack?.({ ok: false, error: '방이 가득 찼어요. (최대 8명)' })
      return
    }
    room.players.push(makePlayer(socket.id, nickname))
    socket.join(code)
    joinedCode = code
    ack?.({ ok: true, code, youId: socket.id })
    broadcast(io, room)
  })

  /** 게임 시작 (방장만) */
  socket.on('room:start', () => {
    const room = rooms.get(joinedCode)
    if (!room || room.hostId !== socket.id || room.status !== 'lobby') return
    room.status = 'playing'
    room.round = 1
    room.deadline = Date.now() + ROUND_MS
    for (const p of room.players) {
      p.sheet = emptySheet()
      p.dice = [1, 1, 1, 1, 1]
      p.rollsLeft = MAX_ROLLS
      p.rolledThisRound = false
      p.done = false
      p.total = 0
    }
    broadcast(io, room)
  })

  /** 굴리기 결과 보고 (클라가 로컬에서 굴린 주사위/남은횟수를 공유) */
  socket.on('game:roll', ({ dice, rollsLeft } = {}) => {
    const room = rooms.get(joinedCode)
    if (!room || room.status !== 'playing') return
    const p = room.players.find((pl) => pl.id === socket.id)
    if (!p || p.done) return
    if (Array.isArray(dice) && dice.length === 5) p.dice = dice.map((n) => Number(n) || 1)
    if (typeof rollsLeft === 'number') p.rollsLeft = Math.max(0, Math.min(MAX_ROLLS, rollsLeft))
    p.rolledThisRound = true
    broadcast(io, room)
  })

  /** 점수 확정 (categoryId 에 score 점 기록 → 이번 라운드 done) */
  socket.on('game:score', ({ categoryId, score } = {}) => {
    const room = rooms.get(joinedCode)
    if (!room || room.status !== 'playing') return
    const p = room.players.find((pl) => pl.id === socket.id)
    if (!p || p.done) return
    if (!ALL_CATEGORY_IDS.includes(categoryId)) return
    if (p.sheet[categoryId] !== null) return // 이미 채운 칸

    p.sheet[categoryId] = Number(score) || 0
    p.total = computeTotal(p.sheet)
    p.done = true

    maybeAdvanceRound(room)
    broadcast(io, room)
  })

  /** 리액션 → 방 전체에 중계 */
  socket.on('reaction:send', ({ type } = {}) => {
    const room = rooms.get(joinedCode)
    if (!room || !REACTION_TYPES.includes(type)) return
    io.to(room.code).emit('reaction:recv', { playerId: socket.id, type })
  })

  /** 다시 하기 (방장만) → 대기실로 */
  socket.on('room:restart', () => {
    const room = rooms.get(joinedCode)
    if (!room || room.hostId !== socket.id) return
    room.status = 'lobby'
    room.round = 1
    room.deadline = null
    for (const p of room.players) {
      p.sheet = emptySheet()
      p.dice = [1, 1, 1, 1, 1]
      p.rollsLeft = MAX_ROLLS
      p.rolledThisRound = false
      p.done = false
      p.total = 0
    }
    broadcast(io, room)
  })

  /** 연결 종료 처리 */
  socket.on('disconnect', () => {
    const room = rooms.get(joinedCode)
    if (!room) return
    const p = room.players.find((pl) => pl.id === socket.id)
    if (p) p.connected = false

    // 대기실이면 아예 목록에서 제거
    if (room.status === 'lobby') {
      room.players = room.players.filter((pl) => pl.id !== socket.id)
    }

    // 방장이 나갔으면 남은 사람 중 첫 번째를 방장으로
    if (room.hostId === socket.id) {
      const next = room.players.find((pl) => pl.connected)
      if (next) room.hostId = next.id
    }

    // 아무도 안 남았으면 방 삭제
    const anyone = room.players.some((pl) => pl.connected)
    if (!anyone) {
      rooms.delete(room.code)
      return
    }

    // 게임 중이었다면, 남은 사람들 기준으로 라운드 진행 여부 재확인
    if (room.status === 'playing') maybeAdvanceRound(room)
    broadcast(io, room)
  })
})

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`[YORR] 서버 실행 중 → http://0.0.0.0:${PORT}`)
  console.log(hasDist ? '  (빌드된 앱 서빙 중 — 원격/배포 모드)' : '  (앱은 vite dev 5173 에서 · 소켓만 3001)')
})
