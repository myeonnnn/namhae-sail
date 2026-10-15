import { describe, expect, it } from 'vitest';
import { TEST_WRITER, decideStopVerification, failureReason, formatTarget, guardTestEdit } from './lib.mjs';

const PROJECT = '/work/namhae-sail';
const edit = (file_path, tool_name = 'Edit') => ({ tool_name, tool_input: { file_path } });

describe('서식을 맞출 파일 (formatTarget)', () => {
  it('Edit, Write, MultiEdit로 고친 프로젝트 안의 대상 확장자 파일은 그 절대 경로를 돌려준다', () => {
    expect(formatTarget(edit(`${PROJECT}/src/sim/race.ts`, 'Edit'), PROJECT)).toBe(`${PROJECT}/src/sim/race.ts`);
    expect(formatTarget(edit(`${PROJECT}/scripts/a.mjs`, 'Write'), PROJECT)).toBe(`${PROJECT}/scripts/a.mjs`);
    expect(formatTarget(edit(`${PROJECT}/src/b.mts`, 'MultiEdit'), PROJECT)).toBe(`${PROJECT}/src/b.mts`);
  });

  it('대상 확장자는 .ts, .mts, .js, .mjs, .json, .css이다', () => {
    for (const ext of ['ts', 'mts', 'js', 'mjs', 'json', 'css']) {
      expect(formatTarget(edit(`${PROJECT}/src/file.${ext}`), PROJECT)).toBe(`${PROJECT}/src/file.${ext}`);
    }
  });

  it('그 밖의 확장자는 대상이 아니다', () => {
    for (const name of ['README.md', 'index.html', 'shader.glsl', 'a.py', 'Makefile']) {
      expect(formatTarget(edit(`${PROJECT}/${name}`), PROJECT)).toBeNull();
    }
  });

  it('node_modules와 dist 아래의 파일은 대상이 아니다', () => {
    expect(formatTarget(edit(`${PROJECT}/node_modules/three/build/three.module.js`), PROJECT)).toBeNull();
    expect(formatTarget(edit(`${PROJECT}/dist/assets/index.js`), PROJECT)).toBeNull();
  });

  it('프로젝트 폴더 바깥의 파일은 대상이 아니다 (이름이 프로젝트 폴더로 시작하는 옆 폴더도 바깥이다)', () => {
    expect(formatTarget(edit('/tmp/other/a.ts'), PROJECT)).toBeNull();
    expect(formatTarget(edit(`${PROJECT}-old/src/a.ts`), PROJECT)).toBeNull();
  });

  it('파일을 고치는 도구가 아니거나 파일 경로가 없으면 대상이 아니다', () => {
    expect(formatTarget(edit(`${PROJECT}/src/a.ts`, 'Read'), PROJECT)).toBeNull();
    expect(formatTarget({ tool_name: 'Bash', tool_input: { command: 'ls' } }, PROJECT)).toBeNull();
    expect(formatTarget({ tool_name: 'Edit', tool_input: {} }, PROJECT)).toBeNull();
    expect(formatTarget({}, PROJECT)).toBeNull();
  });
});

describe('테스트 파일을 고칠 자격 (guardTestEdit)', () => {
  it('메인 에이전트가 프로젝트 안의 테스트 파일을 고치거나 만들려 하면 막고, test-writer에게 맡기라고 안내한다', () => {
    for (const tool of ['Edit', 'Write', 'MultiEdit']) {
      const result = guardTestEdit(edit(`${PROJECT}/src/sim/race.test.ts`, tool), PROJECT);
      expect(result.allow).toBe(false);
      expect(result.reason).toContain(TEST_WRITER);
    }
  });

  it('*.test.* 형태라면 통합, 브라우저 테스트와 .mjs 테스트도 테스트 파일이다', () => {
    for (const file of ['src/a.integration.test.ts', 'src/b.browser.test.ts', 'scripts/harness/lib.test.mjs']) {
      expect(guardTestEdit(edit(`${PROJECT}/${file}`), PROJECT).allow).toBe(false);
    }
  });

  it('test-writer 에이전트는 테스트 파일을 고칠 수 있다', () => {
    const input = { ...edit(`${PROJECT}/src/sim/race.test.ts`, 'Write'), agent_id: 'a1', agent_type: TEST_WRITER };
    expect(guardTestEdit(input, PROJECT)).toEqual({ allow: true });
  });

  it('test-writer가 아닌 다른 서브에이전트도 테스트 파일은 막는다', () => {
    const input = { ...edit(`${PROJECT}/src/sim/race.test.ts`), agent_id: 'a2', agent_type: 'general-purpose' };
    const result = guardTestEdit(input, PROJECT);
    expect(result.allow).toBe(false);
    expect(result.reason).toContain(TEST_WRITER);
  });

  it('테스트 파일이 아니면 메인 에이전트도 고칠 수 있다', () => {
    expect(guardTestEdit(edit(`${PROJECT}/src/sim/race.ts`), PROJECT)).toEqual({ allow: true });
    // 이름에 test가 들어 있어도 `.test.` 형태가 아니면 테스트 파일이 아니다.
    expect(guardTestEdit(edit(`${PROJECT}/src/latest.ts`), PROJECT)).toEqual({ allow: true });
    expect(guardTestEdit(edit(`${PROJECT}/src/testing.ts`), PROJECT)).toEqual({ allow: true });
  });

  it('파일을 고치는 도구가 아니면 테스트 파일이어도 허용한다', () => {
    expect(guardTestEdit(edit(`${PROJECT}/src/sim/race.test.ts`, 'Read'), PROJECT)).toEqual({ allow: true });
    expect(guardTestEdit({ tool_name: 'Bash', tool_input: { command: 'pnpm test' } }, PROJECT)).toEqual({
      allow: true,
    });
  });

  it('프로젝트 폴더 바깥의 테스트 파일은 허용한다', () => {
    expect(guardTestEdit(edit('/tmp/scratch/probe.test.ts'), PROJECT)).toEqual({ allow: true });
    expect(guardTestEdit(edit(`${PROJECT}-old/src/a.test.ts`), PROJECT)).toEqual({ allow: true });
  });
});

describe('응답을 끝낼 때의 검사 여부 (decideStopVerification)', () => {
  const state = (overrides) => ({
    stopHookActive: false,
    fingerprint: 'B',
    lastVerified: null,
    lastFailed: null,
    ...overrides,
  });

  it('한 번도 검사하지 않았으면 검사한다', () => {
    expect(decideStopVerification(state({}))).toBe('verify');
  });

  it('지문이 마지막으로 통과한 지문과 같으면 건너뛴다', () => {
    expect(decideStopVerification(state({ fingerprint: 'A', lastVerified: 'A' }))).toBe('skip');
    expect(decideStopVerification(state({ stopHookActive: true, fingerprint: 'A', lastVerified: 'A' }))).toBe('skip');
  });

  it('지문이 마지막으로 통과한 지문과 다르면 검사한다', () => {
    expect(decideStopVerification(state({ fingerprint: 'B', lastVerified: 'A' }))).toBe('verify');
  });

  it('Stop 훅 때문에 이어 가는 중이어도, 실패 뒤에 지문이 바뀌었으면 다시 검사한다', () => {
    expect(
      decideStopVerification(state({ stopHookActive: true, fingerprint: 'C', lastVerified: 'A', lastFailed: 'B' })),
    ).toBe('verify');
  });

  it('Stop 훅 때문에 이어 가는 중인데 실패한 지문에서 바뀌지 않았으면, 다시 막지 않고 건너뛴다', () => {
    expect(
      decideStopVerification(state({ stopHookActive: true, fingerprint: 'B', lastVerified: 'A', lastFailed: 'B' })),
    ).toBe('skip');
  });

  it('이어 가는 중이 아니면, 실패한 지문과 같아도 다시 검사한다 (새 응답에서는 실패를 다시 알려야 한다)', () => {
    expect(decideStopVerification(state({ stopHookActive: false, fingerprint: 'B', lastFailed: 'B' }))).toBe('verify');
  });
});

describe('실패한 검사의 이유 (failureReason)', () => {
  it('실패한 명령의 이름으로 시작하고 출력을 포함한다', () => {
    const reason = failureReason('pnpm typecheck', "src/a.ts(3,1): error TS2304: Cannot find name 'x'.");
    expect(reason.startsWith('pnpm typecheck')).toBe(true);
    expect(reason).toContain("error TS2304: Cannot find name 'x'.");
  });

  it('긴 출력은 끝부분을 남기고, 전체 길이가 maxLength를 넘지 않는다', () => {
    const output = `${'앞부분의 잡음\n'.repeat(500)}Tests  3 failed | 111 passed (114)`;
    const reason = failureReason('pnpm test', output, 300);
    expect(reason.length).toBeLessThanOrEqual(300);
    expect(reason.startsWith('pnpm test')).toBe(true);
    expect(reason).toContain('Tests  3 failed | 111 passed (114)');
  });

  it('maxLength를 주지 않으면 2000자를 넘지 않는다', () => {
    const output = `${'x'.repeat(10000)}끝`;
    const reason = failureReason('pnpm test', output);
    expect(reason.length).toBeLessThanOrEqual(2000);
    expect(reason.endsWith('끝')).toBe(true);
    // 한도를 넘는 출력이라면 한도를 거의 다 써서 끝부분을 최대한 남긴다.
    expect(reason.length).toBeGreaterThan(1900);
  });

  it('터미널 색상 코드를 지운다', () => {
    const output = '\u001b[31m FAIL \u001b[39m src/a.test.ts\n\u001b[1m\u001b[32m✓\u001b[0m ok';
    const reason = failureReason('pnpm test', output);
    expect(reason).not.toContain('\u001b');
    expect(reason).toContain(' FAIL  src/a.test.ts');
    expect(reason).toContain('✓ ok');
  });

  it('색상 코드를 지운 뒤의 길이로 한도를 지킨다', () => {
    const output = '\u001b[31mE\u001b[39m'.repeat(1000);
    const reason = failureReason('pnpm test', output, 500);
    expect(reason).not.toContain('\u001b');
    expect(reason.length).toBeLessThanOrEqual(500);
  });
});
