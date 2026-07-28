import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { GAME_CARDS } from './gameCards'

/**
 * GameHub — 랜딩 (아케이드 캐비닛 스타일 게임 선택)
 * -------------------------------------------------------------
 * 오락실 곡선택 화면 구조를 따른다:
 *   위     스테이지 — 지금 고른 게임의 플레이 장면이 반복 재생된다
 *   아래   필름스트립 — 카드를 좌우로 넘겨 고른다
 *   맨아래 크레딧 바 — 폰 컨트롤러 연결 상태
 *
 * 다크로 간 이유: 게임 5종이 전부 다크 톤인데 허브만 밝아 톤이 튀었다.
 * 화면 전체 색(--ac)은 선택된 게임의 대표색을 따라가서, 카드를 넘기면
 * 스테이지 테두리·글로우·플레이 버튼이 그 게임 색으로 바뀐다.
 *
 * 조작: 좌우 드래그 / ← → 키 / 화살표 버튼 / 옆 카드 직접 클릭 / Enter·Space 로 시작
 */
interface GameHubProps {
  onSelect: (id: string) => void
  onController: () => void
  pairCode: string | null // 허브에서 폰 연결용으로 발급된 코드
  phoneConnected: boolean // 폰 컨트롤러가 하나라도 붙었는가
  phoneCount: number // 연결된 폰 컨트롤러 수
  onConnectPhone: () => void // "폰 연결" 시작(코드 발급)
  initialGameId?: string | null // 방금 플레이한 게임 → 그 카드에서 시작
}

/** 필름스트립 카드 간격(px) = 카드 폭 + 여백 */
const STEP = 168
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)

export default function GameHub({
  onSelect,
  onController,
  pairCode,
  phoneConnected,
  phoneCount,
  onConnectPhone,
  initialGameId,
}: GameHubProps) {
  const [index, setIndex] = useState(() => {
    const i = GAME_CARDS.findIndex((c) => c.id === initialGameId)
    return i >= 0 ? i : 0
  })
  const [drag, setDrag] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [panel, setPanel] = useState(false) // 폰 연결 패널 열림
  const startX = useRef<number | null>(null)
  const moved = useRef(false)

  const card = GAME_CARDS[index]
  const go = useCallback((d: number) => setIndex((i) => clamp(i + d, 0, GAME_CARDS.length - 1)), [])

  // 키보드: ← → 로 넘기고 Enter/Space 로 시작 (패널이 열려 있으면 Esc 로 닫기만)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return setPanel(false)
      if (panel) return
      if (e.key === 'ArrowLeft') {
        e.preventDefault()
        go(-1)
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        go(1)
      } else if (e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault()
        onSelect(GAME_CARDS[index].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [go, index, onSelect, panel])

  /* 드래그로 넘기기 — 포인터 캡처는 안 쓴다 (카드 click 이 삼켜진다) */
  const onDown = (e: ReactPointerEvent) => {
    startX.current = e.clientX
    moved.current = false
    setDragging(true)
  }
  const onMove = (e: ReactPointerEvent) => {
    if (startX.current == null) return
    const dx = e.clientX - startX.current
    if (Math.abs(dx) > 6) moved.current = true
    setDrag(dx)
  }
  const onUp = () => {
    if (startX.current == null) return
    setIndex((i) => clamp(i + (drag > 50 ? -1 : drag < -50 ? 1 : 0), 0, GAME_CARDS.length - 1))
    setDrag(0)
    setDragging(false)
    startX.current = null
  }

  return (
    <div className="arcade flex flex-col" style={{ ['--ac' as string]: card.accent }}>
      <Brackets />

      {/* 상단 바 */}
      <header className="relative z-10 flex shrink-0 items-center justify-between px-5 py-3 sm:px-8">
        <div>
          <div className="label-mono text-white/40">YORR · ARCADE</div>
          <div className="font-display text-sm font-black text-white/85">게임을 고르세요</div>
        </div>
        <button
          onClick={() => setPanel(true)}
          className="ar-nav flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold"
        >
          <span className="text-base leading-none">📱</span>
          {phoneConnected ? (
            <span className="flex items-center gap-1.5 text-[#49e08a]">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[#49e08a] opacity-60" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-[#49e08a]" />
              </span>
              폰 {phoneCount}대
            </span>
          ) : (
            <span className="text-white/70">폰 연결</span>
          )}
        </button>
      </header>

      {/* 스테이지 — 선택된 게임의 플레이 장면이 재생된다 */}
      <main className="relative z-10 flex min-h-0 flex-1 flex-col items-center justify-center px-5 sm:px-8">
        <div className="ar-stage w-full max-w-[760px]" style={{ aspectRatio: '16 / 9', maxHeight: '46vh' }}>
          {GAME_CARDS.map((c, i) => (
            // 언마운트하지 않고 투명도로 교차 — 전환이 매끄럽고 애니메이션이 처음부터 다시 안 돈다
            <div
              key={c.id}
              className="absolute inset-0 transition-opacity duration-300"
              style={{ opacity: i === index ? 1 : 0 }}
              aria-hidden={i !== index}
            >
              <c.Art live={i === index} />
            </div>
          ))}
          {/* 아래쪽 스크림 + 타이틀 */}
          <div
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2"
            style={{ background: 'linear-gradient(transparent, rgba(4,6,10,0.88))' }}
          />
          <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4 sm:p-5">
            <div className="flex items-end gap-3">
              <span className="text-[34px] leading-none drop-shadow-lg sm:text-[42px]">{card.emoji}</span>
              <div className="min-w-0">
                <h1 className="font-display truncate text-xl font-black sm:text-2xl">{card.title}</h1>
                <p className="mt-0.5 truncate text-[12px] text-white/60 sm:text-[13px]">{card.desc}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap justify-center gap-1.5">
          {card.tags.map((t) => (
            <span
              key={t}
              className="rounded-md border border-white/10 bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-white/65"
            >
              {t}
            </span>
          ))}
        </div>
      </main>

      {/* 필름스트립 */}
      <section className="relative z-10 shrink-0">
        <div className="flex items-center justify-center gap-3 px-3 sm:gap-5">
          <button
            onClick={() => go(-1)}
            disabled={index === 0}
            aria-label="이전 게임"
            className="ar-nav h-11 w-11 shrink-0 rounded-xl text-lg"
          >
            ‹
          </button>

          <div
            className="relative h-[124px] flex-1 touch-none select-none overflow-hidden"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onPointerLeave={onUp}
          >
            {GAME_CARDS.map((c, i) => {
              const p = i - index - drag / STEP
              const on = Math.abs(p) < 0.5
              return (
                <button
                  key={c.id}
                  data-on={on ? 1 : 0}
                  aria-label={c.title}
                  onClick={() => {
                    if (moved.current) return // 드래그였으면 클릭으로 안 친다
                    if (on) onSelect(c.id)
                    else setIndex(i)
                  }}
                  className="ar-card left-1/2 top-1/2"
                  style={{
                    width: 152,
                    height: 86,
                    marginLeft: -76,
                    marginTop: -43,
                    transform: `translateX(${p * STEP}px) scale(${
                      on ? 1.16 : clamp(1 - Math.abs(p) * 0.1, 0.74, 1)
                    })`,
                    opacity: clamp(1 - Math.abs(p) * 0.34, 0.15, 1),
                    zIndex: 50 - Math.round(Math.abs(p) * 10),
                    transition: dragging ? 'none' : undefined,
                  }}
                >
                  <c.Art />
                  {!on && <span className="absolute inset-0 bg-black/45" />}
                  <span className="absolute bottom-1 left-1.5 text-[15px] leading-none drop-shadow">
                    {c.emoji}
                  </span>
                </button>
              )
            })}
          </div>

          <button
            onClick={() => go(1)}
            disabled={index === GAME_CARDS.length - 1}
            aria-label="다음 게임"
            className="ar-nav h-11 w-11 shrink-0 rounded-xl text-lg"
          >
            ›
          </button>
        </div>

        <div className="mt-1 flex flex-col items-center gap-2.5 pb-3">
          <div className="flex gap-1.5">
            {GAME_CARDS.map((c, i) => (
              <button
                key={c.id}
                onClick={() => setIndex(i)}
                aria-label={`${c.title}로 이동`}
                className="h-1.5 rounded-full transition-all"
                style={{
                  width: i === index ? 20 : 6,
                  background: i === index ? card.accent : 'rgba(255,255,255,0.22)',
                }}
              />
            ))}
          </div>
          <button
            onClick={() => onSelect(card.id)}
            className="ar-play font-display rounded-xl px-10 py-3 text-[15px] font-black"
          >
            ▶ 플레이
          </button>
        </div>
      </section>

      {/* 크레딧 바 — 폰 연결 상태 (레퍼런스의 CREDIT 줄 자리) */}
      <footer className="relative z-10 shrink-0 border-t border-white/10 bg-black/40 px-5 py-2 text-center">
        <button onClick={() => setPanel(true)} className="label-mono text-white/45 hover:text-white/75">
          {phoneConnected
            ? `PHONE ${phoneCount} CONNECTED${pairCode ? ` · CODE ${pairCode}` : ''}`
            : pairCode
              ? `WAITING FOR PHONE · CODE ${pairCode}`
              : 'INSERT PHONE — 폰을 컨트롤러로 연결하기'}
        </button>
      </footer>

      {panel && (
        <PhonePanel
          pairCode={pairCode}
          phoneConnected={phoneConnected}
          phoneCount={phoneCount}
          onConnectPhone={onConnectPhone}
          onController={onController}
          onClose={() => setPanel(false)}
        />
      )}
    </div>
  )
}

/** 화면 네 모서리의 금속 브래킷 */
function Brackets() {
  return (
    <>
      <span className="ar-bracket" style={{ left: 10, top: 10, borderRight: 0, borderBottom: 0 }} />
      <span className="ar-bracket" style={{ right: 10, top: 10, borderLeft: 0, borderBottom: 0 }} />
      <span className="ar-bracket" style={{ left: 10, bottom: 10, borderRight: 0, borderTop: 0 }} />
      <span className="ar-bracket" style={{ right: 10, bottom: 10, borderLeft: 0, borderTop: 0 }} />
    </>
  )
}

/* ── 폰 연결 패널 (오버레이) ── */
interface PhonePanelProps {
  pairCode: string | null
  phoneConnected: boolean
  phoneCount: number
  onConnectPhone: () => void
  onController: () => void
  onClose: () => void
}
function PhonePanel({
  pairCode,
  phoneConnected,
  phoneCount,
  onConnectPhone,
  onController,
  onClose,
}: PhonePanelProps) {
  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-black/78 px-5 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="ar-stage w-full max-w-[420px] bg-[#0b0f17] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div className="label-mono text-white/45">PHONE CONTROLLER</div>
          <button onClick={onClose} aria-label="닫기" className="ar-nav h-8 w-8 rounded-lg text-sm">
            ✕
          </button>
        </div>

        {pairCode ? (
          <>
            <p className="mt-4 text-center text-xs text-white/50">
              폰 브라우저로 같은 주소에 접속해 코드를 입력하세요
            </p>
            <div className="mt-3 flex justify-center gap-2">
              {pairCode.split('').map((ch, i) => (
                <span
                  key={i}
                  className="flex h-16 items-center justify-center rounded-xl border-2 text-3xl font-black"
                  style={{
                    width: 52,
                    borderColor: 'color-mix(in oklab, var(--ac) 60%, transparent)',
                    background: 'rgba(255,255,255,0.04)',
                    color: 'var(--ac)',
                  }}
                >
                  {ch}
                </span>
              ))}
            </div>
            <div className="mt-4 text-center text-xs">
              {phoneConnected ? (
                <span className="font-bold text-[#49e08a]">
                  ● {phoneCount}대 연결됨 — 퀵드로우는 2대면 폰끼리 결투!
                </span>
              ) : (
                <span className="text-white/45">아직 연결된 폰이 없어요 — 여러 대 붙일 수 있어요</span>
              )}
            </div>
          </>
        ) : (
          <div className="mt-4 grid gap-2.5">
            <Choice
              emoji="🖥️"
              title="이 기기를 화면으로"
              desc="연결 코드를 발급해 폰을 붙입니다"
              onClick={onConnectPhone}
              primary
            />
            <Choice
              emoji="🎮"
              title="이 폰을 컨트롤러로"
              desc="다른 화면의 코드를 입력합니다"
              onClick={onController}
            />
          </div>
        )}
      </div>
    </div>
  )
}

function Choice({
  emoji,
  title,
  desc,
  onClick,
  primary,
}: {
  emoji: string
  title: string
  desc: string
  onClick: () => void
  primary?: boolean
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98]"
      style={
        primary
          ? {
              borderColor: 'color-mix(in oklab, var(--ac) 55%, transparent)',
              background: 'color-mix(in oklab, var(--ac) 10%, transparent)',
            }
          : { borderColor: 'rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.04)' }
      }
    >
      <span className="text-2xl leading-none">{emoji}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-white/90">{title}</span>
        <span className="block text-[11px] leading-snug text-white/45">{desc}</span>
      </span>
    </button>
  )
}
