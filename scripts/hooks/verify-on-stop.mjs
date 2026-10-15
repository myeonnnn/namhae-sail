// Stop 훅: 응답을 끝내기 전에 typecheck와 테스트를 통과해야 한다. 실패하면 종료를 막고 실패 내용을 모델에게 전달한다.
// 작업 트리가 마지막으로 통과한 상태와 같으면 다시 돌리지 않는다. 코드를 고치지 않은 응답은 기다리지 않고 끝난다.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { decideStopVerification, failureReason } from './lib.mjs';
import { projectDir, readHookInput } from './stdin.mjs';

const root = projectDir();
const STATE_FILE = join(root, '.claude/state/verify-on-stop.json');
const CHECKS = [
  ['pnpm', ['typecheck']],
  ['pnpm', ['test']],
];

const run = (command, args) => spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

/** 커밋되지 않은 변경 전체(추적하지 않는 파일의 내용 포함)의 지문. 무시하는 파일(.gitignore)은 포함하지 않는다. */
function fingerprint() {
  const hash = createHash('sha1');
  hash.update(run('git', ['rev-parse', 'HEAD']).stdout);
  hash.update(run('git', ['diff', 'HEAD', '--binary']).stdout);
  const untracked = run('git', ['ls-files', '--others', '--exclude-standard', '-z']).stdout.split('\0').filter(Boolean);
  for (const file of untracked.sort()) {
    hash.update(file);
    try {
      hash.update(readFileSync(join(root, file)));
    } catch {
      // 읽는 사이에 지워진 파일은 이름만 반영한다.
    }
  }
  return hash.digest('hex');
}

function readState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { lastVerified: null, lastFailed: null };
  }
}

function writeState(state) {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2) + '\n');
}

const input = await readHookInput();
const state = readState();
const current = fingerprint();
const decision = decideStopVerification({
  stopHookActive: input?.stop_hook_active === true,
  fingerprint: current,
  lastVerified: state.lastVerified,
  lastFailed: state.lastFailed,
});

if (decision === 'verify') {
  for (const [command, args] of CHECKS) {
    const result = run(command, args);
    if (result.status !== 0) {
      writeState({ ...state, lastFailed: current });
      const reason = failureReason(`${command} ${args.join(' ')}`, `${result.stdout}\n${result.stderr}`);
      // decision: block은 응답의 종료를 막고, reason을 모델에게 전달한다.
      process.stdout.write(JSON.stringify({ decision: 'block', reason }));
      process.exit(0);
    }
  }
  writeState({ lastVerified: current, lastFailed: null });
}
