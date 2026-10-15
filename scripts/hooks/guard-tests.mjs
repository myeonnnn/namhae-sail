// PreToolUse 훅: 메인 에이전트가 테스트 파일을 고치지 못하게 막는다. 테스트는 test-writer 에이전트만 고친다.
import { guardTestEdit } from './lib.mjs';
import { projectDir, readHookInput } from './stdin.mjs';

const input = await readHookInput();
// 입력을 읽지 못하면 판정할 수 없으므로 막지 않는다.
if (input) {
  const decision = guardTestEdit(input, projectDir());
  if (!decision.allow) {
    // 종료 코드 2는 도구 호출을 막고, 표준 에러를 모델에게 이유로 전달한다.
    console.error(decision.reason);
    process.exit(2);
  }
}
