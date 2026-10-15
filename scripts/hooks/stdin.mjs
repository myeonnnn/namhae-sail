// 훅 실행 스크립트가 함께 쓰는 입력 처리.

/** 표준 입력의 JSON을 읽는다. JSON이 아니면 null을 돌려준다. */
export async function readHookInput() {
  let text = '';
  for await (const chunk of process.stdin) text += chunk;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 프로젝트 폴더. Claude Code가 훅에 CLAUDE_PROJECT_DIR로 넘겨준다. */
export const projectDir = () => process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
