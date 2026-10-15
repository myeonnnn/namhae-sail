// PostToolUse 훅: 고친 파일의 서식을 이 저장소의 prettier와 .prettierrc.json으로 맞춘다.
// 서식은 작업을 막지 않으므로, 문법 오류 등으로 실패해도 파일을 그대로 두고 종료 코드 0으로 끝낸다.
import { readFileSync, writeFileSync } from 'node:fs';
import * as prettier from 'prettier';
import { formatTarget } from './lib.mjs';
import { projectDir, readHookInput } from './stdin.mjs';

// 프로젝트 폴더가 아니라 이 스크립트가 있는 저장소의 설정을 쓴다. 고친 파일이 어디에 있든 같은 규칙으로 맞추기 위해서이다.
const CONFIG = JSON.parse(readFileSync(new URL('../../.prettierrc.json', import.meta.url), 'utf8'));

const input = await readHookInput();
const file = input && formatTarget(input, projectDir());
if (file) {
  try {
    const source = readFileSync(file, 'utf8');
    const formatted = await prettier.format(source, { ...CONFIG, filepath: file });
    if (formatted !== source) writeFileSync(file, formatted);
  } catch (error) {
    console.error(`서식을 맞추지 못했다 (${file}): ${error.message}`);
  }
}
