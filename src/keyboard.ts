import { state, THINKING_LEVELS } from './state';
import { $prompt, $apiKey, $model, $thinkLvl } from './dom';

export function setupKeyboard(onSend: () => Promise<void>) {
  document.addEventListener('keydown', (e) => {
    if (e.target !== $prompt && e.target !== $apiKey) {
      if (e.key === 'ArrowRight') $model.selectedIndex = Math.min($model.options.length - 1, $model.selectedIndex + 1);
      if (e.key === 'ArrowLeft') $model.selectedIndex = Math.max(0, $model.selectedIndex - 1);
      if (e.key === 'ArrowUp') {
        state.thinkingIndex = Math.min(THINKING_LEVELS.length - 1, state.thinkingIndex + 1);
        $thinkLvl.textContent = THINKING_LEVELS[state.thinkingIndex].toLowerCase();
      }
      if (e.key === 'ArrowDown') {
        state.thinkingIndex = Math.max(0, state.thinkingIndex - 1);
        $thinkLvl.textContent = THINKING_LEVELS[state.thinkingIndex].toLowerCase();
      }
    }
  });

  $prompt.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      await onSend();
    } else if (e.key === 'Enter' && (e.metaKey || e.altKey || e.ctrlKey)) {
      e.preventDefault();
      await onSend();
    }
  });
}