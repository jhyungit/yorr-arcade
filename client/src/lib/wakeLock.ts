import { useEffect } from 'react'

/**
 * useWakeLock — 플레이 중 화면이 꺼지지 않게 한다
 * -------------------------------------------------------------
 * 턴제라 "남의 차례를 기다리는" 시간이 길다. 그동안 폰이 손에서 쉬면
 * 화면이 잠기고 소켓이 끊겨 재접속 처리가 돌아 버린다.
 *
 * Screen Wake Lock API 는 https + 지원 브라우저(크롬/엣지 계열)에서만 된다.
 * 없으면 조용히 넘어간다 (사파리는 미지원 — 재접속 로직이 받쳐 준다).
 * 탭이 백그라운드로 가면 잠금이 자동 해제되므로, 돌아올 때 다시 잡는다.
 */
interface WakeLockSentinelLike {
  released: boolean
  release: () => Promise<void>
}

export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const nav = navigator as Navigator & {
      wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> }
    }
    if (!nav.wakeLock) return

    let sentinel: WakeLockSentinelLike | null = null
    let cancelled = false

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return
      if (sentinel && !sentinel.released) return
      try {
        sentinel = await nav.wakeLock!.request('screen')
      } catch {
        // 배터리 절약 모드 등 — 게임에는 영향 없다
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') void acquire()
    }

    void acquire()
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisible)
      if (sentinel && !sentinel.released) void sentinel.release()
    }
  }, [enabled])
}
