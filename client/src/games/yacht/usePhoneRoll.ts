import { useEffect, useRef } from 'react'
import { socket } from '../../net/socket'

/**
 * usePhoneRoll — 폰 컨트롤러로 주사위 굴리기 (요트 공용)
 * -------------------------------------------------------------
 * 허브에서 폰을 페어링해 두면(`pair:*`), 폰을 흔들 때마다 서버가 이 화면으로
 * `ctrl:swing` 을 중계한다. 다른 게임들(핑퐁·리듬탭·퀵드로우)은 각자 이걸 듣고
 * 있었는데 요트만 빠져 있어서 "폰 연동이 안 되는" 상태였다.
 *
 * 두 가지를 맡는다.
 *  1) ctrl:swing → onRoll  (연타 방지 디바운스 포함)
 *  2) 주사위가 멈추면 폰으로 진동 신호(game:hit) — 손에도 착지가 전해진다
 *
 * 폰의 로컬 센서로 굴리는 경우(useMotionDice)와는 별개다.
 * 노트북을 화면으로 쓰고 폰을 흔드는 경로가 이 훅이다.
 */

/** 한 번 흔든 게 여러 번으로 잡히는 걸 막는다 (굴리는 연출이 ~1.5초) */
const ROLL_DEBOUNCE_MS = 900

/**
 * 주사위가 다 멈췄다 → 붙어 있는 폰 전부에 짧은 진동.
 * (player 를 안 실어 보내면 Controller 가 "모든 폰" 으로 해석한다)
 * 훅이 아니라 그냥 함수다 — 선언 순서에 얽히지 않게.
 */
export function notifyDiceLanded() {
  socket.emit('game:hit', { kind: 'dice' })
}

export function usePhoneRoll({ onRoll, enabled }: { onRoll: () => void; enabled: boolean }) {
  // 최신 콜백을 ref 로 들고 있어야 매번 소켓 리스너를 다시 달지 않는다
  const rollRef = useRef(onRoll)
  const enabledRef = useRef(enabled)
  const lastAt = useRef(0)
  rollRef.current = onRoll
  enabledRef.current = enabled

  useEffect(() => {
    const onSwing = () => {
      if (!enabledRef.current) return
      const now = Date.now()
      if (now - lastAt.current < ROLL_DEBOUNCE_MS) return
      lastAt.current = now
      rollRef.current()
    }
    socket.on('ctrl:swing', onSwing)
    return () => {
      socket.off('ctrl:swing', onSwing)
    }
  }, [])
}
