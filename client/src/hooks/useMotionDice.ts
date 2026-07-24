import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useMotionDice
 * -------------------------------------------------------------
 * 스마트폰의 DeviceMotion(가속도) 센서를 읽어서
 *   - "흔들기"(shake)  → 주사위를 굴리는 중
 *   - "던지기"(throw)  → 강한 가속 스파이크로 결과 확정
 * 두 가지 동작을 감지해 콜백으로 알려주는 훅.
 *
 * 왜 이렇게 나눴나:
 *  - 센서 원시값은 이 훅 안에서만 계산하고(로컬 계산), 바깥에는
 *    "흔들었다 / 던졌다" 같은 의미 있는 이벤트만 넘긴다.
 *    (요구사항: 원시 센서값을 서버로 스트리밍하지 않는다.)
 *
 * iOS(사파리) 주의:
 *  - iOS 13+ 는 DeviceMotionEvent.requestPermission() 을 반드시
 *    "사용자 탭(클릭) 이벤트 안에서" 호출해야 권한 팝업이 뜬다.
 *    → 그래서 requestPermission() 함수를 버튼 onClick 에 연결한다.
 *  - https(보안 컨텍스트) 가 아니면 센서 자체가 동작하지 않는다.
 */

// 센서 권한 상태
export type MotionPermission =
  | 'unknown' // 아직 요청 안 함
  | 'granted' // 허용됨 → 센서 동작 중
  | 'denied' // 사용자가 거부함
  | 'unsupported' // 이 기기/브라우저가 DeviceMotion 미지원

// --- 감지 민감도(임계값). 실제 폰에서 테스트하며 숫자를 조정하면 된다. ---
// 중력을 제외한 순수 가속도 크기(m/s^2) 기준.
const SHAKE_COOLDOWN_MS = 120 // 흔들기 이벤트가 너무 촘촘히 발생하지 않게 최소 간격
const THROW_COOLDOWN_MS = 800 // 던지기 한 번 뒤 잠깐 무시(중복 확정 방지)

// 민감도 3단계 → 흔들기/던지기 임계값. 숫자가 낮을수록 민감(약한 움직임에도 반응).
export type Sensitivity = 'stable' | 'normal' | 'sensitive'
const THRESHOLDS: Record<Sensitivity, { shake: number; throw: number }> = {
  stable: { shake: 16, throw: 32 }, // 안정: 세게 움직여야 반응
  normal: { shake: 12, throw: 26 }, // 보통(기본)
  sensitive: { shake: 8, throw: 20 }, // 민감: 살짝만 움직여도 반응
}

interface UseMotionDiceOptions {
  /** 흔드는 중일 때 반복 호출 (주사위 굴러가는 연출/진동에 사용) */
  onShake?: () => void
  /** 강하게 던졌을 때 1회 호출 (결과 확정에 사용) */
  onThrow?: () => void
  /** 기능이 켜져 있어야만 센서 이벤트를 처리 (대기실 등에서 잠그기 위함) */
  enabled?: boolean
  /** 민감도 (안정/보통/민감) */
  sensitivity?: Sensitivity
}

export function useMotionDice(options: UseMotionDiceOptions = {}) {
  const { onShake, onThrow, enabled = true, sensitivity = 'normal' } = options
  const th = THRESHOLDS[sensitivity]

  const [permission, setPermission] = useState<MotionPermission>('unknown')
  // 화면에 실시간으로 보여줄 현재 가속도 크기 (임계값 튜닝/디버그용)
  const [magnitude, setMagnitude] = useState(0)

  // 콜백을 ref 에 담아두면, 콜백이 바뀌어도 이벤트 리스너를 다시 붙일 필요가 없다.
  const onShakeRef = useRef(onShake)
  const onThrowRef = useRef(onThrow)
  const enabledRef = useRef(enabled)
  const thRef = useRef(th) // 민감도 임계값도 ref 로 (리스너 재등록 없이 반영)
  useEffect(() => {
    onShakeRef.current = onShake
    onThrowRef.current = onThrow
    enabledRef.current = enabled
    thRef.current = th
  }, [onShake, onThrow, enabled, th])

  // 마지막으로 이벤트를 발생시킨 시각(쿨다운 계산용)
  const lastShakeAt = useRef(0)
  const lastThrowAt = useRef(0)

  // devicemotion 이벤트 핸들러 (한 번만 만들어 재사용)
  const handleMotion = useCallback((event: DeviceMotionEvent) => {
    if (!enabledRef.current) return

    // acceleration: 중력이 제거된 순수 가속도. iOS/안드로이드 모두 우선 사용.
    // 일부 기기는 null 을 주므로 그럴 땐 accelerationIncludingGravity 로 폴백.
    const acc =
      event.acceleration && event.acceleration.x !== null
        ? event.acceleration
        : event.accelerationIncludingGravity

    if (!acc) return

    const x = acc.x ?? 0
    const y = acc.y ?? 0
    const z = acc.z ?? 0

    // 3축 벡터의 크기. 정지 상태면 0 근처(중력 포함 폴백이면 ~9.8)에서 움직인다.
    const mag = Math.sqrt(x * x + y * y + z * z)
    setMagnitude(mag)

    const now = Date.now()

    // 1) 던지기: 아주 강한 한 방 (가장 먼저 검사해서 흔들기와 겹치지 않게)
    if (mag >= thRef.current.throw && now - lastThrowAt.current > THROW_COOLDOWN_MS) {
      lastThrowAt.current = now
      lastShakeAt.current = now // 던진 직후 흔들기도 잠깐 쉼
      onThrowRef.current?.()
      return
    }

    // 2) 흔들기: 중간 세기로 계속 흔드는 중
    if (mag >= thRef.current.shake && now - lastShakeAt.current > SHAKE_COOLDOWN_MS) {
      lastShakeAt.current = now
      onShakeRef.current?.()
    }
  }, [])

  /**
   * 센서 권한 요청 + 리스너 등록.
   * 반드시 버튼 클릭 같은 사용자 제스처 안에서 호출할 것! (iOS 요구사항)
   */
  const requestPermission = useCallback(async () => {
    // 이 브라우저가 DeviceMotion 자체를 모르는 경우
    if (typeof DeviceMotionEvent === 'undefined') {
      setPermission('unsupported')
      return
    }

    // iOS 13+ : requestPermission() 이 함수로 존재한다.
    const anyDME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }

    try {
      if (typeof anyDME.requestPermission === 'function') {
        const result = await anyDME.requestPermission()
        if (result === 'granted') {
          window.addEventListener('devicemotion', handleMotion)
          setPermission('granted')
        } else {
          setPermission('denied')
        }
      } else {
        // 안드로이드(Chrome) 등: 별도 권한 팝업 없이 바로 리스너 등록하면 됨.
        window.addEventListener('devicemotion', handleMotion)
        setPermission('granted')
      }
    } catch {
      // requestPermission 이 https 아님 등으로 실패하는 경우
      setPermission('denied')
    }
  }, [handleMotion])

  // 컴포넌트가 사라질 때 리스너 정리
  useEffect(() => {
    return () => window.removeEventListener('devicemotion', handleMotion)
  }, [handleMotion])

  return { permission, magnitude, requestPermission }
}
