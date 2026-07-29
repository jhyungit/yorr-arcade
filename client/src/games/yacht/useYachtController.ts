import { useEffect, useRef } from 'react'
import { socket } from '../../net/socket'
import type { CategoryId } from '../../game/yacht'
import type { ReactionType } from '../../net/types'
import {
  YACHT_KEEP,
  YACHT_REACT,
  YACHT_SCORE,
  YACHT_SELECT,
  YACHT_VIEW,
  type YachtView,
} from './ctrlProtocol'

/**
 * useYachtController — 노트북 쪽에서 폰 컨트롤러를 붙이는 훅
 * -------------------------------------------------------------
 * 하는 일 두 가지.
 *  1) 화면 상태(view)가 바뀔 때마다 폰에 내려보낸다 → 폰이 그대로 그린다
 *  2) 폰이 올려보낸 조작(킵/선택/기록/리액션)을 콜백으로 넘긴다
 *
 * 조작을 폰이 직접 처리하지 않는 이유: 규칙 판정을 한 곳에 두려는 것이다.
 * 폰은 "이거 눌렀다"만 말하고, 실제 반영은 노트북이 기존 경로(멀티면 서버,
 * 솔로면 로컬 state)로 한다 → 노트북 화면과 폰이 저절로 같은 상태가 된다.
 */
interface Options {
  /** 폰에 보낼 화면 상태. 폰이 없거나 보낼 게 없으면 null */
  view: YachtView | null
  /** 페어링된 폰이 있는가 — 없으면 아무것도 안 보낸다 */
  enabled: boolean
  onKeep: (index: number) => void
  onSelect: (id: CategoryId) => void
  onScore: (id: CategoryId) => void
  onReact?: (type: ReactionType) => void
}

export function useYachtController({
  view,
  enabled,
  onKeep,
  onSelect,
  onScore,
  onReact,
}: Options) {
  // 콜백을 ref 로 → 리스너를 매번 다시 달지 않는다
  const cb = useRef({ onKeep, onSelect, onScore, onReact })
  cb.current = { onKeep, onSelect, onScore, onReact }

  /* ── 폰 → 노트북: 조작 수신 ── */
  useEffect(() => {
    const onKeepEv = (d?: { index?: number }) => {
      const i = Number(d?.index)
      if (Number.isInteger(i) && i >= 0 && i <= 4) cb.current.onKeep(i)
    }
    const onSelectEv = (d?: { categoryId?: string }) => {
      if (d?.categoryId) cb.current.onSelect(d.categoryId as CategoryId)
    }
    const onScoreEv = (d?: { categoryId?: string }) => {
      if (d?.categoryId) cb.current.onScore(d.categoryId as CategoryId)
    }
    const onReactEv = (d?: { type?: string }) => {
      if (d?.type) cb.current.onReact?.(d.type as ReactionType)
    }
    socket.on(YACHT_KEEP, onKeepEv)
    socket.on(YACHT_SELECT, onSelectEv)
    socket.on(YACHT_SCORE, onScoreEv)
    socket.on(YACHT_REACT, onReactEv)
    return () => {
      socket.off(YACHT_KEEP, onKeepEv)
      socket.off(YACHT_SELECT, onSelectEv)
      socket.off(YACHT_SCORE, onScoreEv)
      socket.off(YACHT_REACT, onReactEv)
    }
  }, [])

  /* ── 노트북 → 폰: 화면 상태 내려보내기 ──
     매 렌더마다 보내면 낭비라 직렬화해서 달라졌을 때만 보낸다.
     (주사위 5개 + 12칸이라 한 번에 수백 바이트 수준) */
  const lastSent = useRef<string | null>(null)
  const payload = enabled && view ? JSON.stringify(view) : null

  useEffect(() => {
    if (!payload || payload === lastSent.current) return
    lastSent.current = payload
    socket.emit(YACHT_VIEW, JSON.parse(payload))
  }, [payload])

  /* 폰이 새로 붙으면(또는 다시 붙으면) 지금 상태를 한 번 보내 준다.
     안 하면 폰이 다음 변화가 생길 때까지 빈 화면으로 기다린다. */
  useEffect(() => {
    const onConnected = () => {
      lastSent.current = null // 다음 이펙트에서 강제로 다시 보내게
      if (payload) socket.emit(YACHT_VIEW, JSON.parse(payload))
    }
    socket.on('ctrl:connected', onConnected)
    return () => {
      socket.off('ctrl:connected', onConnected)
    }
  }, [payload])
}
