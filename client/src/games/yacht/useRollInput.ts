import { useCallback, useEffect, useRef } from 'react'
import { socket } from '../../net/socket'
import { useMotionDice } from '../../hooks/useMotionDice'

/**
 * useRollInput — "주사위를 굴려라" 를 유발하는 입력을 한곳에 모은다
 * -------------------------------------------------------------
 * 굴리기 입력이 세 갈래다.
 *   ① 화면의 굴리기 버튼
 *   ② 이 기기의 센서 (폰에서 직접 플레이 — useMotionDice)
 *   ③ 페어링한 폰을 흔들기 (노트북이 화면 — ctrl:swing)
 * 세 갈래가 각자 roll() 을 부르게 두면 디바운스를 어디 한 곳에 빠뜨리게 된다.
 * 실제로 그래서 "한 번 흔들었는데 기회가 2개 사라지는" 버그가 났다.
 *
 * 왜 디바운스가 반드시 필요한가
 *   useMotionDice 의 onShake 는 설계상 "흔드는 동안 반복 호출"되는 이벤트다
 *   (쿨다운 120ms). 한 번의 흔들기 제스처가 2~4번 발생한다.
 *   멀티플레이에서는 roll() 이 서버에 요청만 보내고, 남은 횟수는 서버 응답이
 *   돌아와야 줄어든다. 즉 왕복 지연(배포 서버는 더 길다) 동안 "아직 굴릴 수 있음"
 *   상태가 유지되므로 두 번째·세 번째 이벤트가 그대로 통과해 기회를 더 먹는다.
 *   → 로컬에서는 지연이 짧아 안 보이고 배포 후에야 드러난다.
 *
 * 그래서 이 훅이 requestRoll 하나만 노출하고, 모든 입력은 그것만 쓴다.
 */

/** 한 번의 제스처(또는 연타)를 한 번의 굴리기로 접는다. 굴리는 연출이 1.5~3.2초 */
const ROLL_DEBOUNCE_MS = 1200

/**
 * 주사위가 다 멈췄다 → 붙어 있는 폰 전부에 짧은 진동.
 * (player 를 안 실어 보내면 Controller 가 "모든 폰" 으로 해석한다)
 * 훅이 아니라 그냥 함수다 — 선언 순서에 얽히지 않게.
 */
export function notifyDiceLanded() {
  socket.emit('game:hit', { kind: 'dice' })
}

interface UseRollInputOptions {
  /** 실제로 굴리는 동작 (솔로면 로컬 계산, 멀티면 서버에 요청) */
  roll: () => void
  /** 지금 굴릴 수 있는가 — 내 차례 · 굴리기 남음 · 구르는 중 아님 */
  canRoll: boolean
  /** 이 기기의 센서로 굴리기를 켰는가 (사용자가 버튼으로 허용) */
  motionOn: boolean
}

export function useRollInput({ roll, canRoll, motionOn }: UseRollInputOptions) {
  const rollRef = useRef(roll)
  const canRollRef = useRef(canRoll)
  const lastAt = useRef(0)
  rollRef.current = roll
  canRollRef.current = canRoll

  /** 모든 입력이 거쳐야 하는 단 하나의 입구 */
  const requestRoll = useCallback(() => {
    if (!canRollRef.current) return
    const now = Date.now()
    if (now - lastAt.current < ROLL_DEBOUNCE_MS) return
    lastAt.current = now
    rollRef.current()
  }, [])

  // ② 이 기기의 센서. onShake·onThrow 둘 다 같은 입구로 보낸다(디바운스가 접어 준다)
  const { permission, requestPermission } = useMotionDice({
    onShake: requestRoll,
    onThrow: requestRoll,
    enabled: motionOn && canRoll,
  })

  // ③ 페어링한 폰 흔들기 → 서버가 중계해 준 ctrl:swing
  useEffect(() => {
    const onSwing = () => requestRoll()
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [requestRoll])

  return { requestRoll, permission, requestPermission }
}
