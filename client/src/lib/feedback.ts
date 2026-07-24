/**
 * feedback.ts
 * -------------------------------------------------------------
 * 흔들기/던지기에 대한 감각 피드백을 크로스 플랫폼으로 처리.
 *
 * - 진동(햅틱): 안드로이드 Chrome 은 navigator.vibrate 지원.
 *   iOS 사파리는 웹 진동을 지원하지 않으므로, 진동 대신
 *   "효과음 + 화면 흔들림"으로 폴백한다. (화면 흔들림은 App 에서 처리)
 * - 효과음: Web Audio API 로 아주 짧은 톤을 생성. 외부 오디오 파일이 없어도
 *   되고, iOS/안드로이드 공통으로 동작한다.
 *
 * 주의: iOS 는 오디오도 "사용자 제스처 안에서" 처음 한 번 깨워줘야(unlock) 소리가 난다.
 *       → 권한 허용 버튼 탭에서 unlockAudio() 를 호출한다.
 */

let audioCtx: AudioContext | null = null

// 사용자가 켜고 끌 수 있는 피드백 스위치 (기본 켜짐)
let vibrationOn = true
let soundOn = true
export function setVibrationEnabled(on: boolean) {
  vibrationOn = on
}
export function setSoundEnabled(on: boolean) {
  soundOn = on
}

/** 브라우저가 진동을 지원하는지 (사실상 안드로이드 계열) */
export const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator

/** 사용자 제스처(버튼 탭) 안에서 호출해 오디오를 깨운다. iOS 필수. */
export function unlockAudio() {
  try {
    if (!audioCtx) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      audioCtx = new Ctx()
    }
    if (audioCtx.state === 'suspended') void audioCtx.resume()
  } catch {
    // 오디오를 못 쓰는 환경이면 조용히 무시 (게임은 계속 동작)
  }
}

/** 짧은 "삑" 톤 재생. freq(Hz), duration(ms), volume(0~1) */
function beep(freq: number, durationMs: number, volume = 0.2) {
  if (!audioCtx || !soundOn) return
  const osc = audioCtx.createOscillator()
  const gain = audioCtx.createGain()
  osc.frequency.value = freq
  osc.type = 'square'
  gain.gain.value = volume
  osc.connect(gain).connect(audioCtx.destination)
  const now = audioCtx.currentTime
  osc.start(now)
  // 소리 끝을 부드럽게 줄여서 딸깍거림 방지
  gain.gain.exponentialRampToValueAtTime(0.0001, now + durationMs / 1000)
  osc.stop(now + durationMs / 1000)
}

/** 흔드는 중 피드백: 약한 진동 + 아주 짧은 낮은 톡 소리 */
export function feedbackShake() {
  if (canVibrate && vibrationOn) navigator.vibrate(25)
  beep(220, 40, 0.08)
}

/** 던지기(확정) 피드백: 강한 진동 + 높은 톤 */
export function feedbackThrow() {
  if (canVibrate && vibrationOn) navigator.vibrate([0, 60, 40, 120])
  beep(660, 120, 0.25)
}
