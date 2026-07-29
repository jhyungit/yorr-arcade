import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { io } from 'socket.io-client'

/**
 * harness.mjs — 통합 테스트용 서버 띄우기/붙기 도우미
 * -------------------------------------------------------------
 * 서버를 실제로 띄우고 소켓 여러 개를 붙여 "여러 명이 같이 플레이" 를 흉내낸다.
 * 게임 규칙이 서버에 있으므로(턴 진행·주사위·점수 계산) 이 방식이 가장 값싸게
 * 회귀를 잡는다. 브라우저·three.js 는 건드리지 않는다.
 *
 * 각 테스트 파일이 자기 포트로 서버를 띄우고 끝나면 죽인다 → 병렬로 돌려도 안 겹친다.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 조건이 참이 될 때까지 기다린다 (브로드캐스트는 ack 보다 늦게 올 수 있다) */
export async function until(fn, ms = 3000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return true
    await sleep(25)
  }
  return false
}

/** 서버를 띄우고 /health 가 응답할 때까지 기다린다 */
export async function startServer(port) {
  const child = spawn(process.execPath, [path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  let stderr = ''
  child.stderr.on('data', (d) => {
    stderr += d.toString()
  })
  child.on('exit', (code) => {
    if (code) console.error('[harness] 서버가 죽었습니다:', code, stderr)
  })

  // /health 가 200 을 줄 때까지 폴링 (until 은 동기 술어용이라 여기선 직접 돈다)
  let up = false
  for (let i = 0; i < 150 && !up; i++) {
    try {
      up = (await fetch(`http://127.0.0.1:${port}/health`)).ok
    } catch {
      /* 아직 안 뜸 */
    }
    if (!up) await sleep(100)
  }
  if (!up) {
    child.kill()
    throw new Error(`서버가 ${port} 에서 뜨지 않았습니다. ${stderr}`)
  }

  return {
    url: `http://127.0.0.1:${port}`,
    stop: () => child.kill(),
  }
}

/** 소켓 하나 붙이고, 받은 방 상태/로그를 계속 쌓아 둔다 */
export function connect(url) {
  return new Promise((resolve, reject) => {
    const s = io(url, { transports: ['websocket'], forceNew: true })
    s.state = null
    s.logs = []
    s.finished = null
    s.on('room:state', (st) => {
      s.state = st
    })
    s.on('room:log', (l) => s.logs.push(l))
    s.on('room:finished', (f) => {
      s.finished = f
    })
    s.on('connect', () => resolve(s))
    s.on('connect_error', reject)
  })
}

/** ack 를 돌려주는 이벤트를 await 로 (ack 없는 이벤트에 쓰면 영원히 멈춘다) */
export const ask = (s, ev, ...args) =>
  new Promise((resolve) => s.emit(ev, ...args, (ack) => resolve(ack)))

/** 아주 작은 단정 도우미 — 실패해도 계속 돌려서 한 번에 다 보고한다 */
export function makeChecker(title) {
  let fails = 0
  console.log(`\n── ${title} ──`)
  const ok = (cond, label, extra) => {
    if (cond) console.log('  ✓', label)
    else {
      fails += 1
      console.log('  ✗', label, extra === undefined ? '' : JSON.stringify(extra))
    }
  }
  ok.section = (name) => console.log(`\n[${name}]`)
  ok.done = () => {
    if (fails === 0) console.log(`\n✅ ${title} 전부 통과`)
    else console.log(`\n❌ ${title} — ${fails}개 실패`)
    return fails
  }
  return ok
}
