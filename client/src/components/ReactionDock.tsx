import { REACTION_EMOJI, type ReactionType } from '../net/types'

/**
 * ReactionDock — 리액션 버튼 줄 (like/laugh/shock/clap/gg)
 * 탭하면 onReact(type) 호출 → 서버로 전송. 떠오르는 이모지는 PlayScreen 이 오버레이로 표시.
 */
interface ReactionDockProps {
  onReact: (type: ReactionType) => void
}

const ORDER: ReactionType[] = ['like', 'laugh', 'shock', 'clap', 'gg']

export default function ReactionDock({ onReact }: ReactionDockProps) {
  return (
    <div className="flex items-center justify-center gap-1.5">
      {ORDER.map((type) => (
        <button
          key={type}
          onClick={() => onReact(type)}
          aria-label={`리액션 ${type}`}
          className="w-11 h-11 rounded-full bg-[var(--card)] border border-[var(--line)] text-xl flex items-center justify-center active:scale-90 transition-transform shadow-sm"
        >
          {REACTION_EMOJI[type]}
        </button>
      ))}
    </div>
  )
}
