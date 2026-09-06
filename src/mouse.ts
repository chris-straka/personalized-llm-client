import { state } from './state';
import { getAI, countFileTokens } from './api';
import { $apiKey, $model, $file, $preview, $clearAll, $chat, updatePromptLayout } from './dom';
import type { Part } from '@google/genai';

export function setupMouse() {
  $file.addEventListener('change', async (e) => {
    const files = (e.target as HTMLInputElement).files;
    if (!files || !$apiKey.value) return;
    const ai = getAI($apiKey.value);

    for (const file of Array.from(files)) {
      const reader = new FileReader();
      reader.onload = async (re) => {
        const base64 = (re.target?.result as string).split(',')[1];
        const part: Part = { inlineData: { data: base64, mimeType: file.type } };
        state.pendingFiles.push(part);
        updatePromptLayout();

        try {
          const { totalTokens } = await countFileTokens(ai, $model.value, part);
          $preview.innerHTML += `<div class="file-tag">${file.name} (~${totalTokens} tokens)</div>`;
        } catch {
          $preview.innerHTML += `<div class="file-tag">${file.name}</div>`;
        }
      };
      reader.readAsDataURL(file);
    }
  });

  $clearAll.addEventListener('click', () => {
    state.chatHistory = [];
    $chat.innerHTML = '';
    state.totalTokens = 0;
    updatePromptLayout();
  });

  $chat.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const msgEl = target.closest('.message');
    if (!msgEl) return;

    const index = Array.from($chat.children).indexOf(msgEl as Element);

    if (e.altKey && !target.closest('.action-btn')) {
      if (index > -1) state.chatHistory.splice(index, 1);
      msgEl.remove();
      updatePromptLayout();
      return;
    }

    if (target.classList.contains('branch-btn')) {
      state.chatHistory = state.chatHistory.slice(0, index + 1);
      while ($chat.children.length > index + 1) $chat.lastElementChild?.remove();
    }
    if (target.classList.contains('copy-md-btn')) navigator.clipboard.writeText(decodeURIComponent(msgEl.getAttribute('data-raw') || ''));
    if (target.classList.contains('copy-txt-btn')) navigator.clipboard.writeText(msgEl.querySelector('.content')?.textContent || '');

    if (target.classList.contains('fold-btn')) {
      target.closest('.code-block-wrapper')?.querySelector('pre')?.classList.toggle('folded');
    }
    if (target.classList.contains('copy-code-btn')) {
      navigator.clipboard.writeText(target.closest('.code-block-wrapper')?.querySelector('code')?.textContent || '');
      target.textContent = 'Copied!';
      setTimeout(() => target.textContent = 'Copy', 2000);
    }
  });
}