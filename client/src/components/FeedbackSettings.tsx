import { useEffect, useState } from 'react'
import {
  canVibrate,
  feedbackSettings,
  feedbackTap,
  onFeedbackChange,
  setSoundEnabled,
  setVibrationEnabled,
  unlockAudio,
} from '../lib/feedback'

/**
 * FeedbackSettings — 소리·진동 톱니바퀴 (모든 화면 공용)
 * -------------------------------------------------------------
 * 값은 화면이 아니라 lib/feedback 이 들고 있다(localStorage 저장). 그래서
 * 요트에서 소리를 끄고 리듬으로 옮겨도 꺼진 채고, 새로고침해도 유지된다.
 * 게임별로 토글을 따로 두지 않는 이유:
 *   · 같은 저장 키를 여러 화면이 각자 관리하면 서로 밟는다
 *   · "소리 꺼"는 게임 설정이 아니라 기기 설정에 가깝다 — 게임마다 다시 끄는 건 짜증
 *
 * 배치와 톤만 화면이 정한다(className·tone·accent). 게임마다 팔레트가 달라서
 * 패널까지 한 모양으로 박으면 그 화면에서 튄다.
 *
 * 진동은 안드로이드 크롬만 된다. 아이폰은 웹 진동 자체가 불가능해서(lib/feedback
 * 의 canVibrate 주석) 토글을 비활성으로 두고 그 사실을 알려 준다.
 */

/** 지금 설정값. 어느 화면에서 바꿔도 같이 갱신된다(구독). */
export function useFeedbackSettings() {
  const [s, setS] = useState(feedbackSettings)
  useEffect(() => onFeedbackChange(() => setS(feedbackSettings())), [])
  return s
}

type Tone = 'dark' | 'theme'

/* 'theme' 은 CSS 변수를 따라간다 → 허브에서는 밝은 톤, 요트(.yd) 안에서는
   다크 골드로 알아서 바뀐다. 'dark' 는 자체 팔레트를 쓰는 게임 화면용
   (핑퐁·리듬·퀵드로우·슬래셔·폰 컨트롤러는 CSS 변수를 쓰지 않는다). */
const TONES: Record<Tone, Record<string, string>> = {
  dark: {
    panel: '#141a26',
    line: 'rgba(255,255,255,0.14)',
    row: 'rgba(255,255,255,0.05)',
    btn: 'rgba(255,255,255,0.08)',
    ink: '#ffffff',
    ink2: 'rgba(255,255,255,0.55)',
    ink3: 'rgba(255,255,255,0.4)',
    accent: '#49e08a',
  },
  theme: {
    panel: 'var(--paper)',
    line: 'var(--line-2)',
    row: 'var(--card-2)',
    btn: 'var(--card-2)',
    ink: 'var(--ink)',
    ink2: 'var(--ink-2)',
    ink3: 'var(--ink-3)',
    accent: 'var(--pos)',
  },
}

type Props = {
  /** 톱니바퀴 버튼 위치·여백. 화면 레이아웃에 맞게 넘긴다. */
  className?: string
  tone?: Tone
  /** 스위치 켜짐 색. 기본은 톤의 강조색 (요트는 골드처럼 게임 색을 넘긴다) */
  accent?: string
}

export default function SettingsGear({ className = '', tone = 'dark', accent }: Props) {
  const [open, setOpen] = useState(false)
  const { sound, vibration } = useFeedbackSettings()
  const t = TONES[tone]
  const ac = accent ?? t.accent

  return (
    <>
      <button
        onClick={() => {
          unlockAudio() // iOS: 사용자 탭 안에서 오디오를 깨워 둔다
          feedbackTap()
          setOpen((v) => !v)
        }}
        aria-label="설정"
        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-lg active:scale-95 ${className}`}
        style={{ background: t.btn, border: `1px solid ${t.line}` }}
      >
        ⚙️
      </button>

      {open && (
        // fixed — 게임 화면의 overflow:hidden 컨테이너 안에서도 잘리지 않게.
        // 톱니바퀴가 어디 있든 패널은 항상 오른쪽 위에서 열린다.
        // pointer-events-auto 필수 — 슬래셔처럼 상단 바가 pointer-events-none 인
        // 화면에 심으면 그게 자식까지 내려와 패널이 탭을 못 받는다.
        <div
          className="pointer-events-auto fixed inset-0 z-[70] flex items-start justify-end bg-black/60 p-3 pt-16 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="w-full max-w-[280px] rounded-2xl p-4"
            style={{ background: t.panel, border: `1px solid ${t.line}` }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기는 44x44 (애플 권장 최소 탭 타겟). 글리프만 두면 손가락으로
                못 맞힌다. -mr-1.5/-mt-1.5 로 여백만 먹고 시각적 위치는 유지. */}
            <div className="mb-3 flex items-start justify-between">
              <span className="label-mono mt-2.5" style={{ color: t.ink3 }}>
                SETTINGS
              </span>
              <button
                onClick={() => setOpen(false)}
                aria-label="닫기"
                className="-mr-1.5 -mt-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-base active:scale-90"
                style={{ background: t.row, color: t.ink2 }}
              >
                ✕
              </button>
            </div>

            <Toggle
              t={t}
              accent={ac}
              label="소리"
              desc="효과음 · 음악 · 알림음"
              on={sound}
              onChange={(v) => {
                unlockAudio()
                setSoundEnabled(v)
              }}
            />
            <Toggle
              t={t}
              accent={ac}
              label="진동"
              desc={canVibrate() ? '탭 · 알림 햅틱' : '이 기기는 웹 진동을 지원하지 않아요'}
              on={vibration}
              disabled={!canVibrate()}
              onChange={(v) => {
                setVibrationEnabled(v)
                /* 켜자마자 한 번 느껴 보게. 진짜 탭 안에서 불러야 한다 —
                   렌더 뒤로 미루면 브라우저가 사용자 제스처로 안 봐준다. */
                if (v) feedbackTap(true)
              }}
            />

            {!canVibrate() && (
              <p className="mt-3 text-[11px] leading-relaxed" style={{ color: t.ink3 }}>
                아이폰은 브라우저에서 진동을 쓸 수 없어요(크롬도 같아요). 그래서 내 차례는{' '}
                <b style={{ color: t.ink2 }}>소리와 화면 플래시</b>로 알려줘요.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

/** 설정 패널의 on/off 한 줄 */
function Toggle({
  t,
  accent,
  label,
  desc,
  on,
  disabled,
  onChange,
}: {
  t: Record<string, string>
  accent: string
  label: string
  desc: string
  on: boolean
  disabled?: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <button
      onClick={() => !disabled && onChange(!on)}
      disabled={disabled}
      aria-pressed={on}
      className="mb-1.5 flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-left"
      style={{ background: t.row, opacity: disabled ? 0.5 : 1 }}
    >
      <span className="min-w-0">
        <span className="block text-[13px] font-bold" style={{ color: t.ink }}>
          {label}
        </span>
        <span className="block text-[11px] leading-snug" style={{ color: t.ink3 }}>
          {desc}
        </span>
      </span>
      {/* 스위치 */}
      <span
        className="relative h-6 w-11 shrink-0 rounded-full transition-colors"
        style={{ background: on && !disabled ? accent : 'rgba(128,128,128,0.32)' }}
      >
        <span
          className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all"
          style={{ left: on && !disabled ? 22 : 2 }}
        />
      </span>
    </button>
  )
}
