import { GAME_CARDS, type GameCard } from './gameCards'

/**
 * GameHub — 랜딩 (게임 선택)
 * -------------------------------------------------------------
 * 캐러셀에서 그리드로 바꿨다. 캐러셀은 한 번에 한 장만 읽혀서 어떤 게임이
 * 있는지 알려면 끝까지 넘겨봐야 했다. 파티 게임 허브는 "뭐 있는지 한눈에"가
 * 먼저라 전부 펼쳐 보여준다.
 *
 * 카드 아트는 gameCards.tsx 에서 각 게임 플레이 화면 색으로 그린다.
 */
interface GameHubProps {
  onSelect: (id: string) => void
  onController: () => void
  pairCode: string | null // 허브에서 폰 연결용으로 발급된 코드
  phoneConnected: boolean // 폰 컨트롤러가 하나라도 붙었는가
  phoneCount: number // 연결된 폰 컨트롤러 수
  onConnectPhone: () => void // "폰 연결" 시작(코드 발급)
  initialGameId?: string | null // 방금 플레이한 게임 → 카드에 표시
}

export default function GameHub({
  onSelect,
  onController,
  pairCode,
  phoneConnected,
  phoneCount,
  onConnectPhone,
  initialGameId,
}: GameHubProps) {
  return (
    <div className="min-h-full px-4 pb-10 pt-8 sm:px-6">
      <div className="mx-auto w-full max-w-[1040px]">
        <Header count={GAME_CARDS.length} phoneCount={phoneCount} />

        {/* 카드 그리드 — 마지막 줄이 비어 보이지 않게 가운데 정렬 */}
        <div className="mt-7 flex flex-wrap justify-center gap-4 sm:gap-5">
          {GAME_CARDS.map((card) => (
            <Card
              key={card.id}
              card={card}
              last={card.id === initialGameId}
              onClick={() => onSelect(card.id)}
            />
          ))}
        </div>

        <PhonePanel
          pairCode={pairCode}
          phoneConnected={phoneConnected}
          phoneCount={phoneCount}
          onConnectPhone={onConnectPhone}
          onController={onController}
        />
      </div>
    </div>
  )
}

/* ── 헤더 ── */
function Header({ count, phoneCount }: { count: number; phoneCount: number }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="label-mono text-[var(--ink-3)]">YORR · ARCADE</div>
        <h1 className="mt-1.5 text-[32px] font-black leading-none tracking-tight text-[var(--ink)] sm:text-[40px]">
          무엇을 하고 놀까?
        </h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          게임 {count}개 · 폰을 컨트롤러로 연결하면 다 같이 즐길 수 있어요
        </p>
      </div>
      {phoneCount > 0 && (
        <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pos)]/12 px-3 py-1.5 text-xs font-bold text-[var(--pos)]">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--pos)] opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--pos)]" />
          </span>
          폰 {phoneCount}대 연결됨
        </span>
      )}
    </header>
  )
}

/* ── 게임 카드 ── */
function Card({ card, last, onClick }: { card: GameCard; last: boolean; onClick: () => void }) {
  const { Art } = card
  return (
    <button
      onClick={onClick}
      className="hub-card group relative w-full overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--card)] text-left sm:w-[calc(50%-10px)] lg:w-[326px]"
      style={{ boxShadow: '0 14px 34px -18px rgba(20,50,80,0.45)' }}
    >
      {/* 아트 */}
      <div className="relative aspect-[16/9] overflow-hidden">
        <Art />
        {/* 아래로 어두워지는 스크림 — 이모지·배지가 어떤 아트 위에서도 읽히게 */}
        <div
          className="absolute inset-x-0 bottom-0 h-2/5"
          style={{ background: 'linear-gradient(transparent, rgba(0,0,0,0.55))' }}
        />
        <span className="absolute bottom-2.5 left-3.5 text-[30px] leading-none drop-shadow-lg">
          {card.emoji}
        </span>
        {last && (
          <span className="absolute right-3 top-3 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur-sm">
            방금 플레이
          </span>
        )}
        {/* 대표색 밑줄 */}
        <div className="absolute inset-x-0 bottom-0 h-[3px]" style={{ background: card.accent }} />
      </div>

      {/* 정보 */}
      <div className="p-4">
        <h2 className="text-[17px] font-black text-[var(--ink)]">{card.title}</h2>
        <p className="mt-1 min-h-[2.6em] text-[13px] leading-relaxed text-[var(--ink-2)]">{card.desc}</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {card.tags.map((t) => (
            <span
              key={t}
              className="rounded-md bg-[var(--card-2)] px-2 py-1 text-[11px] font-semibold text-[var(--ink-2)]"
            >
              {t}
            </span>
          ))}
        </div>

        <div
          className="mt-3.5 flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-sm font-bold text-white transition-[filter] group-active:brightness-95"
          style={{ background: card.accent }}
        >
          플레이 <span className="text-xs">▶</span>
        </div>
      </div>
    </button>
  )
}

/* ── 폰 연동 패널 ── */
interface PhonePanelProps {
  pairCode: string | null
  phoneConnected: boolean
  phoneCount: number
  onConnectPhone: () => void
  onController: () => void
}
function PhonePanel({
  pairCode,
  phoneConnected,
  phoneCount,
  onConnectPhone,
  onController,
}: PhonePanelProps) {
  return (
    <section
      className="mx-auto mt-8 w-full max-w-[680px] overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--card)]"
      style={{ boxShadow: '0 14px 34px -20px rgba(20,50,80,0.4)' }}
    >
      <div className="flex items-center gap-2 border-b border-[var(--line)] bg-[var(--card-2)] px-5 py-3">
        <span className="text-base">📱</span>
        <span className="text-sm font-bold text-[var(--ink)]">폰 컨트롤러</span>
        <span className="text-xs text-[var(--ink-3)]">— 폰을 흔들어 조종해요</span>
      </div>

      {pairCode ? (
        <div className="px-5 py-5">
          <p className="text-center text-xs text-[var(--ink-3)]">
            폰 브라우저로 접속해 아래 코드를 입력하세요
          </p>
          {/* 코드 — 글자마다 타일로 (한 덩어리 텍스트보다 훨씬 읽기 쉽다) */}
          <div className="mt-3 flex justify-center gap-2">
            {pairCode.split('').map((ch, i) => (
              <span
                key={i}
                className="flex h-14 w-12 items-center justify-center rounded-xl border border-[var(--line-2)] bg-[var(--card-2)] text-3xl font-black text-[var(--coral)]"
              >
                {ch}
              </span>
            ))}
          </div>
          <div className="mt-4 flex items-center justify-center gap-2 text-xs">
            {phoneConnected ? (
              <>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--pos)]/12 px-2.5 py-1 font-bold text-[var(--pos)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-[var(--pos)]" />
                  {phoneCount}대 연결됨
                </span>
                <span className="text-[var(--ink-3)]">
                  퀵드로우는 2대면 폰끼리 결투!
                </span>
              </>
            ) : (
              <span className="text-[var(--ink-3)]">아직 연결된 폰이 없어요 — 여러 대 붙일 수 있어요</span>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 px-5 py-5 sm:grid-cols-2">
          <PanelChoice
            emoji="🖥️"
            title="이 기기를 화면으로"
            desc="연결 코드를 발급해 폰을 붙입니다"
            onClick={onConnectPhone}
            primary
          />
          <PanelChoice
            emoji="🎮"
            title="이 폰을 컨트롤러로"
            desc="다른 화면의 코드를 입력합니다"
            onClick={onController}
          />
        </div>
      )}
    </section>
  )
}

function PanelChoice({
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
      className={`flex items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition active:scale-[0.98] ${
        primary
          ? 'border-[var(--coral)]/35 bg-[var(--coral)]/[0.07]'
          : 'border-[var(--line)] bg-[var(--card-2)]'
      }`}
    >
      <span className="text-2xl leading-none">{emoji}</span>
      <span className="min-w-0">
        <span className="block text-[13px] font-bold text-[var(--ink)]">{title}</span>
        <span className="block text-[11px] leading-snug text-[var(--ink-3)]">{desc}</span>
      </span>
    </button>
  )
}
