#!/usr/bin/env python3
"""스캔 결과 JSON 을 대시보드 HTML 로 조립한다.

    python3 build_report.py <findings.json> <출력.html> [리포루트]

코드 조각은 JSON 에 넣지 않는다. `file` 과 `line`(선택적으로 `endLine`)만 주면
이 스크립트가 리포에서 해당 줄을 직접 읽어 넣는다. 손으로 쓴 코드가 JSON 을
깨뜨리는 일도, 지어낸 코드가 리포트에 실리는 일도 없어진다.

산문 필드에 실제 줄바꿈이 들어간 경우는 자동 복구하고, 스키마를 검사하고,
주입한 결과가 다시 파싱되는지까지 확인한다. 실패하면 0 이 아닌 코드로 종료한다.
"""

import json
import re
import sys
from pathlib import Path

CATEGORIES = [f"A{n:02d}" for n in range(1, 11)]
SEVERITIES = ["critical", "high", "medium", "low"]
REQUIRED = ["id", "category", "severity", "title", "file", "scenario", "fix", "source"]
MARKER = '<script id="scan-data" type="application/json">'


def repair_control_chars(text):
    """JSON 문자열 리터럴 안의 실제 제어문자를 이스케이프한다."""
    out = []
    in_string = False
    escaped = False
    repaired = 0
    for ch in text:
        if escaped:
            out.append(ch)
            escaped = False
            continue
        if ch == "\\":
            out.append(ch)
            escaped = in_string
            continue
        if ch == '"':
            in_string = not in_string
            out.append(ch)
            continue
        if in_string and ch in "\n\r\t":
            out.append({"\n": "\\n", "\r": "\\r", "\t": "\\t"}[ch])
            repaired += 1
            continue
        out.append(ch)
    return "".join(out), repaired


def load(path):
    text = Path(path).read_text()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        fixed, n = repair_control_chars(text)
        data = json.loads(fixed)  # 여기서도 실패하면 그대로 예외를 낸다
        print(f"  복구: 문자열 안의 실제 제어문자 {n}개를 이스케이프했습니다", file=sys.stderr)
        return data


def validate(data):
    errors = []
    for key in ("repo", "scannedAt", "scope", "tools", "findings"):
        if key not in data:
            errors.append(f"최상위 키 누락: {key}")
    seen = set()
    for i, f in enumerate(data.get("findings", [])):
        where = f.get("id") or f"findings[{i}]"
        for key in REQUIRED:
            if not f.get(key):
                errors.append(f"{where}: 필수 필드 누락 — {key}")
        if f.get("category") not in CATEGORIES:
            errors.append(f"{where}: category 가 A01~A10 이 아님 — {f.get('category')!r} "
                          f"(2021 번호를 쓰지 않았는지 변환표를 확인할 것)")
        if f.get("severity") not in SEVERITIES:
            errors.append(f"{where}: severity 가 {SEVERITIES} 중 하나가 아님 — {f.get('severity')!r}")
        if f.get("verification") not in (None, "CONFIRMED", "PLAUSIBLE"):
            errors.append(f"{where}: verification 은 CONFIRMED/PLAUSIBLE 만 허용 — "
                          f"{f.get('verification')!r} (REJECTED 는 리포트에서 제외할 것)")
        if f.get("id") in seen:
            errors.append(f"{where}: id 중복")
        seen.add(f.get("id"))
    for t in data.get("tools", []):
        if t.get("status") not in ("ran", "skipped"):
            errors.append(f"tools[{t.get('name')}]: status 는 ran/skipped 만 허용")
        if t.get("status") == "skipped" and not t.get("reason"):
            errors.append(f"tools[{t.get('name')}]: 미실행 도구는 reason 이 필요함")
    return errors


def attach_snippets(data, repo_root):
    """발견의 file/line 을 읽어 코드 조각을 채운다. 없는 파일은 경고하고 비워 둔다."""
    missing = []
    for f in data.get("findings", []):
        if f.get("snippet") or not f.get("line"):
            continue
        path = repo_root / f["file"]
        if not path.is_file():
            missing.append(f"{f['id']}: {f['file']}")
            continue
        try:
            lines = path.read_text(errors="replace").splitlines()
        except OSError:
            missing.append(f"{f['id']}: {f['file']} (읽기 실패)")
            continue
        start = max(1, int(f["line"]))
        end = min(len(lines), int(f.get("endLine") or start + 4))
        if start > len(lines):
            missing.append(f"{f['id']}: {f['file']}:{start} (파일 범위 밖)")
            continue
        f["snippet"] = "\n".join(lines[start - 1:end])
    if missing:
        print(f"  경고: 코드 조각을 읽지 못한 발견 {len(missing)}건 — 위치를 확인할 것", file=sys.stderr)
        for m in missing[:10]:
            print(f"    - {m}", file=sys.stderr)
    return data


def main():
    if len(sys.argv) not in (3, 4):
        print(__doc__, file=sys.stderr)
        return 2

    findings_path, out_path = sys.argv[1], sys.argv[2]
    repo_root = Path(sys.argv[3]).resolve() if len(sys.argv) == 4 else Path.cwd()
    template = Path(__file__).resolve().parent.parent / "assets" / "report.html"
    if not template.exists():
        print(f"오류: 템플릿을 찾을 수 없습니다 — {template}", file=sys.stderr)
        return 1

    try:
        data = load(findings_path)
    except json.JSONDecodeError as e:
        print(f"오류: {findings_path} 를 JSON 으로 읽을 수 없습니다 — {e}", file=sys.stderr)
        return 1

    errors = validate(data)
    if errors:
        print(f"오류: 스키마 검사 실패 {len(errors)}건", file=sys.stderr)
        for e in errors[:30]:
            print(f"  - {e}", file=sys.stderr)
        return 1

    attach_snippets(data, repo_root)

    html = template.read_text()
    start = html.index(MARKER) + len(MARKER)
    end = html.index("</script>", start)
    payload = json.dumps(data, ensure_ascii=False, indent=2)
    # 코드 조각에 </script> 나 <!-- 가 들어 있으면 스크립트 태그가 조기에 닫혀 페이지가 깨진다.
    # JSON 에서 "\/" 는 "/" 와 같으므로 의미를 바꾸지 않고 안전해진다.
    payload = payload.replace("</", "<\\/").replace("<!--", "<\\!--")
    result = html[:start] + "\n" + payload + "\n" + html[end:]

    # 주입한 결과가 다시 파싱되는지 확인한다
    check = re.search(re.escape(MARKER) + r"(.*?)</script>", result, re.S).group(1)
    json.loads(check)

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(result)

    counts = {s: sum(1 for f in data["findings"] if f["severity"] == s) for s in SEVERITIES}
    skipped = [t["name"] for t in data["tools"] if t["status"] == "skipped"]
    print(f"생성: {out_path}")
    print(f"  발견 {len(data['findings'])}건 — " + " · ".join(f"{k} {v}" for k, v in counts.items()))
    if skipped:
        print(f"  미실행 도구: {', '.join(skipped)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
