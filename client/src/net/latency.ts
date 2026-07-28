import { socket } from './socket'

/**
 * latency.ts — 폰 컨트롤러 입력 지연 측정 (노트북 쪽에서 돌린다)
 * -------------------------------------------------------------
 * 폰을 휘두르고 → 가속도 감지 → 소켓 전송 → 노트북 도착까지 시간이 걸린다.
 * 그동안 공은 계속 날아가므로, 도착한 순간의 위치로 판정하면 늘 늦게 친 게 된다.
 *
 * 여기서는 "재기"만 한다. 보정을 걸지 말지는 실제 수치를 보고 정한다.
 *  - 노트북이 ctrl:ping 을 던지면 폰이 ctrl:pong 으로 즉시 되돌려준다.
 *  - 왕복(RTT)의 절반을 편도 지연으로 본다.
 *  - 와이파이는 가끔 크게 튀므로 평균이 아니라 '중앙값'을 쓴다.
 *
 * ★ 캘리브레이션(사용자가 박자 맞추기)으로는 이 값을 못 잡는다.
 *   전송 지연은 측정 시점과 플레이 중 값이 다른 '변동' 값이라, 한 번 재서
 *   고정해두면 오히려 틀린 보정이 된다. 그래서 계속 재는 쪽을 택했다.
 *   사람·기기의 '고정' 오프셋만 캘리브레이션 대상이다.
 */

/** 재는 주기 */
const PING_EVERY_MS = 2000
/** 중앙값을 낼 표본 수 (와이파이 스파이크를 흘려보낼 만큼만) */
const WINDOW = 7
/** 이보다 오래 걸린 응답은 표본에서 버린다 (앱 전환·절전 등으로 튄 값) */
const OUTLIER_MS = 1500

export interface LatencyStat {
  /** 편도 지연 중앙값(ms). 표본이 없으면 null */
  oneWayMs: number | null
  /** 최근 왕복 시간(ms) */
  lastRttMs: number | null
  /** 표본 수 */
  samples: number
  /** 흔들림 = 최근 표본의 최대-최소(ms). 클수록 보정이 어렵다. */
  jitterMs: number | null
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

/**
 * 폰 지연 측정을 시작한다. 노트북(게임 화면) 쪽에서만 부른다.
 * @param onChange 표본이 갱신될 때마다 호출
 * @returns 정리 함수
 */
export function startLatencyProbe(onChange: (s: LatencyStat) => void): () => void {
  const rtts: number[] = []
  const pending = new Map<number, number>() // id → 보낸 시각
  let seq = 0
  let stopped = false

  const emit = () => {
    onChange({
      oneWayMs: rtts.length ? median(rtts) / 2 : null,
      lastRttMs: rtts.length ? rtts[rtts.length - 1] : null,
      samples: rtts.length,
      jitterMs: rtts.length >= 2 ? Math.max(...rtts) - Math.min(...rtts) : null,
    })
  }

  const onPong = (p?: { id?: number }) => {
    const id = p?.id
    if (id == null) return
    const sentAt = pending.get(id)
    if (sentAt == null) return
    pending.delete(id)
    const rtt = performance.now() - sentAt
    if (rtt > OUTLIER_MS) return
    rtts.push(rtt)
    if (rtts.length > WINDOW) rtts.shift()
    emit()
  }
  socket.on('ctrl:pong', onPong)

  const tick = () => {
    if (stopped) return
    const id = ++seq
    pending.set(id, performance.now())
    // 답 없는 요청이 쌓이지 않게 정리
    if (pending.size > WINDOW * 2) pending.clear()
    socket.emit('ctrl:ping', { id })
  }
  tick()
  const timer = window.setInterval(tick, PING_EVERY_MS)

  return () => {
    stopped = true
    window.clearInterval(timer)
    socket.off('ctrl:pong', onPong)
  }
}

/**
 * 폰(컨트롤러) 쪽에서 부른다 — ping 이 오면 즉시 되돌려준다.
 * 감지·렌더와 무관하게 바로 응답해야 전송 시간만 재진다.
 */
export function answerLatencyPing(): () => void {
  const onPing = (p?: { id?: number }) => socket.emit('ctrl:pong', { id: p?.id })
  socket.on('ctrl:ping', onPing)
  return () => socket.off('ctrl:ping', onPing)
}
