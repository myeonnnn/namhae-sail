import { DIFFICULTY_LABELS, type Course } from '../course/course';
import { createButton } from './dom';

/**
 * 타임어택 메뉴에 넣는 타임어택의 코스 목록. 코스를 누르면 그 코스에 도전하고, 아래의 버튼으로 그만둔다.
 */
export function createCourseList(
  courses: Course[],
  actions: { start(course: Course): void; quit(): void },
): HTMLElement {
  const list = document.createElement('div');
  list.className = 'hud-start-points';
  for (const course of courses) {
    const name = document.createElement('strong');
    const { difficulty } = course;
    const badge = document.createElement('em');
    badge.className = 'hud-difficulty';
    badge.dataset.difficulty = difficulty;
    badge.textContent = DIFFICULTY_LABELS[difficulty];
    name.append(badge, course.name);
    const note = document.createElement('span');
    note.textContent = `${(course.length / 1000).toFixed(1)} km · 관문 ${course.gates.length - 1}개 · 파도 ${course.seaLevel}단계`;
    list.append(createButton({ content: [name, note], onClick: () => actions.start(course) }));
  }
  list.append(createButton({ content: '그만두고 자유 항해로', className: 'hud-course-quit', onClick: actions.quit }));
  return list;
}
