// 훅 실행 스크립트를 Claude Code처럼 실제로 띄워서, 표준 입력의 JSON에 대한 종료 코드와 출력, 파일의 변화를 확인한다.
// pnpm exec나 npx를 거치면 띄우는 데만 수백 ms가 걸려서 파일당 5초 한도를 넘기 쉬우므로, node로 직접 띄운다.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const HOOKS = dirname(fileURLToPath(import.meta.url));

/** 훅 하나를 띄우고 표준 입력에 input을 넣는다. 작업 폴더는 임시 폴더로 두어, 저장소의 설정을 우연히 읽지 않게 한다. */
function runHook(script, input, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [join(HOOKS, script)], {
      cwd: tmp,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => (stdout += chunk));
    child.stderr.on('data', (chunk) => (stderr += chunk));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

let tmp;

beforeAll(() => {
  // macOS의 임시 폴더는 /var → /private/var 링크이므로, 경로 비교가 어긋나지 않게 실제 경로를 쓴다.
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'namhae-hooks-')));
});

afterAll(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('테스트 파일 보호 훅 (guard-tests.mjs)', () => {
  const env = () => ({ CLAUDE_PROJECT_DIR: tmp });
  const editInput = (file, extra = {}) => ({
    hook_event_name: 'PreToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: join(tmp, file), old_string: 'a', new_string: 'b' },
    ...extra,
  });

  it('메인 에이전트가 프로젝트 안의 테스트 파일을 고치려 하면 종료 코드 2로 막고, 표준 에러로 test-writer를 안내한다', async () => {
    const result = await runHook('guard-tests.mjs', editInput('src/sim/race.test.ts'), env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('test-writer');
  });

  it('메인 에이전트가 테스트 파일을 새로 만들려(Write) 해도 막는다', async () => {
    const input = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_input: { file_path: join(tmp, 'scripts/new.test.mjs'), content: '' },
    };
    const result = await runHook('guard-tests.mjs', input, env());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('test-writer');
  });

  it('test-writer 에이전트가 고치면 종료 코드 0으로 허용한다', async () => {
    const input = editInput('src/sim/race.test.ts', { agent_id: 'agent-1', agent_type: 'test-writer' });
    expect((await runHook('guard-tests.mjs', input, env())).code).toBe(0);
  });

  it('테스트 파일이 아니면 메인 에이전트도 종료 코드 0으로 허용한다', async () => {
    expect((await runHook('guard-tests.mjs', editInput('src/sim/race.ts'), env())).code).toBe(0);
  });
});

describe('서식 훅 (format.mjs)', () => {
  const env = () => ({ CLAUDE_PROJECT_DIR: tmp });
  const writeInput = (file) => ({
    hook_event_name: 'PostToolUse',
    tool_name: 'Write',
    tool_input: { file_path: file },
  });

  it('저장소 밖의 .ts 파일도 저장소의 .prettierrc.json으로 맞춘다 (작은따옴표, 한 줄 120자)', async () => {
    const file = join(tmp, 'src', 'quotes.ts');
    mkdirSync(dirname(file), { recursive: true });
    // 80자를 넘고 120자보다 짧은 줄: prettier 기본값(80자)이면 나뉘고, 이 저장소의 설정(120자)이면 한 줄로 남는다.
    const long = 'export const pair = ["first-long-identifier-value", "second-long-identifier-value"];';
    writeFileSync(file, `const name = "namhae";\n${long}\n`);

    const result = await runHook('format.mjs', writeInput(file), env());
    expect(result.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(
      "const name = 'namhae';\nexport const pair = ['first-long-identifier-value', 'second-long-identifier-value'];\n",
    );
  });

  it('대상이 아닌 파일(.md)은 바꾸지 않는다', async () => {
    const file = join(tmp, 'notes.md');
    // prettier라면 목록 기호를 `-`로, 강조를 `_`로 바꿀 내용이다.
    const content = '*   첫째\n*   둘째\n\n*강조*\n';
    writeFileSync(file, content);
    const result = await runHook('format.mjs', writeInput(file), env());
    expect(result.code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(content);
  });

  it('문법 오류가 있는 파일이어도 종료 코드는 0이다 (서식은 작업을 막지 않는다)', async () => {
    const file = join(tmp, 'src', 'broken.ts');
    mkdirSync(dirname(file), { recursive: true });
    const content = 'const x = "unclosed;\nfunction (\n';
    writeFileSync(file, content);
    const result = await runHook('format.mjs', writeInput(file), env());
    expect(result.code).toBe(0);
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe(content);
  });
});
