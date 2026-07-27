import { useEffect, useRef, useState } from 'react'
import { socket } from '../../net/socket'
import { useSwing } from './useSwing'
import { canVibrate } from '../../lib/feedback'

/**
 * Controller — 폰을 "스윙 컨트롤러"로 사용하는 화면 (게임 공용)
 * -------------------------------------------------------------
 * 노트북(게임 화면)이 발급한 4자리 코드로 연결하면, 폰을 휘두를 때마다
 * ctrl:swing 을 서버로 보내고 → 서버가 노트북 게임으로 중계한다.
 * (게임 그림은 노트북에만, 폰은 컨트롤러 역할만)
 *
 * 어떤 게임의 컨트롤러인지는 노트북이 disp:game 으로 알려주면 폰 UI 가 맞춰진다.
 *  - pingpong(기본): 왕복 스윙 = 라켓 휘두르기.
 *  - rhythm: 비트에 맞춰 폰 내려치기 = 노트 치기. game:beat 마다 폰이 진동으로 비트를 전달.
 *
 * 접속: https://<노트북주소>:5173/?ctrl=CODE  (또는 코드 직접 입력)
 */
interface ControllerProps {
  initialCode: string
}

export default function Controller({ initialCode }: ControllerProps) {
  const [code, setCode] = useState(initialCode.toUpperCase())
  const [joined, setJoined] = useState(false)
  const [player, setPlayer] = useState(1)
  const [error, setError] = useState<string | null>(null)
  const [motionOn, setMotionOn] = useState(false)
  const [tiltOn, setTiltOn] = useState(false) // 슬래셔: 폰 기울기(모션)로 블레이드 조준 켜짐
  // 노트북(화면)이 disp:game 으로 알려줌. 게임 선택 전엔 'idle'(대기).
  const [game, setGame] = useState<'idle' | 'pingpong' | 'rhythm' | 'reaction' | 'slasher'>('idle')
  const swings = useRef(0)
  const [count, setCount] = useState(0)
  const playerRef = useRef(1)
  // 슬래셔 조준: 중립(기준) 방위/기울기 + 마지막 전송 시각(스로틀)
  //  a=alpha(yaw,좌우 포인팅) · g=gamma(roll, alpha 없을 때 폴백) · b=beta(미사용, 세로는 고정)
  const tiltNeutral = useRef<{ a: number; b: number; g: number; has: boolean }>({
    a: 0,
    b: 0,
    g: 0,
    has: false,
  })
  const lastAim = useRef(0)
  const isRhythm = game === 'rhythm'
  const isReaction = game === 'reaction'
  const isSlasher = game === 'slasher'
  const isIdle = game === 'idle'
  const accent = isRhythm
    ? '#a855f7'
    : isReaction
      ? '#f59e0b'
      : isSlasher
        ? '#22d3ee'
        : isIdle
          ? '#64748b'
          : '#2b8fe0'

  // 스윙/그음 횟수 카운트
  const bump = () => {
    swings.current += 1
    setCount(swings.current)
  }

  // ── 슬래셔 모션 조준: 폰 기울기(deviceorientation) 권한 요청 + 켜기 ──
  const enableTilt = async () => {
    try {
      const DOE = DeviceOrientationEvent as unknown as {
        requestPermission?: () => Promise<'granted' | 'denied'>
      }
      if (typeof DOE?.requestPermission === 'function') {
        const res = await DOE.requestPermission()
        if (res !== 'granted') {
          setError('센서 권한이 필요해요. 브라우저에서 동작/방향 접근을 허용해 주세요.')
          return
        }
      }
    } catch {
      /* 방향센서 불가 환경 — 무시 */
    }
    tiltNeutral.current.has = false // 켤 때 지금 자세를 화면 중앙으로
    setTiltOn(true)
  }
  const recenter = () => {
    tiltNeutral.current.has = false
  }

  const { permission, requestPermission } = useSwing({
    onSwing: () => {
      socket.emit('ctrl:swing')
      bump()
    },
    enabled: joined && motionOn,
  })

  // 노트북 신호 수신: 연결 끊김 + "쳤다!" 진동/피드백
  useEffect(() => {
    const onDisp = () => {
      setJoined(false)
      setError('게임 화면 연결이 끊겼어요. 노트북에서 다시 시작하거나 코드를 확인하세요.')
    }
    // 내 플레이어가 실제로 공을 맞춘 순간 → 안드로이드만 진동 (아이폰은 미지원이라 무동작)
    //  kind: 'smash'=강한 임팩트 · 'foul'=부정출발 경고(짜증나는 3연타) · 그 외=기본
    const onHit = (d?: { player?: number; kind?: string }) => {
      if ((d?.player ?? 1) !== playerRef.current) return
      if (!canVibrate) return
      if (d?.kind === 'smash') navigator.vibrate([0, 60, 40, 120])
      else if (d?.kind === 'foul') navigator.vibrate([0, 90, 60, 90, 60, 90])
      else navigator.vibrate(35)
    }
    // 노트북이 게임 종류를 알려줌 → 폰 UI 적응 (idle=게임 선택 대기)
    const onGame = (d?: { game?: string }) => {
      if (
        d?.game === 'rhythm' ||
        d?.game === 'pingpong' ||
        d?.game === 'reaction' ||
        d?.game === 'slasher' ||
        d?.game === 'idle'
      ) {
        setGame(d.game as 'idle' | 'pingpong' | 'rhythm' | 'reaction' | 'slasher')
      }
    }
    // 리듬: 매 박 신호 → 짧게 진동 (손으로 비트 느끼기)
    const onBeat = () => {
      if (canVibrate) navigator.vibrate(10)
    }
    socket.on('display:disconnected', onDisp)
    socket.on('ctrl:hit', onHit)
    socket.on('disp:game', onGame)
    socket.on('game:beat', onBeat)
    return () => {
      socket.off('display:disconnected', onDisp)
      socket.off('ctrl:hit', onHit)
      socket.off('disp:game', onGame)
      socket.off('game:beat', onBeat)
    }
  }, [])

  const join = () => {
    setError(null)
    socket.emit('pair:join', code, (ack: { ok: boolean; error?: string; player?: number }) => {
      if (ack.ok) {
        setJoined(true)
        setPlayer(ack.player ?? 1)
        playerRef.current = ack.player ?? 1
      } else setError(ack.error ?? '연결 실패')
    })
  }

  // URL 에 코드가 담겨 들어오면(?ctrl=CODE) 코드 입력 없이 자동으로 연결 시도.
  // (노트북 화면의 주소/QR 로 폰이 바로 접속하는 경로 → 코드 타이핑 불필요)
  const autoTried = useRef(false)
  useEffect(() => {
    if (!autoTried.current && initialCode.trim().length === 4) {
      autoTried.current = true
      join()
    }
    // eslint 규칙 없음: 최초 1회만 실행
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const enableMotion = async () => {
    await requestPermission()
    setMotionOn(true)
  }

  // 슬래셔 조준 스트리밍: 폰을 "레이저 포인터"처럼 화면에 겨눠 조준.
  //  - 좌우(x): 폰을 좌우로 "돌려(yaw=alpha)" 겨눔 → 겨눈 방향으로 블레이드가 감 (기울이기 아님)
  //  - 상하(y): 폰을 상하로 "까딱(pitch=beta)" → 겨눈 높이로
  //  좌우·상하 모두 '베기 시작'/'중앙 재정렬' 누른 순간 자세를 정중앙(0.5,0.5)으로 잡는다.
  //  (alpha 없는 기기는 좌우를 gamma 기울기로 폴백)
  useEffect(() => {
    if (!(tiltOn && isSlasher && joined)) return
    const YAW_SENS = 26 // 좌우(포인팅) 감도: 이 각도(도)만큼 돌리면 화면 절반. 작을수록 민감
    const BETA_SENS = 26 // 상하 감도
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v)
    const onOrient = (e: DeviceOrientationEvent) => {
      if (e.beta == null) return
      const n = tiltNeutral.current
      if (!n.has) {
        // 지금 자세를 좌우·상하 모두 중앙 기준으로 캡처 (재정렬 시 정중앙)
        n.a = e.alpha ?? 0
        n.g = e.gamma ?? 0
        n.b = e.beta
        n.has = true
      }
      // 좌우: 포인팅(yaw=alpha) 우선. alpha 없으면 기울기(gamma) 폴백.
      let x: number
      if (e.alpha != null) {
        let d = e.alpha - n.a
        d = ((d + 540) % 360) - 180 // -180~180 로 정규화(경계 넘어감 처리)
        x = clamp01(0.5 - d / (2 * YAW_SENS)) // 부호: 오른쪽으로 겨누면 오른쪽. 반대면 부호 뒤집기
      } else {
        x = clamp01(0.5 + ((e.gamma ?? 0) - n.g) / (2 * YAW_SENS))
      }
      // 상하 반전: 폰 위로 들면(까딱 올리면) 검도 위로 (y 는 위가 0)
      const y = clamp01(0.5 - (e.beta - n.b) / (2 * BETA_SENS))
      const now = Date.now()
      if (now - lastAim.current < 28) return // ~35Hz 스로틀
      lastAim.current = now
      socket.emit('ctrl:aim', { x, y })
    }
    window.addEventListener('deviceorientation', onOrient)
    return () => window.removeEventListener('deviceorientation', onOrient)
  }, [tiltOn, isSlasher, joined])

  return (
    <div className="fixed inset-0 flex flex-col items-center bg-[#0a0e16] text-white px-6 py-8 select-none">
      <div className="label-mono text-white/50">
        {isRhythm
          ? '리듬 스윙 · 컨트롤러'
          : isReaction
            ? '퀵드로우 · 컨트롤러'
            : isSlasher
              ? '스택 슬래셔 · 컨트롤러'
              : isIdle
                ? 'YORR · 컨트롤러'
                : 'PING · PONG · 컨트롤러'}
      </div>
      <div className="text-5xl mt-3 mb-1">
        {isRhythm ? '🥁' : isReaction ? '🤠' : isSlasher ? '🗡️' : isIdle ? '🎮' : '🏓'}
      </div>

      {!joined ? (
        // ── 연결 전: 코드 입력 ──
        <div className="w-full max-w-xs mt-6 flex flex-col items-center">
          <p className="text-white/70 text-sm text-center mb-4">
            노트북 게임 화면에 뜬 <b className="text-white">4자리 코드</b>를 입력하세요.
          </p>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="코드"
            className="w-full px-4 py-3 rounded-xl bg-white/10 text-center text-3xl tracking-[0.4em] font-black outline-none focus:ring-2 ring-[#2b8fe0]"
          />
          <button
            onClick={join}
            disabled={code.length < 4}
            className="w-full mt-4 py-4 rounded-2xl bg-[#2b8fe0] active:brightness-95 disabled:bg-white/10 disabled:text-white/40 font-bold text-lg"
          >
            연결하기
          </button>
          {error && <p className="text-red-400 text-sm mt-3 text-center">{error}</p>}
        </div>
      ) : (
        // ── 연결 후: 스윙 ──
        <div className="w-full max-w-xs mt-4 flex flex-col items-center">
          <p className="text-[#49e08a] text-sm mb-1">🟢 노트북에 연결됨</p>
          <p className="text-white/80 text-lg font-bold mb-5">
            {isRhythm
              ? '🥁 리듬 컨트롤러'
              : isReaction
                ? `🤠 퀵드로우 · P${player}`
                : isSlasher
                  ? '🗡️ 슬래셔 터치패드'
                  : isIdle
                    ? `게임 선택을 기다리는 중… (P${player})`
                    : `플레이어 ${player}`}
          </p>

          {isSlasher ? (
            // ── 슬래셔: 폰을 검처럼 들고 휘둘러 조준(모션). 화면 스와이프 아님! ──
            <div className="w-full flex flex-col items-center">
              {!tiltOn ? (
                <>
                  <p className="text-white/70 text-sm text-center mb-4">
                    폰을 <b className="text-white">검처럼 들고 휘둘러</b> 노트북 화면의 로고를 베는
                    게임이에요. 먼저 센서를 켜세요.
                  </p>
                  <button
                    onClick={enableTilt}
                    className="w-full py-4 rounded-2xl active:brightness-95 font-bold text-lg"
                    style={{ background: accent }}
                  >
                    🗡️ 센서 켜고 검 들기
                  </button>
                  <p className="text-white/40 text-xs mt-3">
                    아이폰은 "동작·방향 접근" 팝업을 허용해 주세요.
                  </p>
                </>
              ) : (
                <>
                  <p className="text-white/60 text-sm text-center mb-4">
                    폰을 <b className="text-white">레이저처럼 화면에 겨눠</b> 베세요. 겨누는 쪽으로
                    광선검이 움직여요. (빠르게 그을수록 잘 벰)
                  </p>
                  {/* ① 가운데 세팅 — 편한 자세에서 눌러 겨눔 기준을 정중앙으로 */}
                  <button
                    type="button"
                    onClick={recenter}
                    className="w-full py-5 rounded-2xl font-black text-xl active:brightness-95"
                    style={{ background: accent, boxShadow: `0 8px 24px ${accent}55` }}
                  >
                    🎯 가운데 세팅
                  </button>
                  <p className="text-white/50 text-xs mt-3 text-center leading-relaxed">
                    편한 자세에서 <b className="text-white/70">가운데 세팅</b> 후,
                    <br />
                    노트북 위쪽 <b className="text-[#22d3ee]">START</b> 를 <b className="text-white/70">베면 시작!</b>{' '}
                    (3·2·1)
                  </p>
                  <div className="mt-5 text-6xl animate-pulse-slow">🗡️</div>
                  {/* ② 폴백: 버튼으로 바로 시작/다시 (결과화면에서 재시작할 때도 사용) */}
                  <button
                    type="button"
                    onClick={() => {
                      socket.emit('ctrl:slash', { x: 0.5, y: 0.5, t: 'down' })
                      bump()
                    }}
                    className="mt-6 w-full py-3.5 rounded-2xl font-bold text-base text-white/90 border border-white/25 bg-white/10 active:bg-white/25 active:scale-95 transition"
                  >
                    ▶ 바로 시작 / 다시하기
                  </button>
                </>
              )}
            </div>
          ) : permission !== 'granted' ? (
            <>
              <p className="text-white/70 text-sm text-center mb-4">
                폰을 휘둘러 조종하려면 센서를 켜세요.
              </p>
              <button
                onClick={enableMotion}
                className="w-full py-4 rounded-2xl active:brightness-95 font-bold text-lg"
                style={{ background: accent }}
              >
                📳 센서 켜고 시작
              </button>
              <p className="text-white/40 text-xs mt-3">아이폰은 "동작 접근" 팝업을 허용해 주세요.</p>
            </>
          ) : (
            <p className="text-white/60 text-sm text-center mb-4">
              {isRhythm ? (
                <>
                  노트북 화면을 보며, 노트가 판정선에 닿을 때 폰을{' '}
                  <b className="text-white">아래로 탁!</b> 내려쳐요.
                </>
              ) : isReaction ? (
                <>
                  노트북 화면의 신호등이 <b className="text-[#4ade80]">초록</b>이 되는 순간 폰을{' '}
                  <b className="text-white">확! 휘둘러 뽑아요.</b> (신호 전엔 가만히 — 부정출발)
                </>
              ) : isIdle ? (
                <>
                  노트북에서 <b className="text-white">게임을 고르면</b> 여기가 자동으로 바뀌어요.
                  준비된 채로 기다리세요!
                </>
              ) : (
                <>
                  폰을 <b className="text-white">왕복으로 휘두르면</b> 노트북 라켓이 움직여요!
                </>
              )}
            </p>
          )}

          {/* 스윙 시각 피드백 + 탭 대체 버튼 (슬래셔는 터치패드라 제외) */}
          {!isSlasher && (
            <>
              <button
                onClick={() => {
                  socket.emit('ctrl:swing')
                  bump()
                }}
                className="mt-6 w-44 h-44 rounded-full flex items-center justify-center active:scale-95 transition-transform"
                style={{ background: `${accent}33`, border: `2px solid ${accent}` }}
              >
                <span className="text-6xl">
                  {isRhythm ? '🥁' : isReaction ? '🔫' : isIdle ? '🎮' : '🏓'}
                </span>
              </button>
              <p className="text-white/50 text-xs mt-4">
                {isRhythm
                  ? '버튼을 눌러도 쳐집니다'
                  : isReaction
                    ? '버튼을 눌러도 뽑힙니다'
                    : '버튼을 눌러도 스윙됩니다'}{' '}
                · 총 {count}회
              </p>
            </>
          )}
        </div>
      )}
    </div>
  )
}
