// =============================================================
//  요트 주간 랭킹 — Upstash Redis(REST) ZSET
// -------------------------------------------------------------
//  - 키: weekly:<KST 월요일 YYYY-MM-DD>. 주가 바뀌면 새 키 → 리셋 배치 불필요.
//  - 멤버 = 닉네임(계정 없음 → 같은 닉네임은 한 줄로 합쳐진다, 의도된 단순화).
//  - ZADD GT: 기존보다 높을 때만 갱신 → "그 주 한 판 최고점".
//  - 환경변수(UPSTASH_REDIS_REST_URL/TOKEN)가 없으면 조용히 꺼진다(로컬 실행용).
// =============================================================

const URL = process.env.UPSTASH_REDIS_REST_URL
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
const DAY = 86400000

/** KST 기준 이번 주 월요일 날짜 */
export function weekKey(now = Date.now()) {
  const kst = new Date(now + 9 * 3600000)
  const mon = new Date(kst - ((kst.getUTCDay() + 6) % 7) * DAY)
  return 'weekly:' + mon.toISOString().slice(0, 10)
}

async function redis(cmds) {
  const r = await fetch(URL + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: JSON.stringify(cmds),
  })
  if (!r.ok) throw new Error('upstash ' + r.status)
  return (await r.json()).map((x) => x.result)
}

/** entries: [nickname, score][] */
export async function recordWeekly(entries) {
  if (!URL || !entries.length) return
  const key = weekKey()
  try {
    await redis([
      ...entries.map(([name, score]) => ['ZADD', key, 'GT', String(score), name]),
      ['EXPIRE', key, String(60 * 86400)], // 지난 주 키는 알아서 사라지게
    ])
    cache = null
  } catch (e) {
    console.warn('[ranking] 기록 실패', e.message)
  }
}

// ponytail: 인프로세스 30초 캐시 — 인스턴스 1대 전제(render.yaml 참고)
let cache = null
export async function weeklyTop() {
  if (!URL) return []
  if (cache && Date.now() - cache.at < 30000) return cache.list
  try {
    const [flat] = await redis([['ZRANGE', weekKey(), '0', '9', 'REV', 'WITHSCORES']])
    cache = { at: Date.now(), list: rankRows(flat) }
    return cache.list
  } catch (e) {
    console.warn('[ranking] 조회 실패', e.message)
    return cache?.list ?? []
  }
}

/** [name, score, name, score...] → 동점 같은 등수(1,2,2,4) */
export function rankRows(flat) {
  const rows = []
  for (let i = 0; i < flat.length; i += 2) {
    const score = Number(flat[i + 1])
    const prev = rows[rows.length - 1]
    rows.push({ nickname: flat[i], score, rank: prev && prev.score === score ? prev.rank : rows.length + 1 })
  }
  return rows
}
