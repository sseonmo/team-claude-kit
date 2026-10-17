// 이 파일 위치 기준으로 node_modules 를 푼다. engine/tools.mjs 가 부른다.
export const load = (name) => import(name)
