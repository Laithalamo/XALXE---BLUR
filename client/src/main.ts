import './ui/styles.css';
import { Game } from './game/Game';

const loading = document.getElementById('loading')!;
const fill = loading.querySelector('.fill') as HTMLElement;
const status = loading.querySelector('.status') as HTMLElement;

async function boot() {
  const game = new Game(document.getElementById('game') as HTMLCanvasElement, document.getElementById('hud')!);
  await game.init((p, label) => {
    fill.style.width = `${Math.round(p * 100)}%`;
    status.textContent = label;
  });
  loading.classList.add('done');
  game.start();
}

boot().catch((err) => {
  console.error(err);
  status.textContent = 'Error: ' + (err?.message ?? err);
  (window as unknown as { __shotError: string }).__shotError = String(err?.stack ?? err);
});
