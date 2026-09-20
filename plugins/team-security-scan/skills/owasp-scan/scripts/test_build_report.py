#!/usr/bin/env python3
"""build_report.py 테스트.

    python3 test_build_report.py
"""

import json
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
BUILD = HERE / "build_report.py"

BASE = {
    "repo": "vulnshop",
    "scannedAt": "2026-09-20 17:00",
    "scope": {"files": 9, "loc": 271, "excluded": ["node_modules"]},
    "tools": [{"name": "semgrep", "version": "1.177.0", "config": "p/default",
               "status": "ran", "findings": 17}],
    "findings": [{
        "id": "A05-1", "category": "A05", "severity": "critical",
        "title": "문자열 결합 SQL 인젝션", "file": "src/routes/users.js",
        "line": 2, "endLine": 3,
        "scenario": "id 에 ' OR '1'='1 을 넣으면 WHERE 절이 항상 참이 된다.",
        "fix": "파라미터 바인딩을 쓴다.", "source": "semgrep", "verification": "CONFIRMED",
    }],
}

# 코드 조각은 JSON 에 넣지 않고 스크립트가 디스크에서 읽는다.
# 따옴표와 백슬래시가 섞인, 실제로 JSON 을 깨뜨렸던 모양의 코드를 쓴다.
SOURCE = '''const db = require('../db');
const rows = await db.query("SELECT * FROM users WHERE id = '" + req.params.id + "'");
res.send('<script src=\\"x.js\\"></script>');
module.exports = rows;
'''


def run(payload_text, out_name="r.html", source=SOURCE):
    """payload_text 를 파일로 쓰고 build_report.py 를 돌린다."""
    with tempfile.TemporaryDirectory() as d:
        repo = Path(d) / "repo"
        (repo / "src" / "routes").mkdir(parents=True)
        (repo / "src" / "routes" / "users.js").write_text(source)
        src = Path(d) / "findings.json"
        src.write_text(payload_text)
        out = Path(d) / out_name
        p = subprocess.run([sys.executable, str(BUILD), str(src), str(out), str(repo)],
                           capture_output=True, text=True)
        return p, (out.read_text() if out.exists() else None)


def extract(html):
    marker = '<script id="scan-data" type="application/json">'
    start = html.index(marker) + len(marker)
    return json.loads(html[start:html.index("</script>", start)])


def check(name, cond, detail=""):
    print(f"  {'PASS' if cond else 'FAIL'}  {name}" + (f" — {detail}" if not cond and detail else ""))
    return cond


def main():
    results = []
    print("build_report.py")

    # 정상 입력
    p, html = run(json.dumps(BASE, ensure_ascii=False))
    results.append(check("정상 입력이 성공한다", p.returncode == 0, p.stderr))
    results.append(check("HTML 이 생성된다", html is not None))
    if html:
        data = extract(html)
        results.append(check("주입된 JSON 이 다시 파싱된다", data["findings"][0]["id"] == "A05-1"))
        results.append(check("한글이 깨지지 않는다", "SQL 인젝션" in html))

        # 따옴표·백슬래시가 섞인 코드를 디스크에서 읽어 넣어도 JSON 이 깨지지 않는다 —
        # 손으로 쓴 snippet 이 실제로 리포트를 못 열게 만들었던 버그
        snip = data["findings"][0].get("snippet", "")
        results.append(check("코드 조각을 디스크에서 읽어온다", 'req.params.id' in snip, snip[:80]))
        results.append(check("line~endLine 범위만 가져온다",
                             snip.startswith("const rows") and "module.exports" not in snip, snip[:80]))
        results.append(check("따옴표가 섞인 코드도 파싱을 깨지 않는다", '\\"x.js\\"' in snip or '"x.js"' in snip, snip))

    # 산문 필드에 실제 줄바꿈이 들어간 깨진 JSON 은 복구한다
    raw = json.dumps(BASE, ensure_ascii=False)
    i = raw.index('"fix": "') + len('"fix": "')
    raw = raw[:i] + "첫 줄\n둘째 줄\t끝. " + raw[i:]
    p, html = run(raw)
    results.append(check("문자열 안 실제 줄바꿈을 복구한다", p.returncode == 0, p.stderr))
    results.append(check("복구 사실을 알린다", "복구" in p.stderr, p.stderr))
    if html:
        results.append(check("복구된 값에 줄바꿈이 보존된다", "첫 줄\n둘째 줄" in extract(html)["findings"][0]["fix"]))

    # 없는 파일을 가리키면 지어내지 않고 알린다
    bad = json.loads(json.dumps(BASE))
    bad["findings"][0]["file"] = "src/routes/nope.js"
    p, html = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("없는 파일을 가리켜도 리포트는 생성된다", p.returncode == 0, p.stderr))
    results.append(check("없는 파일을 경고한다", "nope.js" in p.stderr, p.stderr))
    if html:
        results.append(check("없는 파일의 snippet 은 비운다", not extract(html)["findings"][0].get("snippet")))

    # 2021 번호를 쓰면 거부한다
    bad = json.loads(json.dumps(BASE))
    bad["findings"][0]["category"] = "A03"  # 2021 의 Injection 번호
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("A01~A10 밖의 항목코드는 거부하지 않는다(A03 은 유효)", p.returncode == 0))

    bad["findings"][0]["category"] = "A11"
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("범위 밖 항목코드를 거부한다", p.returncode == 1))
    results.append(check("거부 사유에 변환표를 안내한다", "변환표" in p.stderr, p.stderr))

    # 필수 필드 누락
    bad = json.loads(json.dumps(BASE))
    del bad["findings"][0]["scenario"]
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("필수 필드 누락을 거부한다", p.returncode == 1))
    results.append(check("어느 필드인지 알려준다", "scenario" in p.stderr, p.stderr))

    # REJECTED 는 실으면 안 된다
    bad = json.loads(json.dumps(BASE))
    bad["findings"][0]["verification"] = "REJECTED"
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("REJECTED 발견을 거부한다", p.returncode == 1))

    # 미실행 도구는 사유가 필요하다
    bad = json.loads(json.dumps(BASE))
    bad["tools"].append({"name": "osv-scanner", "status": "skipped"})
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("사유 없는 미실행 도구를 거부한다", p.returncode == 1))

    bad["tools"][-1]["reason"] = "설치되어 있지 않음"
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("사유가 있으면 통과한다", p.returncode == 0, p.stderr))
    results.append(check("미실행 도구를 요약에 보고한다", "미실행" in p.stdout, p.stdout))

    # id 중복
    bad = json.loads(json.dumps(BASE))
    bad["findings"].append(json.loads(json.dumps(bad["findings"][0])))
    p, _ = run(json.dumps(bad, ensure_ascii=False))
    results.append(check("id 중복을 거부한다", p.returncode == 1))

    print(f"\n{sum(results)}/{len(results)} 통과")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
