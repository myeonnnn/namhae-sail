// PostToolUse 훅: 도구 호출을 한 줄씩 기록한다. 나중에 "테스트를 먼저 썼는가" 같은 규칙의 준수를 확인하는 데 쓴다.
// 기록이 작업을 막아서는 안 되므로, 어떤 오류가 나도 종료 코드는 0이다.
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { logEntry } from './lib.mjs';
import { projectDir, readHookInput } from './stdin.mjs';

try {
  const input = await readHookInput();
  if (input) {
    const file = process.env.HARNESS_LOG_FILE ?? join(projectDir(), '.claude/logs/tool-calls.jsonl');
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(logEntry(input, projectDir(), new Date())) + '\n');
  }
} catch (error) {
  console.error(`도구 호출을 기록하지 못했다: ${error}`);
}
