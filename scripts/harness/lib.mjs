// 테스트 하네스를 검증하는 스크립트(verify.mjs)의 판정 로직. 파일과 프로세스를 다루지 않는 순수 함수만 둔다.

/**
 * 파일 이름이 정하는 테스트의 분류.
 * `*.browser.test.*`는 browser, `*.integration.test.*`는 integration, 나머지 `*.test.*`는 unit이다.
 * @param {string} file
 * @returns {'unit' | 'integration' | 'browser'}
 */
export function expectedProject(file) {
  // 폴더 이름에 browser가 들어 있어도 영향을 받지 않도록, 파일 이름만 본다.
  const name = file.split('/').pop() ?? file;
  if (/\.browser\.test\.[^.]+$/.test(name)) return 'browser';
  if (/\.integration\.test\.[^.]+$/.test(name)) return 'integration';
  return 'unit';
}

/**
 * 테스트 파일이 vitest의 묶음에 올바르게 들어갔는지 확인한다.
 * @param {string[]} allFiles 저장소에 있는 모든 테스트 파일
 * @param {Record<string, string[]>} assigned 묶음 이름마다 vitest가 실제로 잡은 파일
 * @returns {{
 *   unassigned: string[],
 *   duplicated: { file: string, projects: string[] }[],
 *   misplaced: { file: string, expected: string, actual: string }[],
 * }} 어느 묶음에도 없는 파일, 둘 이상의 묶음에 있는 파일, 한 묶음에만 있지만 이름이 정하는 분류와 다른 파일.
 *    각 목록은 파일 이름 순으로 정렬한다.
 */
export function findClassificationProblems(allFiles, assigned) {
  const projectsOf = new Map(allFiles.map((file) => [file, []]));
  for (const [project, files] of Object.entries(assigned)) {
    for (const file of new Set(files)) projectsOf.get(file)?.push(project);
  }
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const unassigned = [];
  const duplicated = [];
  const misplaced = [];
  for (const [file, projects] of projectsOf) {
    if (projects.length === 0) unassigned.push(file);
    else if (projects.length > 1) duplicated.push({ file, projects });
    else if (projects[0] !== expectedProject(file)) {
      misplaced.push({ file, expected: expectedProject(file), actual: projects[0] });
    }
  }
  unassigned.sort(byName);
  duplicated.sort((a, b) => byName(a.file, b.file));
  misplaced.sort((a, b) => byName(a.file, b.file));
  return { unassigned, duplicated, misplaced };
}

/**
 * 분류별 시간 한도를 넘은 테스트 파일을 찾는다. 분류는 expectedProject로 정한다.
 * @param {{ file: string, durationMs: number }[]} results 파일마다 걸린 시간
 * @param {Record<string, number>} budgets 분류 이름마다 한도 (ms). 한도와 같으면 넘지 않은 것이다.
 * @returns {{ file: string, project: string, durationMs: number, budgetMs: number }[]} 오래 걸린 순
 */
export function findSlowFiles(results, budgets) {
  return results
    .map(({ file, durationMs }) => {
      const project = expectedProject(file);
      return { file, project, durationMs, budgetMs: budgets[project] };
    })
    .filter(({ durationMs, budgetMs }) => durationMs > budgetMs)
    .sort((a, b) => b.durationMs - a.durationMs);
}

/**
 * 같은 테스트를 여러 번 실행한 결과에서, 실행마다 결과가 달랐던 테스트를 찾는다.
 * 어떤 실행에서 아예 빠진 테스트도 결과가 달랐던 것으로 본다.
 * @param {Record<string, 'passed' | 'failed' | 'skipped'>[]} runs 실행마다 테스트의 식별자 → 결과
 * @returns {string[]} 식별자 순으로 정렬
 */
export function findFlakyTests(runs) {
  const ids = new Set(runs.flatMap((run) => Object.keys(run)));
  const flaky = [...ids].filter((id) => {
    const first = runs[0][id];
    // 빠진 실행이 있으면 undefined가 섞이므로, 결과가 달랐던 것으로 잡힌다.
    return runs.some((run) => run[id] !== first);
  });
  return flaky.sort();
}

/** 오류를 주입할 자리를 찾지 못했거나, 자리가 하나로 정해지지 않을 때 던진다. */
export class FaultNotApplicableError extends Error {}

/**
 * 소스 코드에 오류 하나를 주입한다. find는 소스에 정확히 한 번 나와야 한다.
 * 없거나 여러 번 나오면 주입하지 않고 FaultNotApplicableError를 던진다.
 * 코드가 바뀌어서 주입할 자리가 사라졌을 때, 오류가 들어가지 않은 채로 "테스트가 통과했다"고 판정하지 않기 위해서이다.
 * @param {string} source
 * @param {{ find: string, replace: string }} fault
 * @returns {string} 오류를 주입한 소스
 */
export function applyFault(source, fault) {
  const { find, replace } = fault;
  const first = find.length > 0 ? source.indexOf(find) : -1;
  if (first < 0) throw new FaultNotApplicableError(`주입할 자리를 찾지 못했다: ${JSON.stringify(find)}`);
  // 겹쳐서 나오는 경우도 두 번으로 센다. 자리가 하나로 정해지지 않으면 어느 쪽에 주입할지 알 수 없다.
  if (source.indexOf(find, first + 1) >= 0) {
    throw new FaultNotApplicableError(`주입할 자리가 여러 곳이다: ${JSON.stringify(find)}`);
  }
  // String.replace는 $&, $1 같은 특수 패턴을 해석하므로 쓰지 않고, 잘라서 잇는다.
  return source.slice(0, first) + replace + source.slice(first + find.length);
}
