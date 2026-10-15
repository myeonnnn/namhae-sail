import { describe, expect, it } from 'vitest';
import {
  FaultNotApplicableError,
  applyFault,
  expectedProject,
  findClassificationProblems,
  findFlakyTests,
  findSlowFiles,
} from './lib.mjs';

describe('파일 이름이 정하는 분류 (기준 1)', () => {
  it('browser, integration, 나머지 test 파일을 각각 browser, integration, unit으로 본다', () => {
    expect(expectedProject('hull.browser.test.ts')).toBe('browser');
    expect(expectedProject('voyage.integration.test.ts')).toBe('integration');
    expect(expectedProject('race.test.ts')).toBe('unit');
  });

  it('확장자가 달라도 같은 규칙을 따른다', () => {
    expect(expectedProject('lib.test.mjs')).toBe('unit');
    expect(expectedProject('scene.browser.test.js')).toBe('browser');
    expect(expectedProject('flow.integration.test.mts')).toBe('integration');
  });

  it('경로에 폴더가 포함되어도 파일 이름으로만 판단한다', () => {
    expect(expectedProject('src/render/water.browser.test.ts')).toBe('browser');
    expect(expectedProject('src/sim/voyage.integration.test.ts')).toBe('integration');
    expect(expectedProject('scripts/harness/lib.test.mjs')).toBe('unit');
  });

  it('폴더 이름에 browser나 integration이 들어 있어도 파일 이름이 정하는 분류를 따른다', () => {
    expect(expectedProject('browser/race.test.ts')).toBe('unit');
    expect(expectedProject('integration/shore.test.ts')).toBe('unit');
  });
});

describe('묶음 분류의 문제 찾기 (기준 2)', () => {
  it('모든 파일이 이름에 맞는 묶음 하나에만 있으면 세 목록이 모두 비어 있다', () => {
    const allFiles = ['a.test.ts', 'b.integration.test.ts', 'c.browser.test.ts'];
    const assigned = { unit: ['a.test.ts'], integration: ['b.integration.test.ts'], browser: ['c.browser.test.ts'] };
    expect(findClassificationProblems(allFiles, assigned)).toEqual({ unassigned: [], duplicated: [], misplaced: [] });
  });

  it('테스트 파일이 하나도 없으면 세 목록이 모두 비어 있다', () => {
    expect(findClassificationProblems([], { unit: [], integration: [], browser: [] })).toEqual({
      unassigned: [],
      duplicated: [],
      misplaced: [],
    });
  });

  it('어느 묶음에도 잡히지 않은 파일은 unassigned에 이름 순으로 들어간다', () => {
    const allFiles = ['z.test.ts', 'a.test.ts', 'm.integration.test.ts', 'ok.test.ts'];
    const assigned = { unit: ['ok.test.ts'], integration: [], browser: [] };
    const problems = findClassificationProblems(allFiles, assigned);
    expect(problems.unassigned).toEqual(['a.test.ts', 'm.integration.test.ts', 'z.test.ts']);
    expect(problems.duplicated).toEqual([]);
    expect(problems.misplaced).toEqual([]);
  });

  it('둘 이상의 묶음에 잡힌 파일은 duplicated에 그 묶음들과 함께 들어가고, misplaced에는 들어가지 않는다', () => {
    const allFiles = ['b.test.ts', 'a.integration.test.ts'];
    const assigned = {
      unit: ['b.test.ts', 'a.integration.test.ts'],
      integration: ['a.integration.test.ts', 'b.test.ts'],
      browser: [],
    };
    const problems = findClassificationProblems(allFiles, assigned);
    expect(problems.duplicated.map((d) => d.file)).toEqual(['a.integration.test.ts', 'b.test.ts']);
    for (const d of problems.duplicated) expect([...d.projects].sort()).toEqual(['integration', 'unit']);
    expect(problems.unassigned).toEqual([]);
    expect(problems.misplaced).toEqual([]);
  });

  it('세 묶음 모두에 잡힌 파일은 세 묶음을 모두 기록한다', () => {
    const file = 'x.browser.test.ts';
    const problems = findClassificationProblems([file], { unit: [file], integration: [file], browser: [file] });
    expect(problems.duplicated).toHaveLength(1);
    expect(problems.duplicated[0].file).toBe(file);
    expect([...problems.duplicated[0].projects].sort()).toEqual(['browser', 'integration', 'unit']);
  });

  it('한 묶음에만 있지만 이름이 정하는 분류와 다르면 misplaced에 기대 분류와 실제 묶음이 이름 순으로 들어간다', () => {
    const allFiles = ['src/w.browser.test.ts', 'src/a.integration.test.ts', 'src/ok.test.ts', 'src/k.test.ts'];
    const assigned = {
      unit: ['src/ok.test.ts', 'src/w.browser.test.ts', 'src/a.integration.test.ts'],
      integration: ['src/k.test.ts'],
      browser: [],
    };
    const problems = findClassificationProblems(allFiles, assigned);
    expect(problems.misplaced).toEqual([
      { file: 'src/a.integration.test.ts', expected: 'integration', actual: 'unit' },
      { file: 'src/k.test.ts', expected: 'unit', actual: 'integration' },
      { file: 'src/w.browser.test.ts', expected: 'browser', actual: 'unit' },
    ]);
    expect(problems.unassigned).toEqual([]);
    expect(problems.duplicated).toEqual([]);
  });

  it('세 종류의 문제가 섞여 있으면 각 파일이 해당하는 목록 하나에만 들어간다', () => {
    const allFiles = ['ok.test.ts', 'lost.test.ts', 'twice.test.ts', 'wrong.browser.test.ts'];
    const assigned = {
      unit: ['ok.test.ts', 'twice.test.ts'],
      integration: ['twice.test.ts', 'wrong.browser.test.ts'],
      browser: [],
    };
    const problems = findClassificationProblems(allFiles, assigned);
    expect(problems.unassigned).toEqual(['lost.test.ts']);
    expect(problems.duplicated.map((d) => d.file)).toEqual(['twice.test.ts']);
    expect(problems.misplaced).toEqual([{ file: 'wrong.browser.test.ts', expected: 'browser', actual: 'integration' }]);
  });
});

describe('시간 한도를 넘은 파일 찾기 (기준 3)', () => {
  const budgets = { unit: 500, integration: 5000, browser: 20000 };

  it('한도를 넘은 파일만, 오래 걸린 순으로 분류와 한도를 함께 돌려준다', () => {
    const results = [
      { file: 'src/fast.test.ts', durationMs: 120 },
      { file: 'src/slow.test.ts', durationMs: 800 },
      { file: 'src/flow.integration.test.ts', durationMs: 6200 },
      { file: 'src/ok.integration.test.ts', durationMs: 4000 },
      { file: 'src/scene.browser.test.ts', durationMs: 25000 },
    ];
    expect(findSlowFiles(results, budgets)).toEqual([
      { file: 'src/scene.browser.test.ts', project: 'browser', durationMs: 25000, budgetMs: 20000 },
      { file: 'src/flow.integration.test.ts', project: 'integration', durationMs: 6200, budgetMs: 5000 },
      { file: 'src/slow.test.ts', project: 'unit', durationMs: 800, budgetMs: 500 },
    ]);
  });

  it('한도는 파일 이름이 정하는 분류에 따라 고른다: 같은 시간이라도 unit은 넘고 integration은 넘지 않는다', () => {
    const results = [
      { file: 'a.test.ts', durationMs: 3000 },
      { file: 'b.integration.test.ts', durationMs: 3000 },
    ];
    expect(findSlowFiles(results, budgets)).toEqual([
      { file: 'a.test.ts', project: 'unit', durationMs: 3000, budgetMs: 500 },
    ]);
  });

  it('한도와 정확히 같은 시간은 넘지 않은 것이고, 조금이라도 넘으면 넘은 것이다', () => {
    const results = [
      { file: 'equal.test.ts', durationMs: 500 },
      { file: 'over.test.ts', durationMs: 500.1 },
    ];
    expect(findSlowFiles(results, budgets)).toEqual([
      { file: 'over.test.ts', project: 'unit', durationMs: 500.1, budgetMs: 500 },
    ]);
  });

  it('모든 파일이 한도 안이거나 결과가 없으면 빈 목록이다', () => {
    expect(findSlowFiles([{ file: 'a.test.ts', durationMs: 0 }], budgets)).toEqual([]);
    expect(findSlowFiles([], budgets)).toEqual([]);
  });
});

describe('불안정한 테스트 찾기 (기준 4)', () => {
  it('실행마다 결과가 달랐던 테스트만 식별자 순으로 돌려준다', () => {
    const runs = [
      { 'z > 흔들림': 'passed', 'a > 흔들림': 'failed', 안정: 'passed' },
      { 'z > 흔들림': 'failed', 'a > 흔들림': 'passed', 안정: 'passed' },
      { 'z > 흔들림': 'passed', 'a > 흔들림': 'failed', 안정: 'passed' },
    ];
    expect(findFlakyTests(runs)).toEqual(['a > 흔들림', 'z > 흔들림']);
  });

  it('모든 실행에서 실패한 테스트는 불안정한 것이 아니다', () => {
    const runs = [
      { 늘실패: 'failed', 늘통과: 'passed', 늘생략: 'skipped' },
      { 늘실패: 'failed', 늘통과: 'passed', 늘생략: 'skipped' },
    ];
    expect(findFlakyTests(runs)).toEqual([]);
  });

  it('통과와 생략이 섞여도 결과가 달랐던 것으로 본다', () => {
    const runs = [{ t: 'passed' }, { t: 'skipped' }];
    expect(findFlakyTests(runs)).toEqual(['t']);
  });

  it('어떤 실행에서 아예 빠진 테스트도 포함한다 (첫 실행에서 빠져도, 나중 실행에서 빠져도)', () => {
    const runs = [
      { 공통: 'passed', 나중에빠짐: 'passed' },
      { 공통: 'passed', 처음엔없음: 'passed' },
    ];
    expect(findFlakyTests(runs)).toEqual(['나중에빠짐', '처음엔없음'].sort());
  });

  it('한 번에서 빠진 테스트는 남은 실행의 결과가 모두 같아도 포함한다', () => {
    const runs = [{ t: 'failed' }, { t: 'failed' }, {}];
    expect(findFlakyTests(runs)).toEqual(['t']);
  });

  it('실행이 한 번뿐이거나 없으면 비교할 것이 없으므로 빈 목록이다', () => {
    expect(findFlakyTests([{ a: 'passed', b: 'failed' }])).toEqual([]);
    expect(findFlakyTests([])).toEqual([]);
  });
});

describe('오류 주입 (기준 5)', () => {
  const source = ['export function drag(v) {', '  return 0.5 * v * v;', '}', ''].join('\n');

  it('찾을 문자열이 정확히 한 번 나오면 그 자리만 바꾼 소스를 돌려준다', () => {
    const result = applyFault(source, { find: '0.5 * v * v', replace: '0.5 * v' });
    expect(result).toBe(['export function drag(v) {', '  return 0.5 * v;', '}', ''].join('\n'));
  });

  it('원래 소스 문자열은 바뀌지 않고, 바꾼 자리 밖의 내용은 그대로 남는다', () => {
    const before = source;
    const result = applyFault(source, { find: 'return', replace: 'return -' });
    expect(source).toBe(before);
    expect(result.startsWith('export function drag(v) {\n  return -')).toBe(true);
    expect(result.endsWith(' 0.5 * v * v;\n}\n')).toBe(true);
  });

  it('replace의 $&나 $1 같은 문자는 특별한 뜻 없이 글자 그대로 들어간다', () => {
    expect(applyFault('a + b', { find: '+', replace: '$&-$1' })).toBe('a $&-$1 b');
  });

  it('찾을 문자열이 한 번도 나오지 않으면 주입하지 않고 FaultNotApplicableError를 던진다', () => {
    // 코드 서식이 바뀌어 주입할 자리가 사라진 경우: 조용히 원본을 돌려주면 안 된다.
    expect(() => applyFault(source, { find: '0.5*v*v', replace: '0' })).toThrow(FaultNotApplicableError);
  });

  it('찾을 문자열이 두 번 이상 나오면 어느 자리인지 정해지지 않으므로 FaultNotApplicableError를 던진다', () => {
    expect(() => applyFault(source, { find: 'v', replace: 'w' })).toThrow(FaultNotApplicableError);
    expect(() => applyFault('x = 1;\nx = 1;\n', { find: 'x = 1;', replace: 'x = 2;' })).toThrow(
      FaultNotApplicableError,
    );
  });

  it('겹쳐서 두 번 나오는 경우도 두 번으로 본다', () => {
    // 'aa'는 'aaa'의 0번째와 1번째 자리에서 시작하므로, 주입할 자리가 하나로 정해지지 않는다.
    expect(() => applyFault('aaa', { find: 'aa', replace: 'b' })).toThrow(FaultNotApplicableError);
  });
});
