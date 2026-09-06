import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { highlighter } from './shiki';

document.getElementById('app')!.innerHTML = `
  <div id="settings">
    <input type="password" id="api-key" placeholder="Gemini API Key" />
    <button id="change-key" style="display: none;">Change Key</button>
    <select id="model-select">
      <option value="gemini-3.5-flash">3.5 Flash</option>
      <option value="gemini-3.1-pro">3.1 Pro</option>
    </select>
    <div class="level-indicator">Thinking: <span id="think-level" style="text-transform: capitalize;">low</span></div>
    <button id="clear-all">Clear All Chats</button>
  </div>
  <div id="chat-history"></div>
  <div id="floating-input">
    <div id="attachment-preview"></div>
    <div class="input-row">
      <input type="file" id="file-upload" multiple />
    </div>
    <textarea id="prompt" placeholder="Type here"></textarea>
  </div>
`;

export const $apiKey = document.getElementById('api-key') as HTMLInputElement;
export const $changeKey = document.getElementById('change-key') as HTMLButtonElement;
export const $model = document.getElementById('model-select') as HTMLSelectElement;
export const $prompt = document.getElementById('prompt') as HTMLTextAreaElement;
export const $chat = document.getElementById('chat-history') as HTMLDivElement;
export const $file = document.getElementById('file-upload') as HTMLInputElement;
export const $preview = document.getElementById('attachment-preview') as HTMLDivElement;
export const $thinkLvl = document.getElementById('think-level') as HTMLSpanElement;
export const $clearAll = document.getElementById('clear-all') as HTMLButtonElement;

export function updatePromptLayout() {
  const hasMessages = document.querySelectorAll('#chat-history .message').length > 0;
  document.getElementById('app')?.classList.toggle('initial-center', !hasMessages);
}

export function appendMessage(role: string, text: string, tokens?: number) {
  const div = document.createElement('div');
  div.className = `message ${role}`;
  div.setAttribute('data-raw', encodeURIComponent(text));

  const parsed = marked.parse(text) as string;
  const contentDiv = document.createElement('div');
  contentDiv.className = 'content';
  contentDiv.innerHTML = DOMPurify.sanitize(parsed);
  div.appendChild(contentDiv);

  if (role === 'model') {
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    actions.innerHTML = `
      <button class="action-btn copy-md-btn">Copy MD</button>
      <button class="action-btn copy-txt-btn">Copy Text</button>
      <button class="action-btn branch-btn">Branch from here</button>
      ${tokens ? `<span class="token-badge">Accrued Tokens: ${tokens}</span>` : ''}
    `;
    div.appendChild(actions);
  }

  // Handle code blocks
  div.querySelectorAll('pre code').forEach((block) => {
    const code = block.textContent || '';
    const langMatch = Array.from(block.classList).find(c => c.startsWith('language-'));
    const lang = langMatch ? langMatch.replace('language-', '') : 'javascript';

    const wrapper = document.createElement('div');
    wrapper.className = 'code-block-wrapper';
    wrapper.innerHTML = `
      <div class="code-header">
        <span class="code-lang">${lang}</span>
        <div class="code-actions">
          <button class="action-btn copy-code-btn">Copy</button>
          <button class="action-btn fold-btn">Fold</button>
        </div>
      </div>
    `;

    try {
      const html = highlighter.codeToHtml(code, {
        lang: highlighter.getLoadedLanguages().includes(lang) ? lang : 'javascript',
        theme: 'github-dark'
      });
      const temp = document.createElement('div');
      temp.innerHTML = html;
      wrapper.appendChild(temp.firstElementChild!);
      block.parentElement!.replaceWith(wrapper);
    } catch (e) {
      block.parentElement!.replaceWith(wrapper);
      wrapper.appendChild(block.parentElement!);
    }
  });

  $chat.appendChild(div);
  $chat.scrollTo(0, $chat.scrollHeight);
}