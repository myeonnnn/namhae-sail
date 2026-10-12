export class Input {
  private readonly keys = new Set<string>();

  constructor() {
    window.addEventListener('keydown', (event) => {
      if (event.code.startsWith('Arrow') || event.code === 'Space') event.preventDefault();
      this.keys.add(event.code);
    });
    window.addEventListener('keyup', (event) => this.keys.delete(event.code));
    window.addEventListener('blur', () => this.keys.clear());
  }

  isDown(...codes: string[]): boolean {
    return codes.some((code) => this.keys.has(code));
  }

  /** negative 키가 눌리면 -1, positive 키가 눌리면 +1, 둘 다이거나 둘 다 아니면 0 */
  axis(negative: string[], positive: string[]): number {
    return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
  }
}
