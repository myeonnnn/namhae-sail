export class Input {
  private readonly keys = new Set<string>();
  private readonly pressed = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (event) => {
      if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
      // 키를 누르고 있으면 keydown이 반복해서 발생하므로, 처음 눌린 순간만 따로 기록한다.
      if (!event.repeat) this.pressed.add(event.code);
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  /** 지난번에 확인한 뒤로 키가 새로 눌렸으면 true를 반환하고 기록을 지운다. 켜고 끄는 동작에 사용한다. */
  consumePress(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** negative 키가 눌리면 -1, positive 키가 눌리면 +1, 둘 다이거나 둘 다 아니면 0 */
  axis(negative: string[], positive: string[]): number {
    return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
  }
}
