---
name: deep-review
description: 변경 코드를 정확성·보안·구조·테스트 관점으로 리뷰한다. "코드 리뷰해줘", "커밋 전에 봐줘", "push 전 리뷰", "PR 리뷰", "/deep-review --comment" 요청에 사용한다.
---

# deep-review

1. 플러그인 루트를 찾는다. `DEEP_REVIEW_ROOT` 가 있으면 사용하고, 없으면 `~/.claude/plugins/cache` 에서 `*team-code-review/*/engine/cli.mjs` 를 찾아 버전순 최신 경로의 `engine/cli.mjs` 를 제거한다. 파일이 없으면 설치를 안내하고 멈춘다. 호출 cwd 는 유지한다.
2. 인수를 그대로 `node <ROOT>/engine/cli.mjs prepare [--fast|--deep] [--pr] [--comment] [--fresh] [paths...]` 에 전달한다. `--skip <id> [memo]` 인수면 `node <ROOT>/engine/cli.mjs skip <id> [memo]` 를 실행하고 JSON 결과만 출력한 뒤 끝낸다.
3. prepare JSON 을 읽는다. `status: none` 이면 `message` 를 출력하고 끝낸다. `status: reuse` 면 `rendered`, `payloadPath`, `fallbackPath` 를 `prepare.reuse` 에서 가져와 4단계로 간다. `status: run` 이면 `message` 를 출력하고 다음 Workflow 를 실행한다.

   ```
   Workflow({
     scriptPath: '<ROOT>/workflows/deep-review.js',
     args: workflowArgs,
   })
   ```

   이 스킬의 명시적 Workflow 호출 지시가 Workflow 실행을 승인한다. Workflow 도구가 없으면 그 사실을 알리고 멈춘다. 대체 실행 경로는 없다. 완료 알림 전에는 결과를 추측하지 않는다. 반환된 WorkflowResult 를 `<dirname(pendingPath)>/workflow-result.json` 에 Write 한다. Workflow 완료 후에는 항상 settle 한다. `--comment` PR 조회에 성공하면 현재 PR `headRefOid` 를 `--head-ref-oid` 로 포함해 `node <ROOT>/engine/cli.mjs settle --result <파일> --head-ref-oid <headRefOid>` 를 실행하고, 조회에 실패하거나 PR 이 없으면 `node <ROOT>/engine/cli.mjs settle --result <파일>` 를 실행한다. 정산 JSON 에서 `rendered`, `payloadPath`, `fallbackPath` 를 가져온다. PR 조회 실패 시 정산된 로컬 결과를 출력하고 PR 게시를 건너뛴다고 알린다.
4. `run` 은 정산 JSON 의 `rendered` 를, `reuse` 는 `prepare.reuse.rendered` 를 그대로 출력한다. 해석·요약·재정렬하지 않는다. `treeChanged: true` 면 결과는 기록되지 않는다.
5. `--comment` 요청이고 `payloadPath` 가 있으면 게시 직전에 `gh pr view --json number,url,headRefOid` 를 조회해 payload 의 `commit_id` 와 현재 `headRefOid` 를 비교한다. 조회 실패 또는 PR 없음이면 로컬 결과 출력 후 게시를 건너뛴다고 알린다. head 가 다르면 payload 를 사용하지 말고 최신 상태로 2단계부터 전체 prepare 흐름을 다시 실행한다. 같으면 `gh api repos/{owner}/{repo}/pulls/{number}/reviews --method POST --input <payloadPath>` 로 게시한다. `{owner}/{repo}` 는 `gh repo view --json nameWithOwner`, `{number}` 와 URL 은 현재 PR 조회 결과를 쓴다. HTTP 422 이면 `fallbackPath` 를 사용해 한 번 재시도한다. 게시 성공 후 PR URL 을 출력한다. reuse 결과도 같은 규칙으로 게시한다. `--comment` 요청인데 `payloadPath` 가 없으면 PR 이 없거나 조회되지 않아 게시하지 않았다고 알린다. `--comment` 가 없으면 게시하지 않는다.

이 스킬은 파일을 수정하거나 PR 을 만들지 않는다.
