/**
 * feedback.ts
 * -------------------------------------------------------------
 * 흔들기/던지기에 대한 감각 피드백을 크로스 플랫폼으로 처리.
 *
 * - 진동(햅틱): 안드로이드 Chrome 은 navigator.vibrate 지원.
 *   **iOS 는 웹 진동이 불가능하다** — API 가 없고(모든 브라우저가 WebKit),
 *   우회로도 안 된다(canVibrate 주석 참고). 그래서 진동 대신
 *   "효과음 + 화면 흔들림"으로 폴백한다. (화면 흔들림은 App 에서 처리)
 * - 효과음: Web Audio API 로 아주 짧은 톤을 생성. 외부 오디오 파일이 없어도
 *   되고, iOS/안드로이드 공통으로 동작한다.
 *
 * 주의: iOS 는 오디오도 "사용자 제스처 안에서" 처음 한 번 깨워줘야(unlock) 소리가 난다.
 *       → 권한 허용 버튼 탭에서 unlockAudio() 를 호출한다.
 */

let audioCtx: AudioContext | null = null

/* 사용자가 켜고 끌 수 있는 피드백 스위치.
   폰 컨트롤러의 설정(톱니바퀴)에서 바꾸고 localStorage 에 남긴다 —
   조용한 곳에서 소리를 껐는데 새로고침하면 다시 켜지는 게 제일 짜증난다. */
const SOUND_KEY = 'yorr.sound'
const VIBE_KEY = 'yorr.vibe'

/** 저장된 설정 읽기 (없으면 켜짐이 기본) */
function load(key: string) {
  try {
    return localStorage.getItem(key) !== 'off'
  } catch {
    return true // 시크릿 모드 등
  }
}

let vibrationOn = load(VIBE_KEY)
let soundOn = load(SOUND_KEY)

function save(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off')
  } catch {
    /* 저장 못 해도 이번 세션에는 적용된다 */
  }
}

export function setVibrationEnabled(on: boolean) {
  vibrationOn = on
  save(VIBE_KEY, on)
}
export function setSoundEnabled(on: boolean) {
  soundOn = on
  save(SOUND_KEY, on)
}
/** 지금 설정값 (UI 초기 상태를 맞추는 데 쓴다) */
export function feedbackSettings() {
  return { sound: soundOn, vibration: vibrationOn }
}

/**
 * 진동을 쓸 수 있는지. 안드로이드 크롬 등은 true, **iOS 는 항상 false**.
 * -------------------------------------------------------------
 * iOS 우회는 두 가지를 다 시도해 보고 버렸다 (2026-07, iPhone 16 Pro 기준):
 *
 *  1. ios-vibrator-pro-max — 스위치 토글 햅틱을 "언제든" 쓰려고 페이지의 모든
 *     버튼 위에 CSS anchor 로 투명 <label> 을 덮고 진짜 탭을 가로채 합성 클릭으로
 *     되돌려준다. 주사위 버튼처럼 transform 으로 움직이는(active:scale·translateY)
 *     요소는 오버레이 위치가 어긋나 **탭이 씹혔다**. 그런데 진동은 오지도 않았다.
 *  2. 직접 <input switch> 를 만들어 탭 핸들러에서 label.click() — 위 라이브러리의
 *     핵심만 남긴 최소 버전. DOM 오염은 없었지만 **진동은 여전히 안 왔고**
 *     정체불명의 딸깍 소리만 생겼다.
 *
 * → 애플이 이 경로를 막은 것으로 보고 우회를 포기했다. 되살릴 생각이 든다면
 *   위 두 실패를 먼저 볼 것. iOS 는 소리 + 화면 플래시가 정답이다.
 */
export function canVibrate() {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function'
}

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

/**
 * 탭 햅틱 — 폰 컨트롤러에서 주사위를 킵하거나 점수 칸을 고를 때.
 * -------------------------------------------------------------
 * 소리는 내지 않는다. 점수 칸을 고르며 여러 번 탭하게 되는데 그때마다
 * 삑삑거리면 시끄럽다. 손끝 반응만 준다.
 *
 * 아이폰에서는 아무 일도 일어나지 않는다(canVibrate 주석 참고). 그래서 탭에
 * 소리를 붙이지 않는 이 함수는 iOS 에서 무음·무진동이다 — 의도된 것이다.
 * 대신 "내 차례" 같은 중요한 신호는 feedbackTurn 이 소리·플래시로 알린다.
 */
export function feedbackTap(strong = false) {
  if (canVibrate() && vibrationOn) navigator.vibrate(strong ? 22 : 11)
}

/** 흔드는 중 피드백: 약한 진동 + 아주 짧은 낮은 톡 소리 */
export function feedbackShake() {
  if (canVibrate() && vibrationOn) navigator.vibrate(25)
  beep(220, 40, 0.08)
}

/** 던지기(확정) 피드백: 강한 진동 + 높은 톤 */
export function feedbackThrow() {
  if (canVibrate() && vibrationOn) navigator.vibrate([0, 60, 40, 120])
  beep(660, 120, 0.25)
}

/**
 * "이제 네 차례" 알림 — 턴제에서 제일 중요한 신호.
 * -------------------------------------------------------------
 * 폰을 손에 들고 노트북 화면을 보는 자세라 화면 표시만으로는 놓친다.
 * 안드로이드는 진동으로 되지만 **iOS 는 웹 진동을 아예 지원하지 않는다**
 * (사파리뿐 아니라 아이폰 크롬도 같다 — iOS 의 모든 브라우저가 WebKit 이다).
 * 그래서 진동에만 기대면 아이폰에서는 알림이 통째로 사라진다.
 * → 두 음(딩-동) 알림음을 같이 낸다. 소리는 iOS 에서도 난다.
 *   (단 iOS 는 사용자 탭 안에서 unlockAudio() 를 한 번 호출해 둬야 한다)
 */
export function feedbackTurn() {
  if (canVibrate() && vibrationOn) navigator.vibrate([0, 70, 60, 70])
  beep(784, 110, 0.22) // G5
  window.setTimeout(() => beep(1046, 150, 0.22), 130) // C6
}

/* -------------------------------------------------------------
   주사위 소리
   실제 주사위 소리는 "음"이 아니라 짧은 소음(noise)이다. 그래서 오실레이터
   대신 화이트노이즈를 밴드패스로 깎아 쓴다. 부딪힐 때마다 중심 주파수를
   조금씩 흔들어야 다섯 개가 같은 소리로 들리지 않는다.
   ------------------------------------------------------------- */

let noiseBuf: AudioBuffer | null = null

function noiseBuffer(ctx: AudioContext) {
  if (noiseBuf) return noiseBuf
  const len = Math.floor(ctx.sampleRate * 0.25)
  const buf = ctx.createBuffer(1, len, ctx.sampleRate)
  const data = buf.getChannelData(0)
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
  noiseBuf = buf
  return buf
}

/** 노이즈 한 방. freq=밴드패스 중심, ms=길이, vol=세기 */
function clack(freq: number, ms: number, vol: number, q = 1.6) {
  if (!audioCtx || !soundOn) return
  const ctx = audioCtx
  const src = ctx.createBufferSource()
  src.buffer = noiseBuffer(ctx)
  const band = ctx.createBiquadFilter()
  band.type = 'bandpass'
  band.frequency.value = freq
  band.Q.value = q
  const gain = ctx.createGain()
  const now = ctx.currentTime
  gain.gain.setValueAtTime(vol, now)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + ms / 1000)
  src.connect(band).connect(gain).connect(ctx.destination)
  src.start(now)
  src.stop(now + ms / 1000)
}

/** 주사위끼리·펠트에 부딪히는 '딱'. strength 0~1 */
export function feedbackDiceHit(strength: number) {
  const s = Math.max(0, Math.min(1, strength))
  clack(1500 + Math.random() * 1700, 45 + s * 35, 0.05 + s * 0.16)
}

/** 다 굴러 멈췄을 때의 '툭' — 조금 낮고 짧게 */
export function feedbackDiceLand() {
  if (canVibrate() && vibrationOn) navigator.vibrate(30)
  clack(760 + Math.random() * 260, 90, 0.13, 1.1)
}
