// 테스트 하네스를 검증한다: 분류, 실행 시간, 불안정한 테스트, 오류 주입.
// 실행: pnpm verify:harness [--runs 5] [--skip-faults]
//
// 오류 주입은 소스 파일을 잠시 고쳤다가 되돌린다. 실행 중에 개발 서버가 켜져 있으면 잠깐 깨진 화면이 보일 수 있다.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { FAULTS } from './faults.mjs';
import {
  applyFault,
  FaultNotApplicableError,
  findClassificationProblems,
  findFlakyTests,
  findSlowFiles,
} from './lib.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const VITEST = join(ROOT, 'node_modules/.bin/vitest');
// CLAUDE.md의 "테스트의 분류"와 같은 값이다 (ms).
const BUDGETS = { unit: 500, integration: 5000, browser: 5000 };
const TEST_FILE = /\.test\.(ts|mts|js|mjs)$/;
const SEARCH_ROOTS = ['src', 'scripts'];

const args = process.argv.slice(2);
const runs = Number(args[args.indexOf('--runs') + 1]) || 3;
const skipFaults = args.includes('--skip-faults');

let failed = false;
const report = (ok, title, lines = []) => {
  if (!ok) failed = true;
  console.log(`${ok ? '✓' : '✗'} ${title}`);
  for (const line of lines) console.log(`    ${line}`);
};

function vitest(extraArgs) {
  return spawnSync(VITEST, extraArgs, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function listTestFiles(directory) {
  return readdirSync(join(ROOT, directory), { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : listTestFiles(path);
    return TEST_FILE.test(entry.name) ? [path] : [];
  });
}

/** vitest를 JSON 리포터로 한 번 실행하고, 결과 파일을 읽는다. */
function runSuite() {
  const directory = mkdtempSync(join(tmpdir(), 'harness-'));
  const output = join(directory, 'result.json');
  try {
    vitest(['run', '--reporter=json', `--outputFile=${output}`]);
    return JSON.parse(readFileSync(output, 'utf8'));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

// 1. 분류: 모든 테스트 파일이 이름에 맞는 묶음 하나에만 들어가는가
{
  const allFiles = SEARCH_ROOTS.flatMap(listTestFiles).sort();
  const listed = JSON.parse(vitest(['list', '--json', '--filesOnly']).stdout);
  const assigned = {};
  for (const { file, projectName } of listed) {
    // 브라우저 묶음의 이름에는 "browser (chromium)"처럼 브라우저가 붙는다.
    const project = projectName.replace(/ \(.*\)$/, '');
    (assigned[project] ??= []).push(relative(ROOT, file));
  }
  const { unassigned, duplicated, misplaced } = findClassificationProblems(allFiles, assigned);
  report(unassigned.length + duplicated.length + misplaced.length === 0, `분류: 테스트 파일 ${allFiles.length}개`, [
    ...unassigned.map((file) => `어느 묶음에도 없음: ${file}`),
    ...duplicated.map(({ file, projects }) => `여러 묶음에 있음: ${file} (${projects.join(', ')})`),
    ...misplaced.map(({ file, expected, actual }) => `잘못된 묶음: ${file} (이름은 ${expected}, 실제는 ${actual})`),
  ]);
}

// 2, 3. 실행 시간과 불안정한 테스트: 전체를 여러 번 돌려서, 파일마다 걸린 시간과 실행마다의 결과를 모은다.
// 세 묶음이 병렬로 돌아서 한 번의 시간은 기기의 부하에 따라 흔들린다. 그래서 최댓값이 아니라 중앙값으로 판정한다.
{
  const durations = new Map();
  const outcomes = [];
  let allPassed = true;
  for (let run = 0; run < runs; run++) {
    const result = runSuite();
    allPassed &&= result.success;
    const outcome = {};
    for (const file of result.testResults) {
      const path = relative(ROOT, file.name);
      durations.set(path, [...(durations.get(path) ?? []), file.endTime - file.startTime]);
      for (const test of file.assertionResults) outcome[`${path} > ${test.fullName}`] = test.status;
    }
    outcomes.push(outcome);
  }
  const slow = findSlowFiles(
    [...durations].map(([file, times]) => ({ file, durationMs: median(times) })),
    BUDGETS,
  );
  report(
    slow.length === 0,
    `실행 시간: 파일별 한도 ${JSON.stringify(BUDGETS)} (ms), ${runs}회의 중앙값`,
    slow.map((s) => `${s.file}: ${Math.round(s.durationMs)}ms (한도 ${s.budgetMs}ms)`),
  );
  const flaky = findFlakyTests(outcomes);
  report(flaky.length === 0, `안정성: ${runs}회 실행에서 결과가 바뀐 테스트`, flaky);
  report(allPassed, `전체 통과: ${runs}회 모두`);
}

// 4. 오류 주입: 일부러 망가뜨린 코드를 테스트가 잡는가
if (!skipFaults) {
  const originals = new Map();
  const restore = () => {
    for (const [file, source] of originals) writeFileSync(join(ROOT, file), source);
    originals.clear();
  };
  // 도중에 중단해도 소스가 망가진 채로 남지 않게 한다.
  process.on('SIGINT', () => {
    restore();
    process.exit(130);
  });

  const lines = [];
  let ok = true;
  for (const fault of FAULTS) {
    const path = join(ROOT, fault.file);
    const source = readFileSync(path, 'utf8');
    let broken;
    try {
      broken = applyFault(source, fault);
    } catch (error) {
      if (!(error instanceof FaultNotApplicableError)) throw error;
      ok = false;
      lines.push(`적용 불가: ${fault.name} (${error.message})`);
      continue;
    }
    originals.set(fault.file, source);
    try {
      writeFileSync(path, broken);
      const caught = vitest(['run']).status !== 0;
      if (caught === fault.covered) {
        lines.push(`${caught ? '잡음' : '알려진 빈틈'}: ${fault.name}`);
      } else {
        ok = false;
        lines.push(caught ? `새로 잡음 (covered를 true로): ${fault.name}` : `놓침: ${fault.name}`);
      }
    } finally {
      restore();
    }
  }
  report(ok, `오류 주입: ${FAULTS.length}가지`, lines);
}

process.exit(failed ? 1 : 0);
