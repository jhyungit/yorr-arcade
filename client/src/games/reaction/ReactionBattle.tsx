import { useCallback, useEffect, useRef, useState } from 'react'
import { useSwing } from '../pingpong/useSwing'
import { canVibrate, unlockAudio } from '../../lib/feedback'
import { likelyKeyboard } from '../../lib/device'
import { socket } from '../../net/socket'
import MatchLobby from '../../net/MatchLobby'

/**
 * ReactionBattle — 반응속도 배틀
 * -------------------------------------------------------------
 * 정체성: "정적인 긴장 → 폭발적인 신호"의 강한 대비. (핑퐁·리듬과 완전히 다른 톤)
 *  - 대기: 어둡고 붉은 화면에서 숨죽여 기다린다.
 *  - 신호: 화면이 초록으로 폭발 + 진동 → 최대한 빨리 반응(탭/흔들기)!
 *  - 반응 시간(ms) 측정. 신호 전에 누르면 "부정 출발(false start)".
 *
 * 모드:
 *  - solo: 5라운드 기록 도전(최고/평균 + 등급). 탭 또는 폰 흔들기.
 *  - duo : 한 폰을 위/아래로 나눠 2인 대결. 신호 후 먼저 누른 쪽 승. 먼저 3승.
 *  (온라인 1:1 은 별도 단계에서 추가)
 */

type Mode = 'solo' | 'duo' | 'online-host' | 'online-guest'
type Phase = 'menu' | 'waiting' | 'signal' | 'result' | 'over'

const ROUNDS = 5 // solo 라운드 수
const DUO_WINS = 3 // duo: 먼저 3승이면 종료 (5판 3선)
// duo(한 기기 2인)를 노트북 키보드로 할 때 각 플레이어 키: P1=A(왼손), P2=L(오른손)
const DUO_KEYS: Record<1 | 2, { code: string; label: string }> = {
  1: { code: 'KeyA', label: 'A' },
  2: { code: 'KeyL', label: 'L' },
}
const MIN_WAIT = 1300 // 신호까지 최소 대기(ms)
const MAX_WAIT = 4300 // 신호까지 최대 대기(ms)
const RESULT_MS = 1300 // 라운드 결과 보여주는 시간

// 반응 시간(ms)으로 붙이는 등급/별명
function rankOf(ms: number): { title: string; emoji: string; color: string } {
  if (ms < 180) return { title: '치타 반사신경', emoji: '🐆', color: '#22d3ee' }
  if (ms < 230) return { title: '번개', emoji: '⚡', color: '#a3e635' }
  if (ms < 280) return { title: '훌륭해요', emoji: '🔥', color: '#facc15' }
  if (ms < 350) return { title: '좋아요', emoji: '👍', color: '#fb923c' }
  return { title: '커피 한 잔?', emoji: '☕', color: '#f87171' }
}

// 게임의 "지금 상태"를 모아둔 가변 객체(핑퐁과 같은 ref 패턴)
interface Machine {
  mode: Mode
  phase: Phase
  round: number // 현재 라운드(1부터)
  signalAt: number // 신호가 화면에 뜬 시각(performance.now)
  resolved: boolean // 이번 라운드가 이미 판정됐는가(중복 입력 방지)
  soloTimes: number[] // solo 각 라운드 결과(ms). 부정출발은 -1
  winsP1: number // duo=P1승 / online=호스트승
  winsP2: number // duo=P2승 / online=게스트승
  // 직전 라운드 결과. winner 0=무/미정, 1=P1(호스트), 2=P2(게스트)
  // oppMs·pending 은 온라인에서만 사용(내 ms=ms, 상대 ms=oppMs, pending=상대 대기중)
  last: { ms: number; winner: 0 | 1 | 2; falseStart: boolean; oppMs?: number; pending?: boolean }
  // ── 온라인 전용 ──
  online: 'host' | 'guest' | null
  hostMs: number | null // 이번 라운드 호스트 결과: null=미반응, -1=부정출발, ≥0=ms
  guestMs: number | null // 게스트 결과(호스트가 취합)
  roundResolved: boolean // 이번 라운드 승패 확정됨(중복 방지)
}

interface ReactionBattleProps {
  onExit: () => void
  phoneConnected?: boolean // 허브 연결된 폰: 노트북=신호화면 + 폰=휘두르기(solo)
}

export default function ReactionBattle({ onExit, phoneConnected = false }: ReactionBattleProps) {
  const m = useRef<Machine>({
    mode: 'solo',
    phase: 'menu',
    round: 0,
    signalAt: 0,
    resolved: false,
    soloTimes: [],
    winsP1: 0,
    winsP2: 0,
    last: { ms: 0, winner: 0, falseStart: false },
    online: null,
    hostMs: null,
    guestMs: null,
    roundResolved: false,
  })
  const waitTimer = useRef<number | null>(null)
  const resultTimer = useRef<number | null>(null)
  // 온라인 로컬 탭을 온라인 로직으로 넘기는 다리 (마운트 1회 구성)
  const onlineReactRef = useRef<() => void>(() => {})
  const startOnlineRef = useRef<(role: 'host' | 'guest') => void>(() => {})

  // 렌더용 상태 (ref → 화면 반영)
  const [, force] = useState(0)
  const render = () => force((n) => n + 1)

  // 모션(폰 휘두르기) 켜짐 여부 — 퀵드로우의 기본 입력. 켜면 신호에 폰을 휘둘러 반응.
  const [motionOn, setMotionOn] = useState(false)
  // 온라인 대전 상태 (역할·라운드는 m.current.online 에 있고, 여기선 화면 오버레이용만)
  const [lobbyOpen, setLobbyOpen] = useState(false)
  const [oppLeft, setOppLeft] = useState(false)

  const clearTimers = () => {
    if (waitTimer.current) window.clearTimeout(waitTimer.current)
    if (resultTimer.current) window.clearTimeout(resultTimer.current)
    waitTimer.current = null
    resultTimer.current = null
  }

  // 다음 라운드 대기 시작 (붉은 화면 → 랜덤 시간 후 신호)
  const enterWaiting = useCallback(() => {
    const g = m.current
    g.phase = 'waiting'
    g.resolved = false
    render()
    const wait = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT)
    waitTimer.current = window.setTimeout(() => {
      const gg = m.current
      if (gg.phase !== 'waiting') return
      gg.phase = 'signal'
      gg.signalAt = performance.now()
      gg.resolved = false
      if (canVibrate) navigator.vibrate([0, 40, 30, 60]) // 신호 진동
      render()
    }, wait)
  }, [])

  // 라운드 결과 보여준 뒤 다음으로 (또는 종료)
  const afterResult = useCallback(() => {
    resultTimer.current = window.setTimeout(() => {
      const g = m.current
      if (g.mode === 'solo') {
        if (g.round >= ROUNDS) {
          g.phase = 'over'
          render()
        } else {
          g.round++
          enterWaiting()
        }
      } else {
        // duo: 먼저 3승 나면 종료
        if (g.winsP1 >= DUO_WINS || g.winsP2 >= DUO_WINS) {
          g.phase = 'over'
          render()
        } else {
          g.round++
          enterWaiting()
        }
      }
    }, RESULT_MS)
  }, [enterWaiting])

  // 입력 처리: player = 1(위)·2(아래)·0(solo/공통)
  const react = useCallback(
    (player: 0 | 1 | 2) => {
      const g = m.current
      unlockAudio()
      // 온라인은 별도 로직으로 (호스트 권위)
      if (g.online) {
        onlineReactRef.current()
        return
      }
      if (g.phase === 'waiting') {
        // 신호 전에 누름 → 부정 출발
        if (g.resolved) return
        g.resolved = true
        if (waitTimer.current) window.clearTimeout(waitTimer.current)
        if (g.mode === 'solo') {
          g.soloTimes.push(-1)
          g.last = { ms: -1, winner: 0, falseStart: true }
        } else {
          // 부정 출발한 사람의 상대가 이 라운드 승리
          const winner: 1 | 2 = player === 1 ? 2 : 1
          if (winner === 1) g.winsP1++
          else g.winsP2++
          g.last = { ms: -1, winner, falseStart: true }
        }
        g.phase = 'result'
        render()
        afterResult()
        return
      }
      if (g.phase === 'signal') {
        if (g.resolved) return
        g.resolved = true
        const ms = Math.round(performance.now() - g.signalAt)
        if (g.mode === 'solo') {
          g.soloTimes.push(ms)
          g.last = { ms, winner: 0, falseStart: false }
        } else {
          const winner: 1 | 2 = player === 1 ? 1 : 2
          if (winner === 1) g.winsP1++
          else g.winsP2++
          g.last = { ms, winner, falseStart: false }
        }
        if (canVibrate) navigator.vibrate(20)
        g.phase = 'result'
        render()
        afterResult()
      }
    },
    [afterResult],
  )

  // 폰 휘두르기 = 반응(퀵드로우의 핵심 입력).
  //  - solo / online: 내가 든 폰을 휘두르면 react → 신호 후면 반응 기록, 신호 전이면 부정출발.
  //  - duo(한 폰 2인): 누가 흔들었는지 못 가리므로 모션은 끄고 탭으로만.
  //  react() 안에서 현재 phase 로 판단하므로 여기선 모드만 거른다.
  const { permission, requestPermission } = useSwing({
    onSwing: () => {
      const g = m.current
      if (g.mode !== 'duo') react(0)
    },
    enabled: motionOn,
    threshold: 15,
  })

  useEffect(() => () => clearTimers(), [])

  // 키보드(노트북/PC): solo·online 은 스페이스로 반응, duo 는 P1=A · P2=L.
  //  마우스 클릭도 그대로 동작하고, 이건 더 빠르고 손맛 좋은 대안.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return
      // 로비 코드 입력 등 텍스트 필드 타이핑 중이면 가로채지 않음
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      const g = m.current
      if (g.phase === 'menu' || g.phase === 'over') return
      if (g.mode === 'duo') {
        if (e.code === DUO_KEYS[1].code) {
          e.preventDefault()
          react(1)
        } else if (e.code === DUO_KEYS[2].code) {
          e.preventDefault()
          react(2)
        }
        return
      }
      if (e.code === 'Space') {
        e.preventDefault()
        react(0)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [react])

  // 폰(컨트롤러) 휘두름 → 반응 (solo 전용: 노트북이 신호 화면, 폰이 휘두름).
  //  신호 전 휘두르면 부정출발, 신호 후면 반응 기록 — react() 가 phase 로 판단.
  useEffect(() => {
    const onSwing = () => {
      if (m.current.mode === 'solo') react(0)
    }
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [react])

  // ── 온라인 대전 로직 (마운트 1회 구성; 호스트가 신호·판정을 관장) ──
  useEffect(() => {
    const g = m.current

    // 내 반응을 "결과(상대 대기중)" 화면으로 먼저 표시
    const showPendingSelf = (ms: number, foul: boolean) => {
      g.phase = 'result'
      g.last = { ms, winner: 0, falseStart: foul, oppMs: undefined, pending: true }
      render()
    }

    // 호스트: 라운드 대기 시작 → 랜덤 시간 후 신호
    const hostArm = () => {
      g.phase = 'waiting'
      g.resolved = false
      g.roundResolved = false
      g.hostMs = null
      g.guestMs = null
      g.signalAt = 0
      render()
      socket.emit('rx:arm', { round: g.round })
      const wait = MIN_WAIT + Math.random() * (MAX_WAIT - MIN_WAIT)
      waitTimer.current = window.setTimeout(() => {
        if (g.phase !== 'waiting') return
        g.phase = 'signal'
        g.signalAt = performance.now()
        if (canVibrate) navigator.vibrate([0, 40, 30, 60])
        render()
        socket.emit('rx:signal')
      }, wait)
    }

    // 호스트: 두 결과가 모이면(또는 부정출발이면 즉시) 승패 확정
    const hostResolve = () => {
      if (g.roundResolved) return
      const h = g.hostMs
      const gu = g.guestMs
      const hFoul = h === -1
      const gFoul = gu === -1
      let winner: 0 | 1 | 2 = 0
      if (hFoul || gFoul) {
        winner = hFoul && gFoul ? 0 : hFoul ? 2 : 1 // 부정출발한 쪽이 짐
      } else {
        if (h === null || gu === null) return // 아직 둘 다 반응 안 함
        winner = h <= gu ? 1 : 2 // 더 빠른 쪽 승
      }
      g.roundResolved = true
      if (winner === 1) g.winsP1++
      else if (winner === 2) g.winsP2++
      const over = g.winsP1 >= DUO_WINS || g.winsP2 >= DUO_WINS
      g.last = { ms: h ?? -1, oppMs: gu ?? -1, winner, falseStart: hFoul || gFoul, pending: false }
      g.phase = 'result'
      render()
      socket.emit('rx:round', {
        s1: g.winsP1,
        s2: g.winsP2,
        winner,
        hostMs: h ?? -1,
        guestMs: gu ?? -1,
        over,
      })
      resultTimer.current = window.setTimeout(() => {
        if (over) {
          g.phase = 'over'
          render()
        } else {
          g.round++
          hostArm()
        }
      }, RESULT_MS)
    }

    // 로컬 탭 처리 (내가 호스트냐 게스트냐에 따라)
    const onlineReact = () => {
      if (g.online === 'host') {
        if (g.phase === 'waiting') {
          if (g.roundResolved) return
          if (waitTimer.current) window.clearTimeout(waitTimer.current)
          g.hostMs = -1 // 신호 전 → 부정출발
          showPendingSelf(-1, true)
          hostResolve()
        } else if (g.phase === 'signal') {
          if (g.hostMs !== null) return
          g.hostMs = Math.round(performance.now() - g.signalAt)
          if (canVibrate) navigator.vibrate(20)
          showPendingSelf(g.hostMs, false)
          hostResolve()
        }
      } else if (g.online === 'guest') {
        if (g.phase === 'waiting') {
          if (g.resolved) return
          g.resolved = true
          socket.emit('rx:react', { falseStart: true })
          showPendingSelf(-1, true)
        } else if (g.phase === 'signal') {
          if (g.resolved) return
          g.resolved = true
          const ms = Math.round(performance.now() - g.signalAt)
          if (canVibrate) navigator.vibrate(20)
          socket.emit('rx:react', { ms })
          showPendingSelf(ms, false)
        }
      }
    }
    onlineReactRef.current = onlineReact

    const startOnline = (role: 'host' | 'guest') => {
      g.mode = role === 'host' ? 'online-host' : 'online-guest'
      g.online = role
      g.round = 1
      g.winsP1 = 0
      g.winsP2 = 0
      g.hostMs = null
      g.guestMs = null
      g.roundResolved = false
      g.resolved = false
      g.last = { ms: 0, winner: 0, falseStart: false }
      if (role === 'host') hostArm()
      else {
        g.phase = 'waiting' // 게스트: 호스트의 arm/신호를 기다림
        render()
      }
    }
    startOnlineRef.current = startOnline

    // ── 소켓 수신 ──
    const onArm = (data: { round: number }) => {
      if (g.online !== 'guest') return
      if (data?.round === 1) {
        g.winsP1 = 0
        g.winsP2 = 0
      } // 새 매치/재대결이면 점수 초기화
      g.phase = 'waiting'
      g.resolved = false
      g.signalAt = 0
      g.last = { ms: 0, winner: 0, falseStart: false }
      render()
    }
    const onSignal = () => {
      if (g.online !== 'guest') return
      g.phase = 'signal'
      g.signalAt = performance.now()
      g.resolved = false
      if (canVibrate) navigator.vibrate([0, 40, 30, 60])
      render()
    }
    const onReact = (data: { ms?: number; falseStart?: boolean }) => {
      if (g.online !== 'host') return
      if (g.guestMs !== null) return
      g.guestMs = data.falseStart ? -1 : Math.round(data.ms ?? 0)
      // 게스트가 신호 전에 눌러 부정출발이면 대기 타이머 취소 후 즉시 판정
      if (g.guestMs === -1 && g.phase === 'waiting' && waitTimer.current) {
        window.clearTimeout(waitTimer.current)
      }
      hostResolve()
    }
    const onRound = (d: {
      s1: number
      s2: number
      winner: 0 | 1 | 2
      hostMs: number
      guestMs: number
      over: boolean
    }) => {
      if (g.online !== 'guest') return
      g.winsP1 = d.s1
      g.winsP2 = d.s2
      g.roundResolved = true
      g.last = {
        ms: d.guestMs,
        oppMs: d.hostMs,
        winner: d.winner,
        falseStart: d.hostMs === -1 || d.guestMs === -1,
        pending: false,
      }
      g.phase = d.over ? 'over' : 'result'
      render()
    }
    const onLeft = () => {
      if (g.online) setOppLeft(true)
    }
    socket.on('rx:arm', onArm)
    socket.on('rx:signal', onSignal)
    socket.on('rx:react', onReact)
    socket.on('rx:round', onRound)
    socket.on('rx:left', onLeft)
    return () => {
      socket.off('rx:arm', onArm)
      socket.off('rx:signal', onSignal)
      socket.off('rx:react', onReact)
      socket.off('rx:round', onRound)
      socket.off('rx:left', onLeft)
    }
  }, [])

  const startMode = (mode: Mode) => {
    unlockAudio()
    const g = m.current
    g.mode = mode
    g.online = null
    g.round = 1
    g.soloTimes = []
    g.winsP1 = 0
    g.winsP2 = 0
    g.last = { ms: 0, winner: 0, falseStart: false }
    enterWaiting()
  }

  // 온라인 로비 매칭 완료 → 시작
  const onMatched = useCallback((role: 'host' | 'guest') => {
    unlockAudio()
    setLobbyOpen(false)
    setOppLeft(false)
    startOnlineRef.current(role)
  }, [])

  // 메뉴에서 모드 선택 → (모션 모드면) 센서 권한 요청 후 시작.
  //  이 클릭이 "사용자 제스처"라서 iOS 동작센서·오디오 권한을 여기서 얻는다.
  const begin = async (choice: 'solo' | 'duo' | 'online') => {
    unlockAudio()
    if (choice !== 'duo') {
      // solo/online 은 폰 휘두르기 사용 → 권한 요청(안드로이드는 즉시 granted)
      await requestPermission()
      setMotionOn(true)
    }
    if (choice === 'online') setLobbyOpen(true)
    else startMode(choice)
  }

  const g = m.current

  // solo/online 에서 "어떻게 반응하는지" 안내 문구.
  //  우선순위: 폰 컨트롤러 연결 > 노트북/PC 키보드 > 폰 모션(권한 O) > 탭
  //  (노트북은 모션센서가 없어 motionOn 이 켜져도 스윙이 안 되므로 키보드 안내가 우선)
  const motionReady = motionOn && permission === 'granted'
  const reactHint = phoneConnected
    ? { wait: '🔴 초록이 되면 폰을 휘둘러!', act: '휘둘러!' }
    : likelyKeyboard
      ? { wait: '🔴 초록이 되면 스페이스바!', act: 'SPACE' }
      : motionReady
        ? { wait: '🔴 초록이 되면 폰을 휘둘러!', act: '휘둘러!' }
        : { wait: '🔴 초록이 되면 탭!', act: 'TAP' }

  // ── 화면 ──
  return (
    <div className="fixed inset-0 flex flex-col bg-[#120306] text-white select-none overflow-hidden">
      {/* 상단 바 (메뉴/결과에서만 또렷하게; 플레이 중엔 방해 안 되게 흐리게) */}
      <div className="absolute top-0 inset-x-0 z-30 flex items-center justify-between px-4 py-2.5">
        <button
          onClick={onExit}
          className="text-sm text-white/70 hover:text-white"
          style={{ opacity: g.phase === 'menu' || g.phase === 'over' ? 1 : 0.35 }}
        >
          ‹ 게임 선택
        </button>
        {/* 입력 상태 배지: 폰컨트롤러>노트북키보드>폰모션>탭 (reactHint 우선순위와 일치) */}
        {g.mode !== 'duo' &&
          (phoneConnected ? (
            <span className="text-xs rounded-full px-3 py-1 border border-[#4ade80]/60 text-[#4ade80]">
              🎮 폰 휘두르기
            </span>
          ) : likelyKeyboard ? (
            <span className="text-xs rounded-full px-3 py-1 border border-[#fbbf24]/60 text-[#fbbf24]">
              ⌨️ Space
            </span>
          ) : motionOn ? (
            <span
              className={`text-xs rounded-full px-3 py-1 border ${
                permission === 'granted'
                  ? 'border-[#4ade80]/60 text-[#4ade80]'
                  : 'border-white/20 text-white/50'
              }`}
            >
              {permission === 'granted' ? '📳 휘두르기 ON' : '📳 탭으로 진행'}
            </span>
          ) : null)}
      </div>

      {/* 본문 (모드별) */}
      {g.phase === 'menu' && (
        <Menu onSelect={(mode) => begin(mode)} onOnline={() => begin('online')} />
      )}

      {g.phase === 'over' &&
        (g.online ? (
          <OnlineOver
            machine={g}
            role={g.online}
            onRestart={() => startOnlineRef.current('host')}
            onExit={onExit}
          />
        ) : (
          <Over machine={g} onRetry={() => startMode(g.mode)} onExit={onExit} />
        ))}

      {/* 플레이 화면 (waiting/signal/result) */}
      {(g.phase === 'waiting' || g.phase === 'signal' || g.phase === 'result') &&
        (g.online ? (
          <OnlinePlay machine={g} role={g.online} hint={reactHint} onReact={() => react(0)} />
        ) : g.mode === 'solo' ? (
          <SoloPlay machine={g} hint={reactHint} onReact={() => react(0)} />
        ) : (
          <DuoPlay machine={g} onReact={react} />
        ))}

      {/* 온라인 로비 */}
      {lobbyOpen && (
        <MatchLobby
          prefix="rx"
          title="반응속도 배틀"
          accent="#f59e0b"
          onMatched={onMatched}
          onCancel={() => setLobbyOpen(false)}
        />
      )}

      {/* 상대 이탈 */}
      {oppLeft && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/92 px-6">
          <div className="text-5xl mb-2">🔌</div>
          <h2 className="text-xl font-black mb-1">상대가 나갔어요</h2>
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

// ── 메뉴 ──
function Menu({
  onSelect,
  onOnline,
}: {
  onSelect: (m: 'solo' | 'duo') => void
  onOnline: () => void
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="text-6xl mb-3 animate-pulse-slow">⚡</div>
      <h1
        className="text-3xl font-black tracking-tight mb-1"
        style={{ textShadow: '0 0 24px rgba(239,68,68,0.6)' }}
      >
        반응속도 배틀
      </h1>
      <p className="text-white/50 text-sm text-center mb-8 leading-relaxed">
        초록 신호가 뜨는 <b className="text-white">그 순간</b> 폰을 <b className="text-white">확! 휘둘러</b> 뽑기!
        <br />
        신호 전에 움직이면 부정 출발이에요. (권총 뽑기 결투처럼)
      </p>
      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={() => onSelect('solo')}
          className="px-6 py-4 rounded-2xl font-black text-lg active:brightness-110"
          style={{ background: 'linear-gradient(120deg,#f59e0b,#ef4444)', boxShadow: '0 8px 24px rgba(239,68,68,0.3)' }}
        >
          🤠 혼자 · 뽑기 기록 도전
        </button>
        <button
          onClick={onOnline}
          className="px-6 py-4 rounded-2xl font-black text-lg bg-white/10 active:bg-white/20 border border-[#f59e0b]/40 text-[#fbbf24]"
        >
          🔫 온라인 1:1 · 폰 뽑기 결투 (5판 3선)
        </button>
        <button
          onClick={() => onSelect('duo')}
          className="px-6 py-4 rounded-2xl font-bold text-base bg-white/8 active:bg-white/15 text-white/80"
        >
          🤜 2인 · 한 폰 나눠 탭 (위/아래)
        </button>
      </div>
      {likelyKeyboard ? (
        <div className="mt-7 flex flex-col items-center gap-1.5 text-center">
          <span className="text-white/45 text-xs">⌨️ 노트북/PC 조작</span>
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="flex h-7 items-center justify-center rounded-md border border-[#fbbf24]/60 bg-[#fbbf24]/10 px-3 font-black text-[#fbbf24]">
              Space
            </span>
            <span className="text-white/45">혼자·온라인 반응</span>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/40 bg-white/10 font-black">
              A
            </span>
            <span className="flex h-7 w-7 items-center justify-center rounded-md border border-white/40 bg-white/10 font-black">
              L
            </span>
            <span className="text-white/45">2인 대결(A·L) · 마우스 클릭도 OK</span>
          </div>
        </div>
      ) : (
        <p className="text-white/35 text-xs mt-7 text-center">
          폰을 <b className="text-white/60">휘둘러</b> 반응(센서 없으면 탭) · 2인은 한 폰을 위/아래로 탭
        </p>
      )}
    </div>
  )
}

// 조작 안내 문구 (대기 화면 / 신호 화면)
interface ReactHint {
  wait: string
  act: string
}

// ── solo 플레이 (풀스크린 한 장) ──
function SoloPlay({
  machine,
  hint,
  onReact,
}: {
  machine: Machine
  hint: ReactHint
  onReact: () => void
}) {
  const g = machine
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        onReact()
      }}
      className="flex-1 w-full flex flex-col items-center justify-center touch-none transition-colors duration-100"
      style={{ background: panelBg(g.phase, g.last) }}
    >
      <Progress round={g.round} total={ROUNDS} />
      <PanelContent phase={g.phase} last={g.last} hint={hint} />
    </button>
  )
}

// ── duo 플레이 (위/아래 반반, 위쪽은 180° 회전해서 마주보고 플레이) ──
function DuoPlay({
  machine,
  onReact,
}: {
  machine: Machine
  onReact: (p: 1 | 2) => void
}) {
  const g = machine
  const bg = panelBg(g.phase, g.last)
  // 노트북 키보드면 각 플레이어가 누를 키(A/L)를, 아니면 탭을 안내
  const duoHint = (p: 1 | 2): ReactHint =>
    likelyKeyboard
      ? { wait: `🔴 초록 뜨면 ${DUO_KEYS[p].label}!`, act: `${DUO_KEYS[p].label} 키!` }
      : { wait: '🔴 초록 뜨면 탭!', act: 'TAP' }
  return (
    <div className="flex-1 w-full flex flex-col">
      {/* 위쪽(P1) — 회전 */}
      <button
        onPointerDown={(e) => {
          e.preventDefault()
          onReact(1)
        }}
        className="flex-1 w-full flex flex-col items-center justify-center touch-none border-b-2 border-black/40 rotate-180 transition-colors duration-100"
        style={{ background: g.phase === 'result' ? duoHalfBg(g, 1) : bg }}
      >
        <span className="label-mono text-white/50 mb-1">
          P1 · {g.winsP1}승{likelyKeyboard && ` · ${DUO_KEYS[1].label}키`}
        </span>
        <PanelContent phase={g.phase} last={g.last} player={1} hint={duoHint(1)} />
      </button>
      {/* 아래쪽(P2) */}
      <button
        onPointerDown={(e) => {
          e.preventDefault()
          onReact(2)
        }}
        className="flex-1 w-full flex flex-col items-center justify-center touch-none transition-colors duration-100"
        style={{ background: g.phase === 'result' ? duoHalfBg(g, 2) : bg }}
      >
        <span className="label-mono text-white/50 mb-1">
          P2 · {g.winsP2}승{likelyKeyboard && ` · ${DUO_KEYS[2].label}키`}
        </span>
        <PanelContent phase={g.phase} last={g.last} player={2} hint={duoHint(2)} />
      </button>
    </div>
  )
}

// ── 온라인 플레이 (풀스크린 1인칭 + 점수 HUD) ──
function OnlinePlay({
  machine,
  role,
  hint,
  onReact,
}: {
  machine: Machine
  role: 'host' | 'guest'
  hint: ReactHint
  onReact: () => void
}) {
  const g = machine
  const myWins = role === 'host' ? g.winsP1 : g.winsP2
  const oppWins = role === 'host' ? g.winsP2 : g.winsP1
  const me = role === 'host' ? 1 : 2
  // 배경: 대기(적)·신호(녹) 는 공통, 결과는 승패로 색을 정함
  let bg = panelBg(g.phase, g.last)
  if (g.phase === 'result') {
    if (g.last.pending) bg = 'linear-gradient(160deg,#0f172a,#020617)'
    else if (g.last.winner === 0) bg = 'linear-gradient(160deg,#1e293b,#020617)'
    else if (g.last.winner === me)
      bg = 'radial-gradient(circle at 50% 45%, #4ade80, #16a34a 75%)'
    else bg = 'linear-gradient(160deg,#7f1d1d,#1a0505)'
  }
  return (
    <button
      onPointerDown={(e) => {
        e.preventDefault()
        onReact()
      }}
      className="flex-1 w-full flex flex-col items-center justify-center touch-none transition-colors duration-100"
      style={{ background: bg }}
    >
      {/* 점수 HUD */}
      <div className="absolute top-14 flex items-center gap-2.5 pointer-events-none">
        <span className="label-mono text-white/55">나</span>
        <span className="text-2xl font-black tabular-nums text-white">{myWins}</span>
        <span className="text-white/30 font-black">:</span>
        <span className="text-2xl font-black tabular-nums text-white/70">{oppWins}</span>
        <span className="label-mono text-white/55">상대</span>
      </div>

      {g.phase === 'waiting' && (
        <div className="flex flex-col items-center pointer-events-none">
          <div className="text-2xl font-black text-white/85">가만히…</div>
          <div className="text-sm text-white/50 mt-1">{hint.wait}</div>
        </div>
      )}
      {g.phase === 'signal' && (
        <div className="flex flex-col items-center pointer-events-none">
          <div className="text-6xl font-black text-white animate-signal-pop drop-shadow-lg">지금!</div>
          <div className="text-lg font-bold text-white/80 mt-1 tracking-widest">{hint.act}</div>
        </div>
      )}
      {g.phase === 'result' && <OnlineResult last={g.last} role={role} />}
    </button>
  )
}

// 온라인 라운드 결과 텍스트 (내 반응 vs 상대 반응)
function OnlineResult({ last, role }: { last: Machine['last']; role: 'host' | 'guest' }) {
  const me = role === 'host' ? 1 : 2
  const fmt = (v: number) => (v === -1 ? '부정출발' : `${v}ms`)
  if (last.pending) {
    return (
      <div className="flex flex-col items-center pointer-events-none">
        {last.falseStart ? (
          <div className="text-3xl font-black text-[#f87171]">너무 빨라! 🚫</div>
        ) : (
          <div className="text-5xl font-black tabular-nums text-white">
            {last.ms}
            <span className="text-xl ml-1">ms</span>
          </div>
        )}
        <div className="text-sm text-white/60 mt-3 animate-pulse">상대 기다리는 중…</div>
      </div>
    )
  }
  const iWon = last.winner === me
  const draw = last.winner === 0
  return (
    <div className="flex flex-col items-center pointer-events-none">
      <div
        className="text-4xl font-black"
        style={{ color: draw ? '#e2e8f0' : iWon ? '#4ade80' : '#f87171' }}
      >
        {draw ? '무승부' : iWon ? '승! 🎉' : '졌다 😢'}
      </div>
      <div className="flex gap-5 mt-3 text-sm">
        <span className="text-white/85">
          나 <b className="tabular-nums">{fmt(last.ms)}</b>
        </span>
        <span className="text-white/50">
          상대 <b className="tabular-nums">{fmt(last.oppMs ?? -1)}</b>
        </span>
      </div>
    </div>
  )
}

// ── 온라인 종료 ──
function OnlineOver({
  machine,
  role,
  onRestart,
  onExit,
}: {
  machine: Machine
  role: 'host' | 'guest'
  onRestart: () => void
  onExit: () => void
}) {
  const g = machine
  const myWins = role === 'host' ? g.winsP1 : g.winsP2
  const oppWins = role === 'host' ? g.winsP2 : g.winsP1
  const iWin = myWins > oppWins
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="text-6xl mb-2">{iWin ? '🏆' : '😢'}</div>
      <h2 className="text-3xl font-black mb-2" style={{ color: iWin ? '#4ade80' : '#f87171' }}>
        {iWin ? '승리!' : '패배'}
      </h2>
      <div className="text-2xl font-black tabular-nums text-white/90 mb-6">
        {myWins} : {oppWins}
      </div>
      {role === 'host' ? (
        <button
          onClick={onRestart}
          className="px-8 py-3 rounded-2xl font-black active:brightness-110"
          style={{ background: 'linear-gradient(120deg,#f59e0b,#ef4444)' }}
        >
          다시 대결
        </button>
      ) : (
        <p className="text-sm text-white/50">방장이 다시 시작하면 이어집니다…</p>
      )}
      <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
        다른 게임 고르기
      </button>
    </div>
  )
}

// 패널 배경색 — 대기(짙은 적)·신호(폭발 녹)·결과(중립/녹/적)
function panelBg(phase: Phase, last: Machine['last']): string {
  if (phase === 'signal') return 'radial-gradient(circle at 50% 45%, #4ade80, #16a34a 70%, #15803d)'
  if (phase === 'waiting') return 'radial-gradient(circle at 50% 40%, #7f1d1d, #450a0a 75%, #1a0505)'
  // result
  if (last.falseStart) return 'linear-gradient(160deg,#7f1d1d,#450a0a)'
  return 'linear-gradient(160deg,#0f172a,#020617)'
}

// duo 결과: 이긴 쪽만 초록으로 강조
function duoHalfBg(g: Machine, player: 1 | 2): string {
  if (g.last.winner === player) return 'radial-gradient(circle at 50% 45%, #4ade80, #16a34a 75%)'
  return 'linear-gradient(160deg,#1a0505,#0a0203)'
}

// 패널 안 텍스트 (상태별). hint 로 대기/신호 안내 문구를 받는다(기기·모드별로 다름).
function PanelContent({
  phase,
  last,
  player,
  hint,
}: {
  phase: Phase
  last: Machine['last']
  player?: 1 | 2
  hint?: ReactHint
}) {
  if (phase === 'waiting') {
    return (
      <div className="flex flex-col items-center pointer-events-none">
        <div className="text-2xl font-black text-white/85">가만히…</div>
        <div className="text-sm text-white/50 mt-1">{hint?.wait ?? '🔴 초록이 되면 탭!'}</div>
      </div>
    )
  }
  if (phase === 'signal') {
    return (
      <div className="flex flex-col items-center pointer-events-none">
        <div className="text-6xl font-black text-white animate-signal-pop drop-shadow-lg">지금!</div>
        <div className="text-lg font-bold text-white/80 mt-1 tracking-widest">
          {hint?.act ?? 'TAP'}
        </div>
      </div>
    )
  }
  // result
  if (last.falseStart) {
    // duo 에선 부정 출발한 당사자에게만 "너무 빨라!", 상대에겐 "승!"
    if (player && last.winner) {
      const iWon = last.winner === player
      return (
        <div className="flex flex-col items-center pointer-events-none">
          <div className="text-3xl font-black" style={{ color: iWon ? '#4ade80' : '#f87171' }}>
            {iWon ? '승! 🎉' : '너무 빨라! 🚫'}
          </div>
        </div>
      )
    }
    return (
      <div className="flex flex-col items-center pointer-events-none">
        <div className="text-4xl font-black text-[#f87171]">너무 빨라! 🚫</div>
        <div className="text-sm text-white/50 mt-2">신호를 기다렸다가 누르세요</div>
      </div>
    )
  }
  // 정상 반응
  const r = rankOf(last.ms)
  if (player) {
    const iWon = last.winner === player
    return (
      <div className="flex flex-col items-center pointer-events-none">
        <div className="text-3xl font-black" style={{ color: iWon ? '#4ade80' : '#94a3b8' }}>
          {iWon ? `승! ${last.ms}ms` : '아쉽다'}
        </div>
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center pointer-events-none">
      <div className="text-6xl font-black tabular-nums" style={{ color: r.color }}>
        {last.ms}
        <span className="text-2xl ml-1">ms</span>
      </div>
      <div className="text-lg font-bold mt-2" style={{ color: r.color }}>
        {r.emoji} {r.title}
      </div>
    </div>
  )
}

// 라운드 진행 점 (solo)
function Progress({ round, total }: { round: number; total: number }) {
  return (
    <div className="absolute top-14 flex gap-1.5 pointer-events-none">
      {Array.from({ length: total }).map((_, i) => (
        <span
          key={i}
          className="h-1.5 rounded-full transition-all"
          style={{
            width: i + 1 === round ? 18 : 7,
            background: i + 1 <= round ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.25)',
          }}
        />
      ))}
    </div>
  )
}

// ── 종료 화면 ──
function Over({
  machine,
  onRetry,
  onExit,
}: {
  machine: Machine
  onRetry: () => void
  onExit: () => void
}) {
  const g = machine
  if (g.mode === 'solo') {
    const valid = g.soloTimes.filter((t) => t > 0)
    const best = valid.length ? Math.min(...valid) : 0
    const avg = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : 0
    const fouls = g.soloTimes.filter((t) => t < 0).length
    const r = best ? rankOf(best) : { title: '기록 없음', emoji: '🤔', color: '#94a3b8' }
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="text-5xl mb-2">{r.emoji}</div>
        <h2 className="text-2xl font-black mb-1" style={{ color: r.color }}>
          {r.title}
        </h2>
        <div className="flex items-end gap-2 my-4">
          <div className="text-center">
            <div className="label-mono text-white/40">BEST</div>
            <div className="text-5xl font-black tabular-nums" style={{ color: r.color }}>
              {best || '--'}
              <span className="text-xl ml-1">ms</span>
            </div>
          </div>
        </div>
        <div className="flex gap-6 text-sm text-white/70 mb-1">
          <span>
            평균 <b className="text-white tabular-nums">{avg || '--'}ms</b>
          </span>
          <span>
            부정출발 <b className="text-[#f87171] tabular-nums">{fouls}</b>
          </span>
        </div>
        {/* 라운드별 기록 */}
        <div className="flex gap-1.5 mt-4 flex-wrap justify-center max-w-xs">
          {g.soloTimes.map((t, i) => (
            <span
              key={i}
              className="text-xs font-bold tabular-nums rounded-lg px-2 py-1"
              style={{
                background: t < 0 ? 'rgba(248,113,113,0.15)' : 'rgba(255,255,255,0.08)',
                color: t < 0 ? '#f87171' : '#e2e8f0',
              }}
            >
              {t < 0 ? 'FOUL' : `${t}`}
            </span>
          ))}
        </div>
        <button
          onClick={onRetry}
          className="mt-8 px-8 py-3 rounded-2xl font-black active:brightness-110"
          style={{ background: 'linear-gradient(120deg,#f59e0b,#ef4444)' }}
        >
          다시 도전
        </button>
        <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
          다른 게임 고르기
        </button>
      </div>
    )
  }
  // duo
  const p1Win = g.winsP1 > g.winsP2
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6">
      <div className="text-5xl mb-2">🏆</div>
      <h2 className="text-3xl font-black mb-2" style={{ color: p1Win ? '#22d3ee' : '#f59e0b' }}>
        P{p1Win ? 1 : 2} 승리!
      </h2>
      <div className="text-2xl font-black tabular-nums text-white/90 mb-6">
        {g.winsP1} : {g.winsP2}
      </div>
      <button
        onClick={onRetry}
        className="px-8 py-3 rounded-2xl font-black active:brightness-110"
        style={{ background: 'linear-gradient(120deg,#f59e0b,#ef4444)' }}
      >
        다시 대결
      </button>
      <button onClick={onExit} className="mt-3 text-sm text-white/50 underline">
        다른 게임 고르기
      </button>
    </div>
  )
}

