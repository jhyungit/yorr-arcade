import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * useSwing
 * -------------------------------------------------------------
 * 휴대폰을 "왕복으로 스윙"하는 동작을 DeviceMotion(가속도)으로 감지해
 * onSwing() 을 호출한다. (탁구 라켓 휘두르기 트리거)
 *
 * - 스윙 = 순간 가속도 크기가 임계값을 넘는 스파이크. 쿨다운으로 왕복 중
 *   과도하게 여러 번 잡히지 않게 한다.
 * - iOS 13+ 는 requestPermission() 을 버튼 탭 안에서 호출해야 한다(HTTPS 필수).
 * - 연결/권한이 없으면 게임은 마우스 클릭으로 스윙 (이 훅과 무관하게 동작).
 */

export type SwingPermission = 'unknown' | 'granted' | 'denied' | 'unsupported'

const SWING_COOLDOWN_MS = 220 // 스윙 사이 최소 간격
const DEFAULT_THRESHOLD = 14 // 스윙으로 볼 가속도 크기(m/s^2)

interface UseSwingOptions {
  onSwing: () => void
  enabled?: boolean
  threshold?: number
}

export function useSwing({ onSwing, enabled = true, threshold = DEFAULT_THRESHOLD }: UseSwingOptions) {
  const [permission, setPermission] = useState<SwingPermission>('unknown')

  const onSwingRef = useRef(onSwing)
  const enabledRef = useRef(enabled)
  const thresholdRef = useRef(threshold)
  useEffect(() => {
    onSwingRef.current = onSwing
    enabledRef.current = enabled
    thresholdRef.current = threshold
  }, [onSwing, enabled, threshold])

  const lastSwingAt = useRef(0)

  const handleMotion = useCallback((e: DeviceMotionEvent) => {
    if (!enabledRef.current) return
    const acc =
      e.acceleration && e.acceleration.x !== null ? e.acceleration : e.accelerationIncludingGravity
    if (!acc) return
    const x = acc.x ?? 0
    const y = acc.y ?? 0
    const z = acc.z ?? 0
    const mag = Math.sqrt(x * x + y * y + z * z)
    const now = Date.now()
    if (mag >= thresholdRef.current && now - lastSwingAt.current > SWING_COOLDOWN_MS) {
      lastSwingAt.current = now
      onSwingRef.current()
    }
  }, [])

  /** 버튼 탭 안에서 호출 (iOS 권한 팝업) */
  const requestPermission = useCallback(async () => {
    if (typeof DeviceMotionEvent === 'undefined') {
      setPermission('unsupported')
      return
    }
    const anyDME = DeviceMotionEvent as unknown as {
      requestPermission?: () => Promise<'granted' | 'denied'>
    }
    try {
      if (typeof anyDME.requestPermission === 'function') {
        const res = await anyDME.requestPermission()
        if (res === 'granted') {
          window.addEventListener('devicemotion', handleMotion)
          setPermission('granted')
        } else {
          setPermission('denied')
        }
      } else {
        window.addEventListener('devicemotion', handleMotion)
        setPermission('granted')
      }
    } catch {
      setPermission('denied')
    }
  }, [handleMotion])

  useEffect(() => () => window.removeEventListener('devicemotion', handleMotion), [handleMotion])

  return { permission, requestPermission }
}
