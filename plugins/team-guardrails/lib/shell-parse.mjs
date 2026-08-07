// 셸 명령 문자열을 룰이 판정할 수 있는 형태로 쪼갠다.
//
// 이 파일이 존재하는 이유: 정규식 한 줄로 위험 명령을 잡으려는 시도는 표기 변형에서 조용히 뚫린다.
// `rm\s+-rf` 는 `rm -fr`·`rm -r -f`·`rm --recursive --force`·`cd /tmp && rm -rf x` 를 전부 놓친다.
// 표기와 순서를 여기서 흡수해, 룰은 "r 과 f 가 각각 있는가" 같은 한 줄 질문만 하게 만든다.
//
// 다루지 않는 것 (플러그인 포지션 — 실수를 막는 장치이지 악의를 막는 장치가 아니다):
//   변수 치환 `P=~; rm -rf $P` · 명령 치환 `$(...)` · 스크립트 경유 `bash x.sh` ·
//   인터프리터 경유 `python -c ...` · base64 인코딩
// 전부 통과한다. 정적 판정의 원리적 한계이며, 테스트에 기대값으로 명시돼 있다.

/**
 * 명령을 세그먼트로 나누되 **위치 정보를 함께** 돌려준다.
 *   scopeId   — 서브셸 **인스턴스** 식별자 (top level 은 0)
 *   scopePath — 최상위부터 자기까지의 조상 사슬. 마지막이 `scopeId` 다.
 *   sepAfter  — 이 세그먼트 뒤의 구분자 (`;` `&&` `||` `|` `&` `(` `)` 또는 끝이면 null)
 *
 * 텍스트만 돌려주면 `(cd /tmp && ls); rm -rf dist` 에서 cd 가 서브셸 안이었다는 사실이
 * 사라진다. 실제 셸에서 서브셸·파이프·백그라운드의 cd 는 밖으로 나오지 않으므로,
 * 그걸 모르면 밖의 rm 까지 엉뚱한 기준으로 판정해 정상 명령을 막는다.
 *
 * 깊이만으로는 부족하다. `(a) && (b)` 의 내용물은 둘 다 깊이 1 이라 형제 서브셸이
 * 한 덩어리로 보이고, 앞 서브셸의 cd 가 뒤 서브셸로 샌다. 그래서 인스턴스마다
 * 새 `scopeId` 를 부여한다.
 *
 * 부모를 한 단계만 들고 있어도 부족하다. `cd /tmp; ( (rm -rf junk) )` 의 바깥 괄호는
 * 자기 세그먼트를 갖지 않아 소비자 쪽 맵에 등록되지 않고, 거기서 사슬이 끊긴다.
 * 그래서 조상 전체(`scopePath`)를 준다.
 */
export function splitCommand(command) {
  if (typeof command !== 'string') return []

  const segments = []
  let cur = ''
  let quote = null
  let scopeCounter = 0
  const scopes = [0] // 현재 스코프 스택. 마지막이 지금 스코프다.

  const push = (sepAfter) => {
    const text = cur.trim()
    if (text) {
      segments.push({
        text,
        scopeId: scopes[scopes.length - 1],
        scopePath: [...scopes],
        sepAfter,
      })
    }
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

    if (ch === ';' || ch === '\n') {
      push(';')
      continue
    }
    if (ch === '(') {
      push('(')
      scopes.push(++scopeCounter) // 열릴 때마다 새 인스턴스다
      continue
    }
    if (ch === ')') {
      push(')')
      if (scopes.length > 1) scopes.pop()
      continue
    }
    // `&` 는 명령 경계지만 `2>&1`·`&>` 의 `&` 는 리다이렉션의 일부다.
    // 여기서 잘라내면 세그먼트가 깨져 뒤쪽 토큰이 엉뚱한 명령으로 보인다.
    if (ch === '&') {
      if (cur.trimEnd().endsWith('>') || command[i + 1] === '>') {
        cur += ch
        continue
      }
      if (command[i + 1] === '&') {
        i++
        push('&&')
      } else {
        push('&')
      }
      continue
    }
    if (ch === '|') {
      if (command[i + 1] === '|') {
        i++
        push('||')
      } else {
        push('|')
      }
      continue
    }

    cur += ch
  }
  push(null)

  return segments
}

/** 세그먼트 텍스트만 필요할 때. */
export function splitSegments(command) {
  return splitCommand(command).map((s) => s.text)
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

// 명령 이름 **앞에** 올 수 있는 것들. 권한/실행 래퍼와 셸 키워드다.
// 이 부류를 룰마다 따로 처리했더니 비대칭이 반복해서 새어나갔다 —
// D1 은 sudo 를 벗기는데 D3 는 안 벗기고, D1 은 `{` 를 벗기는데 D3 는 안 벗기는 식이다.
// 한 곳에 모아 그 자리를 없앤다.
// 언제나 실행되는 것들 — 뒤의 명령이 돈다는 사실이 바뀌지 않는다.
// `{`(브레이스 그룹)와 `!`(부정)도 여기다. 문법 장식일 뿐 실행을 막지 않는다.
const EXEC_WRAPPERS = new Set(['sudo', 'env', 'command', 'nohup', 'time', 'exec', '{', '!'])
// 조건·반복 블록을 여는 키워드 — 그 안의 명령은 **실행되지 않을 수도** 있다
const BLOCK_OPENERS = new Set(['if', 'while', 'until', 'for', 'case', 'select'])
// 블록을 닫는 키워드
const BLOCK_CLOSERS = new Set(['fi', 'done', 'esac'])
// 블록 안의 이음말 — 열지도 닫지도 않지만 명령 앞에 붙는다
const BLOCK_JOINERS = new Set(['then', 'else', 'elif', 'do', 'in'])
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

const isPrefix = (t) =>
  EXEC_WRAPPERS.has(t) || BLOCK_OPENERS.has(t) || BLOCK_JOINERS.has(t) || ASSIGNMENT.test(t)

/**
 * 이 세그먼트가 **자기 안에서** 조건·반복 문맥을 여는가.
 *
 * `if ...; then cd /tmp; fi` 의 `cd` 는 실행될 수도, 안 될 수도 있다. 실행된 것으로
 * 단정하면 그 뒤의 정상적인 프로젝트 내부 삭제가 전부 막힌다.
 * 반대로 `time cd /tmp`·`{ cd /tmp; }` 는 언제나 실행되므로 여기 해당하지 않는다.
 *
 * 여러 줄로 쓴 조건문의 본문에는 키워드가 없다. 그건 `blockDelta` 가 맡는다.
 */
export function startsWithShellKeyword(tokens) {
  for (const t of tokens) {
    if (BLOCK_OPENERS.has(t) || BLOCK_JOINERS.has(t)) return true
    if (!isPrefix(t)) return false
  }
  return false
}

/**
 * 이 세그먼트가 조건·반복 블록을 여는지(+1) 닫는지(-1) 알려준다.
 *
 * 세그먼트 하나만 보는 판정은 여러 줄 스크립트에서 무너진다 —
 * `if [ -d x ]; then` / `cd /tmp` / `fi` 로 줄이 갈리면 가운데 줄에는 키워드가 없다.
 * 블록이 열려 있는지를 줄 사이로 이어서 세야 한다.
 *
 * **명령 이름에 도달하면 멈춘다.** 계속 훑으면 `echo if` 나 `rm -rf fi` 처럼
 * 키워드가 인자로 등장한 경우까지 블록으로 세게 된다.
 */
export function blockDelta(tokens) {
  let delta = 0
  for (const t of tokens) {
    if (BLOCK_OPENERS.has(t)) delta++
    else if (BLOCK_CLOSERS.has(t)) delta--
    else if (!isPrefix(t)) break
  }
  return delta
}

/**
 * 명령 이름 앞의 래퍼·키워드·변수 할당을 걷어낸다.
 *
 * **맨 앞에서만** 벗긴다. 중간부터 벗기면 `echo sudo rm -rf /` 가 삭제 명령으로 보인다 —
 * 미탐을 줄이려다 오탐을 만드는 전형적인 자리다.
 */
export function stripCommandPrefixes(tokens) {
  let i = 0
  while (i < tokens.length && isPrefix(tokens[i])) i++
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
