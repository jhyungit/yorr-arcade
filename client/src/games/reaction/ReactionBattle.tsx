import { useCallback, useEffect, useRef, useState } from 'react'
import { useSwing } from '../pingpong/useSwing'
import { canVibrate, unlockAudio } from '../../lib/feedback'
import { likelyKeyboard } from '../../lib/device'
import { socket } from '../../net/socket'
import MatchLobby from '../../net/MatchLobby'
import Arena, { type Fighter } from './Arena'
import Gunslinger, { OUTFIT_LEFT, OUTFIT_RIGHT, type Outfit, type Pose } from './Gunslinger'
import {
  BULLET_MS,
  FOUL,
  FREEZE_MS,
  GRACE_MS,
  KO_MS,
  MAX_HP,
  MISS,
  RESULT_MS,
  SOLO_ROUNDS,
  TIE_MS,
  compareDraw,
  isClean,
  randomWait,
  rankOf,
  type Ms,
} from './duel'

/**
 * 황야의 퀵드로우 (Wild West Quickdraw)
 * -------------------------------------------------------------
 * 정체성: "석양의 결투" — 정적인 긴장 → 폭발적인 신호 → 총성 한 발.
 *  - 두 총잡이가 좌우에서 서로를 겨눈다. 머리 위 신호등이 빨강.
 *  - 신호등이 초록으로 바뀌는 순간 먼저 뽑은 쪽이 쏜다.
 *  - 1ms 까지 같으면 Tie → HP 변화 없이 다음 라운드.
 *  - 3발 맞으면 쓰러진다 (패배).
 *  - 신호 전에 뽑으면 부정출발(FOUL) → 그 라운드 즉시 패배.
 *
 * 모드:
 *  - solo       : 기록 도전 5라운드 (ms 측정 + 총잡이 등급). 무대는 결투와 동일.
 *  - duo        : 한 폰을 좌우로 나눠 2인 (P1=왼쪽 / P2=오른쪽, 키보드 A·L)
 *  - duo-phone  : 노트북=무대, 폰 2대가 각자의 총 (허브에서 폰 2대 연결 시)
 *  - online-*   : 1:1 원격 결투 (호스트가 신호와 판정을 관장)
 */

type Mode = 'solo' | 'duo' | 'duo-phone' | 'online-host' | 'online-guest'
type Phase = 'menu' | 'waiting' | 'signal' | 'result' | 'over'

/** 직전 라운드 결과 (연출과 판정에 함께 쓰인다) */
interface RoundResult {
  ms1: Ms
  ms2: Ms
  winner: 0 | 1 | 2 // 총을 쏜 쪽 (0 = Tie)
  tie: boolean
  hitSide: 0 | 1 | 2 // HP 를 잃은 쪽
  koSide: 0 | 1 | 2 // 쓰러지는 쪽
  over: boolean // 이 라운드로 승부가 끝났는가
  pending: boolean // 온라인: 내 기록만 나오고 상대 대기중
}

/**
 * 게임의 "지금 상태" (핑퐁과 같은 ref 패턴 — 렌더는 force 로 유발).
 * 진영 번호는 항상 1 = P1/호스트 · 2 = P2/게스트 로 고정(canonical).
 * "나를 왼쪽에 두는" 좌우 뒤집기는 렌더 단계에서만 한다.
 */
interface Machine {
  mode: Mode
  phase: Phase
  round: number
  signalAt: number
  ms1: Ms
  ms2: Ms
  foul: 0 | 1 | 2 // 신호 전에 뽑은 쪽 (있으면 무조건 그쪽 패배)
  resolved: boolean
  impact: boolean // 총알이 도착했는가 (피격 자세·HP 표시를 여기에 맞춘다)
  hp1: number
  hp2: number
  last: RoundResult
  soloTimes: number[] // 기록 도전 결과 (FOUL/MISS 센티넬 포함)
  online: 'host' | 'guest' | null
  fx: number // 라운드마다 증가 — 연출 애니메이션 리셋 키
}

const EMPTY_RESULT: RoundResult = {
  ms1: null,
  ms2: null,
  winner: 0,
  tie: false,
  hitSide: 0,
  koSide: 0,
  over: false,
  pending: false,
}

/** duo(한 기기 2인)를 노트북 키보드로 할 때: P1=A(왼쪽) · P2=L(오른쪽) */
const DUO_KEYS: Record<1 | 2, string> = { 1: 'KeyA', 2: 'KeyL' }

interface ReactionBattleProps {
  onExit: () => void
  phoneConnected?: boolean
  phoneCount?: number
}

export default function ReactionBattle({
  onExit,
  phoneConnected = false,
  phoneCount = 0,
}: ReactionBattleProps) {
  const m = useRef<Machine>({
    mode: 'solo',
    phase: 'menu',
    round: 0,
    signalAt: 0,
    ms1: null,
    ms2: null,
    foul: 0,
    resolved: false,
    impact: false,
    hp1: MAX_HP,
    hp2: MAX_HP,
    last: EMPTY_RESULT,
    soloTimes: [],
    online: null,
    fx: 0,
  })

  const [, force] = useState(0)
  const render = useCallback(() => force((n) => n + 1), [])

  const [motionOn, setMotionOn] = useState(false)
  const [lobbyOpen, setLobbyOpen] = useState(false)
  const [oppLeft, setOppLeft] = useState(false)

  // ── 타이머 (라운드 흐름 전체를 여기서 관리) ──
  const t = useRef<Record<'wait' | 'grace' | 'freeze' | 'result' | 'impact', number | null>>({
    wait: null,
    grace: null,
    freeze: null,
    result: null,
    impact: null,
  })
  const clearT = useCallback((k: keyof typeof t.current) => {
    const id = t.current[k]
    if (id != null) window.clearTimeout(id)
    t.current[k] = null
  }, [])
  const clearAllT = useCallback(() => {
    ;(['wait', 'grace', 'freeze', 'result', 'impact'] as const).forEach(clearT)
  }, [clearT])

  // enterWaiting ↔ nextRound 는 서로를 참조하므로 한쪽만 ref 로 끊는다
  const nextRoundRef = useRef<() => void>(() => {})

  /** 이번 라운드 승패 확정 → 결과 연출 시작 */
  const resolve = useCallback(() => {
    const g = m.current
    if (g.resolved) return
    g.resolved = true
    clearT('wait')
    clearT('grace')
    clearT('freeze')

    const solo = g.mode === 'solo'

    // 승자: 부정출발이 있으면 그쪽이 무조건 패배, 아니면 더 빠른 쪽
    let winner: 0 | 1 | 2
    if (g.foul === 1) winner = 2
    else if (g.foul === 2) winner = 1
    else if (solo) winner = isClean(g.ms1) ? 1 : 2
    else winner = compareDraw(g.ms1, g.ms2)

    const tie = winner === 0
    let hitSide: 0 | 1 | 2 = 0
    let koSide: 0 | 1 | 2 = 0
    let over = false

    if (solo) {
      g.soloTimes.push(typeof g.ms1 === 'number' ? g.ms1 : MISS)
      koSide = winner === 1 ? 2 : 0 // 이긴 라운드는 무법자가 쓰러진다
      over = g.round >= SOLO_ROUNDS
    } else if (!tie) {
      hitSide = winner === 1 ? 2 : 1
      if (hitSide === 1) g.hp1 = Math.max(0, g.hp1 - 1)
      else g.hp2 = Math.max(0, g.hp2 - 1)
      if ((hitSide === 1 ? g.hp1 : g.hp2) <= 0) {
        koSide = hitSide
        over = true
      }
    }

    g.impact = false
    g.last = { ms1: g.ms1, ms2: g.ms2, winner, tie, hitSide, koSide, over, pending: false }
    g.phase = 'result'
    render()

    // 폰 버저 대결: 이긴 폰을 진동시켜 손맛
    if (g.mode === 'duo-phone' && winner !== 0) {
      socket.emit('game:hit', { player: winner, kind: 'react' })
    }
    // 온라인 호스트: 판정 결과를 게스트에게
    if (g.online === 'host') {
      socket.emit('rx:round', {
        ms1: g.ms1,
        ms2: g.ms2,
        winner,
        tie,
        hp1: g.hp1,
        hp2: g.hp2,
        koSide,
        over,
      })
    }

    // 총알이 닿는 순간에 맞춰 피격 자세 / HP 감소를 보여준다
    t.current.impact = window.setTimeout(() => {
      m.current.impact = true
      if (canVibrate) navigator.vibrate(tie ? 30 : [0, 45, 25, 70])
      render()
    }, BULLET_MS)

    t.current.result = window.setTimeout(
      () => nextRoundRef.current(),
      over ? KO_MS : tie ? TIE_MS : RESULT_MS,
    )
  }, [clearT, render])

  /** 신호등을 초록으로 (호스트/로컬만 호출 — 게스트는 rx:signal 로 받는다) */
  const fire = useCallback(() => {
    const g = m.current
    if (g.phase !== 'waiting') return
    g.phase = 'signal'
    g.signalAt = performance.now()
    if (canVibrate) navigator.vibrate([0, 40, 30, 60])
    render()
    if (g.online === 'host') socket.emit('rx:signal')

    // 아무도 뽑지 않으면 라운드를 무효로 넘긴다 (화면이 멈추지 않게)
    clearT('freeze')
    t.current.freeze = window.setTimeout(() => {
      const gg = m.current
      if (gg.resolved || gg.phase !== 'signal') return
      if (gg.ms1 == null) gg.ms1 = MISS
      if (gg.ms2 == null && gg.mode !== 'solo') gg.ms2 = MISS
      resolve()
    }, FREEZE_MS)
  }, [clearT, render, resolve])

  /** 다음 라운드 대기 시작 (빨간 신호등 + 랜덤 대기) */
  const enterWaiting = useCallback(() => {
    const g = m.current
    clearAllT()
    g.phase = 'waiting'
    g.ms1 = null
    g.ms2 = null
    g.foul = 0
    g.resolved = false
    g.impact = false
    g.last = EMPTY_RESULT
    g.fx++
    render()
    if (g.online === 'guest') return // 게스트는 호스트의 신호를 기다린다
    if (g.online === 'host') socket.emit('rx:arm', { round: g.round })
    t.current.wait = window.setTimeout(fire, randomWait())
  }, [clearAllT, fire, render])

  const nextRound = useCallback(() => {
    const g = m.current
    if (g.last.over) {
      g.phase = 'over'
      render()
      return
    }
    g.round++
    enterWaiting()
  }, [enterWaiting, render])
  useEffect(() => {
    nextRoundRef.current = nextRound
  }, [nextRound])

  /** 한 진영의 반응을 기록 → 판정 조건이 되면 resolve */
  const record = useCallback(
    (side: 1 | 2, value: number) => {
      const g = m.current
      if (g.resolved) return
      if (side === 1) {
        if (g.ms1 != null) return
        g.ms1 = value
      } else {
        if (g.ms2 != null) return
        g.ms2 = value
      }

      // 부정출발은 기다릴 것 없이 그 자리에서 패배
      if (value === FOUL) {
        g.foul = side
        resolve()
        return
      }
      if (canVibrate) navigator.vibrate(18)

      if (g.mode === 'solo' || (g.ms1 != null && g.ms2 != null)) {
        resolve()
        return
      }
      // 한쪽이 뽑았다 → 상대에게 마지막 유예. 못 뽑으면 그대로 맞는다.
      clearT('grace')
      t.current.grace = window.setTimeout(() => {
        const gg = m.current
        if (gg.resolved) return
        if (gg.ms1 == null) gg.ms1 = MISS
        if (gg.ms2 == null) gg.ms2 = MISS
        resolve()
      }, GRACE_MS)
    },
    [clearT, resolve],
  )

  /** 이 기기에서 들어온 입력 (탭 / 키 / 폰 스윙) */
  const submit = useCallback(
    (side: 1 | 2) => {
      const g = m.current
      unlockAudio()
      if (g.phase !== 'waiting' && g.phase !== 'signal') return
      const value = g.phase === 'waiting' ? FOUL : Math.round(performance.now() - g.signalAt)

      // 게스트는 판정 권한이 없다 — 기록만 보고하고 결과를 기다린다
      if (g.online === 'guest') {
        if (g.resolved) return
        g.resolved = true
        g.ms2 = value
        if (canVibrate) navigator.vibrate(value === FOUL ? 60 : 18)
        socket.emit('rx:react', { ms: value })
        g.impact = false
        g.last = { ...EMPTY_RESULT, ms2: value, pending: true }
        g.phase = 'result'
        render()
        return
      }
      record(side, value)
    },
    [record, render],
  )

  // ── 이 기기의 폰 휘두르기 = 뽑기 (solo / online) ──
  const { permission, requestPermission } = useSwing({
    onSwing: () => {
      const g = m.current
      if (g.mode === 'duo' || g.mode === 'duo-phone') return // 누가 흔들었는지 못 가림
      submit(g.online === 'guest' ? 2 : 1)
    },
    enabled: motionOn,
    threshold: 15,
  })

  useEffect(() => () => clearAllT(), [clearAllT])

  // ── 키보드 (노트북/PC) ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const g = m.current
      if (g.phase !== 'waiting' && g.phase !== 'signal') return
      if (g.mode === 'duo') {
        if (e.code === DUO_KEYS[1]) {
          e.preventDefault()
          submit(1)
        } else if (e.code === DUO_KEYS[2]) {
          e.preventDefault()
          submit(2)
        }
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        submit(g.online === 'guest' ? 2 : 1)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submit])

  // ── 폰 컨트롤러 스윙 (노트북이 무대) ──
  useEffect(() => {
    const onSwing = (d?: { player?: number }) => {
      const g = m.current
      if (g.mode === 'solo') submit(1)
      else if (g.mode === 'duo-phone') submit(d?.player === 2 ? 2 : 1)
    }
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [submit])

  // ── 온라인 소켓 ──
  useEffect(() => {
    // 게스트 보고 → 호스트가 취합
    const onReact = (d?: { ms?: number }) => {
      const g = m.current
      if (g.online !== 'host') return
      record(2, typeof d?.ms === 'number' ? d.ms : MISS)
    }
    // 호스트가 라운드를 열었다 (게스트: 빨간 신호등으로)
    const onArm = (d?: { round?: number }) => {
      const g = m.current
      if (g.online !== 'guest') return
      clearAllT()
      if (d?.round === 1) {
        g.hp1 = MAX_HP
        g.hp2 = MAX_HP
      }
      if (typeof d?.round === 'number') g.round = d.round
      g.phase = 'waiting'
      g.ms1 = null
      g.ms2 = null
      g.foul = 0
      g.resolved = false
      g.impact = false
      g.last = EMPTY_RESULT
      g.fx++
      render()
    }
    const onSignal = () => {
      const g = m.current
      if (g.online !== 'guest' || g.phase !== 'waiting') return
      g.phase = 'signal'
      g.signalAt = performance.now()
      if (canVibrate) navigator.vibrate([0, 40, 30, 60])
      render()
    }
    // 호스트 판정 결과
    const onRound = (d: {
      ms1: Ms
      ms2: Ms
      winner: 0 | 1 | 2
      tie: boolean
      hp1: number
      hp2: number
      koSide: 0 | 1 | 2
      over: boolean
    }) => {
      const g = m.current
      if (g.online !== 'guest') return
      clearAllT()
      g.resolved = true
      g.ms1 = d.ms1 ?? null
      g.ms2 = d.ms2 ?? null
      g.hp1 = d.hp1
      g.hp2 = d.hp2
      g.impact = false
      g.last = {
        ms1: g.ms1,
        ms2: g.ms2,
        winner: d.winner,
        tie: d.tie,
        hitSide: d.tie ? 0 : d.winner === 1 ? 2 : 1,
        koSide: d.koSide ?? 0,
        over: !!d.over,
        pending: false,
      }
      g.phase = 'result'
      render()
      t.current.impact = window.setTimeout(() => {
        m.current.impact = true
        if (canVibrate) navigator.vibrate(d.tie ? 30 : [0, 45, 25, 70])
        render()
      }, BULLET_MS)
      if (d.over) {
        t.current.result = window.setTimeout(() => {
          m.current.phase = 'over'
          render()
        }, KO_MS)
      }
    }
    const onLeft = () => {
      if (m.current.online) setOppLeft(true)
    }

    socket.on('rx:react', onReact)
    socket.on('rx:arm', onArm)
    socket.on('rx:signal', onSignal)
    socket.on('rx:round', onRound)
    socket.on('rx:left', onLeft)
    return () => {
      socket.off('rx:react', onReact)
      socket.off('rx:arm', onArm)
      socket.off('rx:signal', onSignal)
      socket.off('rx:round', onRound)
      socket.off('rx:left', onLeft)
    }
  }, [clearAllT, record, render])

  // ── 시작/재시작 ──
  const startMode = useCallback(
    (mode: Mode, online: 'host' | 'guest' | null = null) => {
      unlockAudio()
      const g = m.current
      g.mode = mode
      g.online = online
      g.round = 1
      g.hp1 = MAX_HP
      g.hp2 = MAX_HP
      g.soloTimes = []
      g.last = EMPTY_RESULT
      enterWaiting()
    },
    [enterWaiting],
  )

  const onMatched = useCallback(
    (role: 'host' | 'guest') => {
      setLobbyOpen(false)
      setOppLeft(false)
      startMode(role === 'host' ? 'online-host' : 'online-guest', role)
    },
    [startMode],
  )

  /** 메뉴에서 모드 선택 — 이 클릭 안에서 iOS 센서/오디오 권한을 얻는다 */
  const begin = async (choice: 'solo' | 'duo' | 'duo-phone' | 'online') => {
    unlockAudio()
    if (choice === 'solo' || choice === 'online') {
      await requestPermission()
      setMotionOn(true)
    }
    if (choice === 'online') setLobbyOpen(true)
    else startMode(choice)
  }

  const g = m.current

  // ── 조작 안내 ──
  //  2인 모드는 조작 방식이 정해져 있고(좌우 탭 / 각자 폰), 1인·온라인만
  //  이 기기의 입력 수단을 따진다: 폰 컨트롤러 > 노트북 키보드 > 폰 모션 > 탭
  const motionReady = motionOn && permission === 'granted'
  let hint: string
  let actLabel: string
  if (g.mode === 'duo') {
    hint = likelyKeyboard ? '초록이 되면 내 키를! (P1=A · P2=L)' : '초록이 되면 자기 쪽 화면을 탭!'
    actLabel = likelyKeyboard ? 'A / L' : 'TAP'
  } else if (g.mode === 'duo-phone') {
    hint = '초록이 되면 각자 폰을 휘둘러 뽑아!'
    actLabel = '휘둘러!'
  } else if (phoneConnected || motionReady) {
    hint = '초록이 되면 폰을 휘둘러 뽑아!'
    actLabel = '휘둘러!'
  } else if (likelyKeyboard) {
    hint = '초록이 되면 스페이스바!'
    actLabel = 'SPACE'
  } else {
    hint = '초록이 되면 화면을 탭!'
    actLabel = 'TAP'
  }

  const playing = g.phase === 'waiting' || g.phase === 'signal' || g.phase === 'result'

  return (
    <div className="fixed inset-0 flex flex-col bg-[#0b0409] text-white select-none overflow-hidden">
      {/* 상단 바 */}
      <div className="absolute top-0 inset-x-0 z-30 flex items-start justify-between px-3 py-2.5">
        <button
          onClick={onExit}
          className="text-sm text-white/75 hover:text-white"
          style={{ opacity: playing ? 0.4 : 1 }}
        >
          ‹ 게임 선택
        </button>
        {g.mode !== 'duo' && <InputBadge phoneConnected={phoneConnected} motionOn={motionOn} permission={permission} />}
      </div>

      {g.phase === 'menu' && (
        <Menu phoneCount={phoneCount} onPick={begin} />
      )}

      {playing && (
        <DuelStage
          machine={g}
          hint={hint}
          actLabel={actLabel}
          onTap={submit}
        />
      )}

      {g.phase === 'over' &&
        (g.mode === 'solo' ? (
          <SoloVerdict machine={g} onRetry={() => startMode('solo')} onExit={onExit} />
        ) : (
          <DuelVerdict
            machine={g}
            onRetry={() =>
              g.online === 'host'
                ? startMode('online-host', 'host')
                : g.online === 'guest'
                  ? undefined
                  : startMode(g.mode)
            }
            onExit={onExit}
          />
        ))}

      {lobbyOpen && (
        <MatchLobby
          prefix="rx"
          title="황야의 퀵드로우"
          accent="#f59e0b"
          onMatched={onMatched}
          onCancel={() => setLobbyOpen(false)}
        />
      )}

      {oppLeft && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/92 px-6">
          <div className="text-5xl mb-2">🐎</div>
          <h2 className="text-xl font-black mb-1">상대가 말을 타고 떠났어요</h2>
          <p className="text-white/60 mb-6 text-sm">연결이 끊어졌습니다.</p>
          <button
            onClick={onExit}
            className="px-8 py-3 rounded-2xl font-black active:brightness-110"
            style={{ background: 'linear-gradient(120deg,#f59e0b,#ef4444)' }}
          >
            게임 선택으로
          </button>
        </div>
      )}
    </div>
  )
}

/* ============================================================
   무대 — Machine 을 Arena 가 이해하는 "화면"으로 번역
   ============================================================ */
function DuelStage({
  machine,
  hint,
  actLabel,
  onTap,
}: {
  machine: Machine
  hint: string
  actLabel: string
  onTap: (side: 1 | 2) => void
}) {
  const g = machine
  const solo = g.mode === 'solo'
  // 게스트는 자기를 왼쪽에 두고 본다 (호스트/게스트 모두 "나"가 왼쪽)
  const mirror = g.online === 'guest'
  const result = g.phase === 'result'
  const L = g.last

  /** 진영별 자세 — 총알 도착(impact) 전에는 아직 맞지 않은 상태 */
  const poseOf = (side: 1 | 2): Pose => {
    if (!result || L.pending) return 'ready'
    if (g.impact && L.koSide === side) return 'dead'
    if (L.tie || L.winner === side) return 'draw'
    if (g.impact && L.winner !== 0) return 'hit'
    return 'ready'
  }

  /** HP 표시 — 총알이 닿기 전에는 아직 깎이지 않은 값 */
  const hpOf = (side: 1 | 2) => {
    const base = side === 1 ? g.hp1 : g.hp2
    return result && !g.impact && L.hitSide === side ? base + 1 : base
  }

  const nameOf = (side: 1 | 2) => {
    if (solo) return side === 1 ? '나' : '무법자'
    if (g.online) return (g.online === 'host') === (side === 1) ? '나' : '상대'
    return side === 1 ? 'P1' : 'P2'
  }

  const build = (side: 1 | 2, outfit: Outfit): Fighter => ({
    name: nameOf(side),
    pose: poseOf(side),
    outfit,
    hp: hpOf(side),
    ms: result ? (side === 1 ? L.ms1 : L.ms2) : null,
    meter: solo ? (side === 1 ? 'rounds' : 'none') : 'hp',
  })

  const left = build(mirror ? 2 : 1, OUTFIT_LEFT)
  const right = build(mirror ? 1 : 2, OUTFIT_RIGHT)
  const viewWinner: 0 | 1 | 2 = L.winner === 0 ? 0 : mirror ? (L.winner === 1 ? 2 : 1) : L.winner

  // 기록 도전은 승패 대신 ms + 등급을 크게 보여준다
  let override: { big: string; sub: string; color: string } | null = null
  if (solo && result && !L.pending) {
    const v = L.ms1
    if (isClean(v)) {
      const r = rankOf(v)
      override = { big: `${v}ms`, sub: `${r.title}`, color: r.color }
    } else if (v === FOUL) {
      override = { big: '성급했다', sub: '신호를 기다려야 한다', color: '#f87171' }
    } else {
      override = { big: '놓쳤다', sub: '무법자가 먼저 뽑았다', color: '#f87171' }
    }
  }

  return (
    <Arena
      phase={g.phase === 'waiting' ? 'waiting' : g.phase === 'signal' ? 'signal' : 'result'}
      round={g.round}
      maxHp={MAX_HP}
      totalRounds={SOLO_ROUNDS}
      left={left}
      right={right}
      winner={viewWinner}
      tie={L.tie}
      ko={!solo && L.over}
      pending={L.pending}
      hint={hint}
      actLabel={actLabel}
      fxKey={g.fx}
      headlineOverride={override}
    >
      {/* 조작 영역 — duo 는 좌/우로 나눠 두 사람이 잡는다 */}
      {g.mode === 'duo' ? (
        <>
          <button
            aria-label="P1 뽑기"
            onPointerDown={(e) => {
              e.preventDefault()
              onTap(1)
            }}
            className="absolute inset-y-0 left-0 w-1/2 touch-none"
          />
          <button
            aria-label="P2 뽑기"
            onPointerDown={(e) => {
              e.preventDefault()
              onTap(2)
            }}
            className="absolute inset-y-0 right-0 w-1/2 touch-none"
          />
          <div className="absolute inset-y-0 left-1/2 w-px bg-white/10 pointer-events-none" />
          <div className="absolute bottom-3 inset-x-0 flex justify-around text-[10px] label-mono text-white/45 pointer-events-none">
            <span>← P1 {likelyKeyboard && '· A'}</span>
            <span>{likelyKeyboard && 'L · '}P2 →</span>
          </div>
        </>
      ) : g.mode === 'duo-phone' ? (
        <div className="absolute bottom-3 inset-x-0 text-center text-[10px] label-mono text-white/45 pointer-events-none">
          📱 P1 · 각자 폰을 휘둘러 뽑는다 · P2 📱
        </div>
      ) : (
        <button
          aria-label="뽑기"
          onPointerDown={(e) => {
            e.preventDefault()
            onTap(g.online === 'guest' ? 2 : 1)
          }}
          className="absolute inset-0 touch-none"
        />
      )}
    </Arena>
  )
}

/* ============================================================
   입력 상태 배지
   ============================================================ */
function InputBadge({
  phoneConnected,
  motionOn,
  permission,
}: {
  phoneConnected: boolean
  motionOn: boolean
  permission: string
}) {
  if (phoneConnected)
    return (
      <span className="text-xs rounded-full px-3 py-1 border border-[#4ade80]/60 text-[#4ade80] bg-black/40">
        🎮 폰 휘두르기
      </span>
    )
  if (likelyKeyboard)
    return (
      <span className="text-xs rounded-full px-3 py-1 border border-[#fbbf24]/60 text-[#fbbf24] bg-black/40">
        ⌨️ Space
      </span>
    )
  if (motionOn)
    return (
      <span
        className={`text-xs rounded-full px-3 py-1 border bg-black/40 ${
          permission === 'granted'
            ? 'border-[#4ade80]/60 text-[#4ade80]'
            : 'border-white/20 text-white/50'
        }`}
      >
        {permission === 'granted' ? '📳 휘두르기 ON' : '📳 탭으로 진행'}
      </span>
    )
  return null
}

/* ============================================================
   메뉴 — 석양 배경 위 결투 포스터
   ============================================================ */
function Menu({
  phoneCount,
  onPick,
}: {
  phoneCount: number
  onPick: (c: 'solo' | 'duo' | 'duo-phone' | 'online') => void
}) {
  const twoPhones = phoneCount >= 2
  return (
    <div className="relative flex-1 w-full overflow-y-auto">
      {/* 배경: 석양 */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(#170817 0%, #3d1230 30%, #86302c 58%, #cf5f2c 80%, #f2a545 100%)',
        }}
      />
      <div
        className="absolute inset-x-0 bottom-0"
        style={{ height: '30%', background: 'linear-gradient(#7c3f22 0%, #2a1010 45%, #0a0405 100%)' }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(110% 80% at 50% 46%, transparent 34%, rgba(6,2,4,0.8) 100%)' }}
      />

      <div className="relative flex flex-col items-center px-6 pt-14 pb-8 min-h-full">
        {/* 마주 선 두 총잡이 */}
        <div className="flex items-end justify-center gap-6 mb-1" style={{ height: 116 }}>
          <Gunslinger pose="ready" outfit={OUTFIT_LEFT} height={112} />
          <div className="pb-8 text-3xl">💥</div>
          <Gunslinger pose="ready" outfit={OUTFIT_RIGHT} flip height={112} />
        </div>

        <div className="label-mono text-[#ffcf8a]">WILD WEST</div>
        <h1
          className="text-[30px] leading-tight font-black tracking-tight text-center mt-0.5"
          style={{ color: '#fff3d6', textShadow: '0 0 28px rgba(239,68,68,0.7), 0 3px 0 rgba(0,0,0,0.5)' }}
        >
          황야의 퀵드로우
        </h1>
        <p className="text-white/65 text-[13px] text-center mt-2 mb-6 leading-relaxed max-w-xs">
          신호등이 <b className="text-[#4ade80]">초록</b>으로 바뀌는 순간 먼저 뽑는다.
          <br />
          <b className="text-white">3발</b> 맞으면 쓰러진다. 신호 전에 뽑으면 부정출발.
        </p>

        <div className="flex flex-col gap-2.5 w-full max-w-xs">
          <PickButton
            onClick={() => onPick('solo')}
            primary
            emoji="🤠"
            title="혼자 · 뽑기 기록 도전"
            sub={`${SOLO_ROUNDS}라운드 · ms 측정 + 총잡이 등급`}
          />
          <PickButton
            onClick={() => onPick('online')}
            emoji="🔫"
            title="온라인 1:1 결투"
            sub={`멀리 있는 상대와 · 먼저 ${MAX_HP}발 맞히면 승`}
          />
          <PickButton
            onClick={() => twoPhones && onPick('duo-phone')}
            disabled={!twoPhones}
            emoji="📱📱"
            title="2인 · 폰 2대 결투"
            sub={
              twoPhones
                ? `폰 ${phoneCount}대 연결됨 · 각자 폰을 휘둘러 뽑기`
                : `허브에서 폰 2대 연결 필요 (현재 ${phoneCount}대)`
            }
          />
          <PickButton
            onClick={() => onPick('duo')}
            emoji="🤜"
            title="2인 · 한 폰 나눠 잡고"
            sub={likelyKeyboard ? '왼쪽 A · 오른쪽 L' : '화면 왼쪽 = P1 · 오른쪽 = P2'}
          />
        </div>

        <p className="text-white/35 text-[11px] mt-6 text-center max-w-xs leading-relaxed">
          1ms 까지 똑같으면 <b className="text-white/60">TIE</b> — 체력 변화 없이 다시 붙는다
        </p>
      </div>
    </div>
  )
}

function PickButton({
  onClick,
  emoji,
  title,
  sub,
  primary = false,
  disabled = false,
}: {
  onClick: () => void
  emoji: string
  title: string
  sub: string
  primary?: boolean
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full text-left rounded-2xl px-4 py-3 border active:brightness-110 transition"
      style={
        disabled
          ? { background: 'rgba(255,255,255,0.05)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' }
          : primary
            ? {
                background: 'linear-gradient(120deg,#f59e0b,#e0483a)',
                borderColor: 'rgba(255,220,160,0.4)',
                boxShadow: '0 8px 22px rgba(224,72,58,0.35)',
              }
            : {
                background: 'rgba(20,8,12,0.6)',
                borderColor: 'rgba(245,158,11,0.4)',
                color: '#ffd9a0',
              }
      }
    >
      <span className="flex items-center gap-2.5">
        <span className="text-xl leading-none">{emoji}</span>
        <span className="flex-1">
          <span className="block font-black text-[15px]">{title}</span>
          <span className="block text-[11px] opacity-80 mt-0.5">{sub}</span>
        </span>
      </span>
    </button>
  )
}

/* ============================================================
   결과 — 기록 도전 (현상금 포스터)
   ============================================================ */
function SoloVerdict({
  machine,
  onRetry,
  onExit,
}: {
  machine: Machine
  onRetry: () => void
  onExit: () => void
}) {
  const g = machine
  const valid = g.soloTimes.filter(isClean)
  const best = valid.length ? Math.min(...valid) : 0
  const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0
  const r = best ? rankOf(best) : { title: '기록 없음', sub: '한 발도 못 뽑았다', color: '#94a3b8' }

  return (
    <div className="flex-1 w-full overflow-y-auto flex items-center justify-center px-5 py-14"
      style={{ background: 'linear-gradient(#1a0a12, #3a1520 60%, #120608)' }}
    >
      {/* 현상금 포스터 */}
      <div
        className="w-full max-w-sm rounded-sm px-6 py-6 text-center"
        style={{
          background: 'linear-gradient(#e8d5ac, #d8bf90 60%, #c9ac78)',
          color: '#2a1a0e',
          boxShadow: '0 18px 50px rgba(0,0,0,0.6)',
          border: '2px solid #8a6a3a',
        }}
      >
        <div className="label-mono" style={{ color: '#6b4a24', letterSpacing: '0.3em' }}>
          BOUNTY REPORT
        </div>
        <div className="text-4xl font-black tracking-[0.12em] mt-1" style={{ color: '#3a2410' }}>
          WANTED
        </div>
        <div className="my-3 border-y-2 border-dashed py-3" style={{ borderColor: '#a98a58' }}>
          <div className="flex justify-center">
            <Gunslinger pose="ready" outfit={OUTFIT_LEFT} height={104} />
          </div>
        </div>

        <div className="text-2xl font-black" style={{ color: '#7a1f14' }}>
          {r.title}
        </div>
        <div className="text-xs mt-0.5" style={{ color: '#6b4a24' }}>
          {r.sub}
        </div>

        <div className="mt-4 flex items-end justify-center gap-6">
          <div>
            <div className="label-mono" style={{ color: '#6b4a24' }}>
              BEST
            </div>
            <div className="text-4xl font-black tabular-nums leading-none" style={{ color: '#7a1f14' }}>
              {best || '--'}
              <span className="text-lg ml-0.5">ms</span>
            </div>
          </div>
          <div>
            <div className="label-mono" style={{ color: '#6b4a24' }}>
              AVG
            </div>
            <div className="text-2xl font-black tabular-nums leading-none" style={{ color: '#3a2410' }}>
              {avg || '--'}
              <span className="text-sm ml-0.5">ms</span>
            </div>
          </div>
        </div>

        {/* 라운드별 기록 */}
        <div className="flex gap-1.5 mt-4 flex-wrap justify-center">
          {g.soloTimes.map((v, i) => (
            <span
              key={i}
              className="text-[11px] font-black tabular-nums rounded px-2 py-1"
              style={{
                background: isClean(v) ? 'rgba(58,36,16,0.12)' : 'rgba(122,31,20,0.18)',
                color: isClean(v) ? '#3a2410' : '#7a1f14',
                border: '1px solid rgba(107,74,36,0.3)',
              }}
            >
              {isClean(v) ? v : v === FOUL ? 'FOUL' : 'MISS'}
            </span>
          ))}
        </div>

        <button
          onClick={onRetry}
          className="mt-6 w-full py-3 rounded-md font-black active:brightness-110"
          style={{ background: 'linear-gradient(120deg,#8a2418,#5e160e)', color: '#f7e4c0' }}
        >
          다시 뽑는다
        </button>
        <button onClick={onExit} className="mt-2 text-xs underline" style={{ color: '#6b4a24' }}>
          다른 게임 고르기
        </button>
      </div>
    </div>
  )
}

/* ============================================================
   결과 — 결투 (2인 / 온라인)
   ============================================================ */
function DuelVerdict({
  machine,
  onRetry,
  onExit,
}: {
  machine: Machine
  onRetry: () => void
  onExit: () => void
}) {
  const g = machine
  const p1Alive = g.hp1 > 0
  // 온라인은 "나" 기준으로 승패를 말한다
  const iWin = g.online ? (g.online === 'host' ? p1Alive : !p1Alive) : false
  const winnerSide: 1 | 2 = p1Alive ? 1 : 2
  const outfit = winnerSide === 1 ? OUTFIT_LEFT : OUTFIT_RIGHT
  const guest = g.online === 'guest'

  return (
    <div
      className="flex-1 w-full flex flex-col items-center justify-center px-6"
      style={{ background: 'linear-gradient(#170817, #4a1622 58%, #0d0406)' }}
    >
      {/* 이긴 총잡이가 총을 내려놓고 서 있다 */}
      <div style={{ height: 150 }} className="flex items-end">
        <Gunslinger pose="ready" outfit={outfit} flip={winnerSide === 2} height={150} />
      </div>

      <div className="label-mono mt-3" style={{ color: '#ffcf8a', letterSpacing: '0.3em' }}>
        LAST MAN STANDING
      </div>
      <h2
        className="text-3xl font-black mt-1"
        style={{
          color: g.online ? (iWin ? '#86efac' : '#fca5a5') : outfit.scarf,
          textShadow: '0 0 26px rgba(0,0,0,0.6)',
        }}
      >
        {g.online ? (iWin ? '살아남았다' : '쓰러졌다') : `P${winnerSide} 승리!`}
      </h2>

      {/* 남은 탄약으로 스코어 표시 */}
      <div className="flex items-center gap-4 mt-4 mb-7">
        <SideScore label={g.online ? (g.online === 'host' ? '나' : '상대') : 'P1'} hp={g.hp1} outfit={OUTFIT_LEFT} />
        <span className="text-white/25 font-black">:</span>
        <SideScore label={g.online ? (g.online === 'guest' ? '나' : '상대') : 'P2'} hp={g.hp2} outfit={OUTFIT_RIGHT} />
      </div>

      {guest ? (
        <p className="text-sm text-white/50">상대가 다시 시작하면 이어집니다…</p>
      ) : (
        <button
          onClick={onRetry}
          className="px-8 py-3 rounded-2xl font-black active:brightness-110"
          style={{ background: 'linear-gradient(120deg,#f59e0b,#e0483a)' }}
        >
          다시 결투
        </button>
      )}
      <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
        다른 게임 고르기
      </button>
    </div>
  )
}

function SideScore({ label, hp, outfit }: { label: string; hp: number; outfit: Outfit }) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-xs font-black" style={{ color: outfit.scarf }}>
        {label}
      </span>
      <div className="flex gap-1">
        {Array.from({ length: MAX_HP }).map((_, i) => (
          <span
            key={i}
            className="block"
            style={{
              width: 9,
              height: 17,
              borderRadius: '2px 2px 3px 3px',
              background:
                i < hp
                  ? 'linear-gradient(#ffe9a8 0%, #d9a53c 34%, #8a5f18 100%)'
                  : 'rgba(255,255,255,0.08)',
              border: i < hp ? '1px solid #6d4a11' : '1px solid rgba(255,255,255,0.16)',
            }}
          />
        ))}
      </div>
    </div>
  )
}
