// Claude Code 훅(.claude/settings.json)의 판정 로직. 표준 입력이나 파일, 프로세스를 다루지 않는 순수 함수만 둔다.
// 훅의 입력 형식: https://code.claude.com/docs/en/hooks
// 서브에이전트 안에서 호출된 도구이면 입력에 agent_id와 agent_type이 붙는다. 메인 에이전트이면 둘 다 없다.

import { basename, isAbsolute, relative } from 'node:path';

/** 테스트 파일만 고칠 수 있는 에이전트의 이름 (.claude/agents/test-writer.md) */
export const TEST_WRITER = 'test-writer';

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const FORMATTED = /\.(ts|mts|js|mjs|json|css)$/;
const TEST_FILE = /\.test\.[^.]+$/;
// 터미널 색상 코드 (ESC[...m)
const ANSI_COLOR = /\u001b\[[0-9;]*m/g;

/** 프로젝트 폴더 기준의 상대 경로. 폴더 바깥이면 null이다. 이름이 같은 글자로 시작하는 옆 폴더도 바깥으로 본다. */
function insideProject(file, projectDir) {
  const path = relative(projectDir, file);
  return path === '' || path.startsWith('..') || isAbsolute(path) ? null : path;
}

/** 파일을 고치는 도구이면 고친 파일의 경로를, 아니면 null을 돌려준다. */
function editedFile(input) {
  return EDIT_TOOLS.has(input.tool_name) ? (input.tool_input?.file_path ?? null) : null;
}

/**
 * 파일을 고친 뒤(PostToolUse) 서식을 맞출 파일을 정한다.
 * Edit, Write, MultiEdit로 고친 파일 가운데, 프로젝트 폴더 안에 있고 확장자가 .ts, .mts, .js, .mjs, .json, .css인 파일만 대상이다.
 * node_modules와 dist 아래의 파일, 프로젝트 폴더 바깥의 파일은 대상이 아니다.
 * @param {{ tool_name?: string, tool_input?: { file_path?: string } }} input 훅의 입력
 * @param {string} projectDir 프로젝트 폴더의 절대 경로
 * @returns {string | null} 서식을 맞출 파일의 절대 경로, 대상이 아니면 null
 */
export function formatTarget(input, projectDir) {
  const file = editedFile(input);
  if (!file || !FORMATTED.test(file)) return null;
  const path = insideProject(file, projectDir);
  if (path === null || path.split('/').some((part) => part === 'node_modules' || part === 'dist')) return null;
  return file;
}

/**
 * 파일을 고치기 전(PreToolUse)에, 테스트 파일을 고칠 자격이 있는지 판정한다.
 * 프로젝트 폴더 안의 테스트 파일(`*.test.*`)을 Edit, Write, MultiEdit로 고치거나 만들 수 있는 것은 test-writer 에이전트뿐이다.
 * 메인 에이전트와 다른 서브에이전트는 막는다. 테스트 파일이 아니거나 파일을 고치는 도구가 아니면 허용한다.
 * @param {{ tool_name?: string, tool_input?: { file_path?: string }, agent_type?: string }} input 훅의 입력
 * @param {string} projectDir 프로젝트 폴더의 절대 경로
 * @returns {{ allow: true } | { allow: false, reason: string }} 막을 때의 reason은 모델에게 전달되며, test-writer에게 맡기라는 안내를 포함한다.
 */
export function guardTestEdit(input, projectDir) {
  const file = editedFile(input);
  if (!file || !TEST_FILE.test(basename(file)) || insideProject(file, projectDir) === null) return { allow: true };
  if (input.agent_type === TEST_WRITER) return { allow: true };
  return {
    allow: false,
    reason:
      `테스트 파일(${basename(file)})은 ${TEST_WRITER} 에이전트만 고친다 (CLAUDE.md의 "기능을 만드는 순서"). ` +
      `테스트가 틀렸다고 판단되면 이유를 사용자에게 보고하고, 수정은 ${TEST_WRITER}에게 맡긴다.`,
  };
}

/**
 * 응답을 끝내려 할 때(Stop) 검사(typecheck와 테스트)를 돌릴지 정한다.
 * 작업 트리의 상태를 나타내는 지문이 마지막으로 검사를 통과한 지문과 같으면 이미 확인한 상태이므로 건너뛴다.
 * 이미 Stop 훅 때문에 응답을 이어 가는 중(stopHookActive)이어도 다시 검사한다. 모델이 고쳤는지 확인해야 하기 때문이다.
 * 다만 지문이 바뀌지 않았는데 stopHookActive이면, 모델이 아무것도 고치지 않은 것이므로 다시 막지 않고 건너뛴다.
 * @param {{ stopHookActive: boolean, fingerprint: string, lastVerified: string | null, lastFailed: string | null }} state
 *   lastVerified는 마지막으로 검사를 통과한 지문, lastFailed는 마지막으로 검사에 실패한 지문이다.
 * @returns {'skip' | 'verify'}
 */
export function decideStopVerification(state) {
  const { stopHookActive, fingerprint, lastVerified, lastFailed } = state;
  if (fingerprint === lastVerified) return 'skip';
  // Stop 훅에 막혀서 이어 가는 중인데 아무것도 고치지 않았으면, 같은 실패로 다시 막아 봐야 끝나지 않는다.
  if (stopHookActive && fingerprint === lastFailed) return 'skip';
  return 'verify';
}

/**
 * 실패한 검사의 출력에서 모델에게 전달할 이유를 만든다.
 * 실패한 명령의 이름을 앞에 쓰고, 출력은 끝부분을 남겨서 전체 길이가 maxLength를 넘지 않게 한다 (테스트 실패의 요약은 출력의 끝에 있다).
 * 출력에 섞인 터미널 색상 코드(ESC[...m)는 지운다.
 * @param {string} command 실패한 명령 (예: 'pnpm test')
 * @param {string} output 그 명령의 표준 출력과 표준 에러를 합친 것
 * @param {number} [maxLength=2000]
 * @returns {string}
 */
export function failureReason(command, output, maxLength = 2000) {
  const header = `${command} 실패:\n`;
  const clean = output.replace(ANSI_COLOR, '');
  const room = maxLength - header.length;
  // 테스트 실패의 요약은 출력의 끝에 있으므로, 길면 앞을 자르고 끝을 남긴다.
  return header + (clean.length <= room ? clean : '…' + clean.slice(clean.length - (room - 1)));
}

/**
 * 도구 호출 하나를 기록할 한 줄(JSON으로 저장할 객체)을 만든다. 나중에 "테스트를 먼저 썼는가" 같은 규칙의 준수를 확인하는 데 쓴다.
 * @param {{ hook_event_name?: string, tool_name?: string, tool_input?: { file_path?: string, command?: string },
 *   agent_id?: string, agent_type?: string }} input 훅의 입력
 * @param {string} projectDir 프로젝트 폴더의 절대 경로
 * @param {Date} time
 * @returns {{ time: string, event: string, tool: string | null, file: string | null, command: string | null,
 *   agent: string, agentId: string | null }}
 *   time은 ISO 형식, file은 프로젝트 폴더 기준의 상대 경로(바깥이면 절대 경로), command는 Bash의 명령(앞 200자),
 *   agent는 서브에이전트이면 agent_type, 메인 에이전트이면 'main'이다.
 */
export function logEntry(input, projectDir, time) {
  const file = input.tool_input?.file_path ?? null;
  return {
    time: time.toISOString(),
    event: input.hook_event_name ?? null,
    tool: input.tool_name ?? null,
    file: file === null ? null : (insideProject(file, projectDir) ?? file),
    command: input.tool_input?.command?.slice(0, 200) ?? null,
    agent: input.agent_type ?? 'main',
    agentId: input.agent_id ?? null,
  };
}
