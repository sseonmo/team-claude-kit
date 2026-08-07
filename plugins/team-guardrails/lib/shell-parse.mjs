// 셸 명령 문자열을 룰이 판정할 수 있는 형태로 쪼갠다.
//
// 이 파일이 존재하는 이유: 정규식 한 줄로 위험 명령을 잡으려는 시도는 표기 변형에서 조용히 뚫린다.
// `rm\s+-rf` 는 `rm -fr`·`rm -r -f`·`rm --recursive --force`·`cd /tmp && rm -rf x` 를 전부 놓친다.
// 표기와 순서를 여기서 흡수해, 룰은 "r 과 f 가 각각 있는가" 같은 한 줄 질문만 하게 만든다.
//
// 다루지 않는 것 (플러그인 포지션 — 실수를 막는 장치이지 악의를 막는 장치가 아니다):
//   변수 치환 `P=~; rm -rf $P` · 명령 치환 `$(...)` · 스크립트 경유 `bash x.sh` ·
//   인터프리터 경유 `python -c ...` · base64 인코딩 · **`cd` 로 옮긴 뒤의 상대경로**
// 전부 통과한다. 정적 판정의 원리적 한계이며, 테스트에 기대값으로 명시돼 있다.

/** 인용부호 안이 아닌 곳의 `;` `&&` `||` `|` `&` `(` `)` 개행으로 명령을 나눈다. */
export function splitSegments(command) {
  if (typeof command !== 'string') return []

  const segments = []
  let cur = ''
  let quote = null

  const push = () => {
    const text = cur.trim()
    if (text) segments.push(text)
    cur = ''
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]

    // 이스케이프는 원문 그대로 넘긴다 — 벗기는 건 tokenize 의 몫이다
    if (ch === '\\' && quote !== "'" && i + 1 < command.length) {
      cur += ch + command[i + 1]
      i++
      continue
    }
    if (quote) {
      cur += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      cur += ch
      continue
    }

    if (ch === ';' || ch === '\n' || ch === '(' || ch === ')') {
      push()
      continue
    }
    // `&` 는 명령 경계지만 `2>&1`·`&>` 의 `&` 는 리다이렉션의 일부다.
    // 여기서 잘라내면 세그먼트가 깨져 뒤쪽 토큰이 엉뚱한 명령으로 보인다.
    if (ch === '&') {
      if (cur.trimEnd().endsWith('>') || command[i + 1] === '>') {
        cur += ch
        continue
      }
      if (command[i + 1] === '&') i++
      push()
      continue
    }
    if (ch === '|') {
      if (command[i + 1] === '|') i++
      push()
      continue
    }

    cur += ch
  }
  push()

  return segments
}

/** 세그먼트를 토큰으로 나누고 인용부호·이스케이프를 벗긴다. */
export function tokenize(segment) {
  if (typeof segment !== 'string') return []

  const tokens = []
  let cur = ''
  let started = false // `""` 처럼 내용이 빈 토큰도 토큰이다
  let quote = null

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i]

    // 작은따옴표 안에서는 백슬래시도 리터럴이다
    if (quote === "'") {
      if (ch === "'") quote = null
      else cur += ch
      started = true
      continue
    }
    if (ch === '\\' && i + 1 < segment.length) {
      cur += segment[i + 1]
      i++
      started = true
      continue
    }
    if (quote === '"') {
      if (ch === '"') quote = null
      else cur += ch
      started = true
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(cur)
        cur = ''
        started = false
      }
      continue
    }

    cur += ch
    started = true
  }
  if (started) tokens.push(cur)

  return tokens
}

// `2>` `>>` `<` `&>` `>/dev/null` `2>&1` 을 모두 잡는다.
// 캡처 3번이 비어 있으면 대상이 다음 토큰에 있다는 뜻이다.
const REDIRECT = /^(\d*|&)(>>|>|<)(.*)$/

/**
 * 리다이렉션 연산자와 그 대상을 걷어낸다.
 * 이걸 안 하면 `rm -rf dist > /dev/null` 의 `/dev/null` 이 삭제 대상으로 오인돼
 * 정상 명령이 막힌다 — 오탐은 이 플러그인이 가장 경계하는 실패다.
 */
export function stripRedirections(tokens) {
  const out = []
  for (let i = 0; i < tokens.length; i++) {
    const m = REDIRECT.exec(tokens[i])
    if (!m) {
      out.push(tokens[i])
      continue
    }
    if (m[3] === '') i++ // 대상이 다음 토큰이다 — 함께 버린다
  }
  return out
}

// 명령 이름 **앞에** 올 수 있는 것들. 실행 래퍼와 셸 키워드다.
// 이 부류를 룰마다 따로 처리했더니 비대칭이 반복해서 새어나갔다 —
// D1 은 sudo 를 벗기는데 D3 는 안 벗기는 식이다. 한 곳에 모아 그 자리를 없앤다.
const COMMAND_PREFIXES = new Set([
  'sudo', 'env', 'command', 'nohup', 'time', 'exec', '!', '{', // 실행 래퍼
  'if', 'elif', 'then', 'else', 'while', 'until', 'for', 'do', 'in', 'case', 'select', // 키워드
])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

/**
 * 명령 이름 앞의 래퍼·키워드·변수 할당을 걷어낸다.
 *
 * **맨 앞에서만** 벗긴다. 중간부터 벗기면 `echo sudo rm -rf /` 가 삭제 명령으로 보인다 —
 * 미탐을 줄이려다 오탐을 만드는 전형적인 자리다.
 */
export function stripCommandPrefixes(tokens) {
  let i = 0
  while (i < tokens.length && (COMMAND_PREFIXES.has(tokens[i]) || ASSIGNMENT.test(tokens[i]))) i++
  return tokens.slice(i)
}

/**
 * 토큰을 플래그와 operand 로 가른다.
 *   short — 묶인 단문자를 낱개로 편 집합 (`-rf` → r, f)
 *   long  — `--` 롱플래그 이름 (`--force-with-lease=x` → force-with-lease)
 *   argv  — 명령 이름을 포함한 나머지 전부
 */
export function classifyArgv(tokens) {
  const argv = []
  const short = new Set()
  const long = new Set()
  let endOfFlags = false

  for (const t of tokens) {
    if (endOfFlags) {
      argv.push(t)
      continue
    }
    if (t === '--') {
      endOfFlags = true
      continue
    }
    if (t.startsWith('--')) {
      const name = t.slice(2).split('=')[0]
      if (name) long.add(name)
      continue
    }
    // `-` 하나는 stdin 을 뜻하는 operand 다. `+main` 같은 refspec 도 플래그가 아니다.
    if (t.startsWith('-') && t.length > 1) {
      for (const c of t.slice(1)) short.add(c)
      continue
    }
    argv.push(t)
  }

  return { argv, short, long }
}
