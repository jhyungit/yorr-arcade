import { useCallback, useEffect, useState } from 'react'
import GameHub from './screens/GameHub'
import PingPong from './games/pingpong/PingPong'
import Controller from './games/pingpong/Controller'
import RhythmTap from './games/rhythm/RhythmTap'
import ReactionBattle from './games/reaction/ReactionBattle'
import { socket } from './net/socket'

/**
 * App — 진입점
 * -------------------------------------------------------------
 * - URL 에 ?ctrl 이 있으면 "폰 컨트롤러" 화면 (다른 화면과 페어링).
 * - 그 외에는 랜딩(GameHub) → 선택한 게임.
 *
 * 폰 컨트롤러 페어링은 "허브에서 한 번" 연결하고(아래 Main),
 * 게임들이 그 연결(phoneConnected)을 물려받아 쓴다.
 * (요트 다이스/멀티플레이 코드는 남겨뒀지만 지금은 라우팅하지 않음)
 */
type GameId = 'pingpong' | 'rhythm' | 'reaction'

export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('ctrl')) {
    return <Controller initialCode={params.get('ctrl') || ''} />
  }

  return <Main />
}

function Main() {
  const [game, setGame] = useState<GameId | null>(null)
  // 폰 컨트롤러 페어링 — 허브에서 한 번 연결하면 게임 진입 시 그대로 사용
  const [pairCode, setPairCode] = useState<string | null>(null)
  const [phoneConnected, setPhoneConnected] = useState(false)

  useEffect(() => {
    const onConn = () => setPhoneConnected(true)
    const onDis = () => setPhoneConnected(false)
    socket.on('ctrl:connected', onConn)
    socket.on('ctrl:disconnected', onDis)
    return () => {
      socket.off('ctrl:connected', onConn)
      socket.off('ctrl:disconnected', onDis)
    }
  }, [])

  // "폰 연결" — 페어링 코드 발급(한 번만). 폰이 이 코드로 접속하면 phoneConnected=true.
  const connectPhone = useCallback(() => {
    if (pairCode) return
    socket.emit('pair:create', (ack: { code: string }) => setPairCode(ack.code))
  }, [pairCode])

  // 폰(컨트롤러)에 "지금 어느 화면인지"를 항상 알려 UI 를 맞춘다(단일 소스).
  //  - 허브(게임 미선택): 'idle'  → 폰은 "게임 대기중"
  //  - 각 게임: 'pingpong' | 'rhythm'  → 폰 UI 가 그 게임으로
  //  게임이 바뀌거나 폰이 (재)연결될 때마다 다시 보낸다.
  useEffect(() => {
    if (!phoneConnected) return
    const g =
      game === 'pingpong'
        ? 'pingpong'
        : game === 'rhythm'
          ? 'rhythm'
          : game === 'reaction'
            ? 'reaction'
            : 'idle'
    socket.emit('disp:game', { game: g })
  }, [game, phoneConnected])

  if (game === 'pingpong') {
    return <PingPong onExit={() => setGame(null)} phoneConnected={phoneConnected} />
  }
  if (game === 'rhythm') {
    return <RhythmTap onExit={() => setGame(null)} phoneConnected={phoneConnected} />
  }
  if (game === 'reaction') {
    // 반응속도(퀵드로우): 폰에서 직접 해도 되고, 노트북=신호화면 + 폰=휘두르기(컨트롤러)로도 가능
    return <ReactionBattle onExit={() => setGame(null)} phoneConnected={phoneConnected} />
  }

  return (
    <GameHub
      onSelect={(id) => {
        if (id === 'pingpong') setGame('pingpong')
        else if (id === 'rhythm') setGame('rhythm')
        else if (id === 'reaction') setGame('reaction')
      }}
      onController={() => {
        // 이 폰을 "다른 화면의 컨트롤러"로 (새로고침하며 ?ctrl 진입)
        window.location.search = '?ctrl='
      }}
      pairCode={pairCode}
      phoneConnected={phoneConnected}
      onConnectPhone={connectPhone}
    />
  )
}
