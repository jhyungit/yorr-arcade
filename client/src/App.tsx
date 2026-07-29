import { useCallback, useEffect, useState } from 'react'
import GameHub from './screens/GameHub'
import PingPong from './games/pingpong/PingPong'
import Controller from './games/pingpong/Controller'
import RhythmTap from './games/rhythm/RhythmTap'
import ReactionBattle from './games/reaction/ReactionBattle'
import StackSlasher from './games/slasher/StackSlasher'
import YachtRoom from './screens/YachtRoom'
import PlayPreview from './screens/PlayPreview'
import { savedRoomCode } from './net/useRoom'
import { socket } from './net/socket'

/**
 * App — 진입점
 * -------------------------------------------------------------
 * - URL 에 ?ctrl 이 있으면 "폰 컨트롤러" 화면 (다른 화면과 페어링).
 * - ?room=CODE 는 친구가 보낸 요트 방 초대 링크 → 바로 참가 화면으로.
 * - ?preview=play 는 서버 없이 온라인 방 화면을 띄워 보는 프리뷰.
 * - 그 외에는 랜딩(GameHub) → 선택한 게임.
 *
 * 폰 컨트롤러 페어링은 "허브에서 한 번" 연결하고(아래 Main),
 * 게임들이 그 연결(phoneConnected)을 물려받아 쓴다.
 */
type GameId = 'pingpong' | 'rhythm' | 'reaction' | 'slasher' | 'yacht'

export default function App() {
  const params = new URLSearchParams(window.location.search)
  if (params.has('ctrl')) {
    return <Controller initialCode={params.get('ctrl') || ''} />
  }
  if (params.get('preview') === 'play') {
    return <PlayPreview />
  }

  return <Main initialRoomCode={params.get('room') || ''} />
}

function Main({ initialRoomCode }: { initialRoomCode: string }) {
  /* 허브를 건너뛰고 요트로 바로 들어가는 두 경우
     ① 초대 링크(?room=CODE) 로 들어왔다
     ② 하던 판이 있다 — 폰 잠금/새로고침으로 돌아온 것이므로 자리를 되찾아야 한다.
        (자리가 이미 없어졌으면 요트 입장 화면으로 떨어지고 세션은 지워진다) */
  const resume = initialRoomCode || savedRoomCode()
  const [game, setGame] = useState<GameId | null>(resume ? 'yacht' : null)
  // 마지막으로 고른 게임 — 게임에서 나왔을 때 허브 카드가 그 게임에 위치하도록
  const [lastGameId, setLastGameId] = useState<GameId | null>(resume ? 'yacht' : null)
  // 폰 컨트롤러 페어링 — 허브에서 한 번 코드 발급 후 여러 대 연결 가능
  const [pairCode, setPairCode] = useState<string | null>(null)
  // 연결된 폰 컨트롤러 수 (서버가 count 를 실어 보냄). 0보다 크면 연결됨.
  const [phoneCount, setPhoneCount] = useState(0)
  const phoneConnected = phoneCount > 0

  useEffect(() => {
    const onConn = (d?: { count?: number }) =>
      setPhoneCount((c) => (typeof d?.count === 'number' ? d.count : c + 1))
    const onDis = (d?: { count?: number }) =>
      setPhoneCount((c) => (typeof d?.count === 'number' ? d.count : Math.max(0, c - 1)))
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
    // GameId 값이 폰이 아는 이름과 그대로 같다 → 게임을 추가해도 여기 손댈 일이 없다.
    // (예전엔 게임별로 삼항 연산자를 늘려 쓰다가 요트를 빠뜨려 폰 UI 가 'idle' 로 남았다)
    socket.emit('disp:game', { game: game ?? 'idle' })
  }, [game, phoneConnected])

  if (game === 'pingpong') {
    return <PingPong onExit={() => setGame(null)} phoneConnected={phoneConnected} />
  }
  if (game === 'rhythm') {
    return <RhythmTap onExit={() => setGame(null)} phoneConnected={phoneConnected} />
  }
  if (game === 'reaction') {
    // 반응속도(퀵드로우): 폰에서 직접 해도 되고, 노트북=신호화면 + 폰=휘두르기(컨트롤러)로도 가능
    //  폰 2대가 붙으면 "폰 버저 2인 대결" 모드가 열린다(phoneCount).
    return (
      <ReactionBattle
        onExit={() => setGame(null)}
        phoneConnected={phoneConnected}
        phoneCount={phoneCount}
      />
    )
  }
  if (game === 'slasher') {
    // 기술스택 슬래셔: 완전 클라이언트 사이드(터치/마우스 스와이프). 폰 컨트롤러 불필요.
    return <StackSlasher onExit={() => setGame(null)} />
  }
  if (game === 'yacht') {
    // 요트 다이스: 방 만들기/참여로 최대 6인 턴제. 입장 화면에서 "혼자 하기"도 고를 수 있다.
    return (
      <YachtRoom
        onExit={() => setGame(null)}
        initialCode={initialRoomCode}
        phoneConnected={phoneConnected}
      />
    )
  }

  return (
    <GameHub
      initialGameId={lastGameId}
      onSelect={(id) => {
        if (
          id === 'pingpong' ||
          id === 'rhythm' ||
          id === 'reaction' ||
          id === 'slasher' ||
          id === 'yacht'
        ) {
          setGame(id)
          setLastGameId(id) // 나중에 나왔을 때 이 카드에 위치
        }
      }}
      onController={() => {
        // 이 폰을 "다른 화면의 컨트롤러"로 (새로고침하며 ?ctrl 진입)
        window.location.search = '?ctrl='
      }}
      pairCode={pairCode}
      phoneConnected={phoneConnected}
      phoneCount={phoneCount}
      onConnectPhone={connectPhone}
    />
  )
}
