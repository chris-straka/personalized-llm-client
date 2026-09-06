import './style.css';
import { state } from './state';
import { getAI, generateResponse } from './api';
import { $apiKey, $changeKey, $model, $prompt, $preview, appendMessage, updatePromptLayout } from './dom';
import { setupKeyboard } from './keyboard';
import { setupMouse } from './mouse';
import type { Part, GoogleGenAI } from '@google/genai';

$apiKey.value = localStorage.getItem('gemini_api_key') || '';
if ($apiKey.value) {
  $apiKey.style.display = 'none';
  $changeKey.style.display = 'inline-block';
}

$apiKey.addEventListener('change', () => {
  localStorage.setItem('gemini_api_key', $apiKey.value);
  if ($apiKey.value) {
    $apiKey.style.display = 'none';
    $changeKey.style.display = 'inline-block';
  }
});

$changeKey.addEventListener('click', () => {
  localStorage.removeItem('gemini_api_key');
  $apiKey.value = '';
  $apiKey.style.display = 'inline-block';
  $changeKey.style.display = 'none';
  $apiKey.focus();
});

setupKeyboard(sendMessage);
setupMouse();
updatePromptLayout();

export async function sendMessage() {
  const text = $prompt.value.trim();
  if (!text && state.pendingFiles.length === 0) return;
  if (!$apiKey.value) return alert('API Key required');

  const ai = getAI($apiKey.value);

  let parts: Part[] = [];
  
  // Extract URLs typed inside the prompt and format them as URL context parts
  const urlRegex = /(https?:\/\/[^\s]+)/gi;
  const urls = text.match(urlRegex) || [];
  urls.forEach(url => {
    parts.push({ text: `URL Context: ${url}` });
  });

  parts = parts.concat(state.pendingFiles);
  if (text) parts.push({ text });

  state.chatHistory.push({ role: 'user', parts });
  appendMessage('user', text + (state.pendingFiles.length ? ` [${state.pendingFiles.length} attachments]` : ''));

  $prompt.value = '';
  $preview.innerHTML = '';
  state.pendingFiles = [];
  updatePromptLayout();

  await handleAIResponse(ai, $model.value);
}

async function handleAIResponse(ai: GoogleGenAI, model: string) {
  try {
    const res = await generateResponse(ai, model);
    
    state.totalTokens += res.usageMetadata?.candidatesTokenCount || 0;
    const responseText = res.text || '';
    state.chatHistory.push({ role: 'model', parts: [{ text: responseText }] });
    appendMessage('model', responseText, state.totalTokens);
  } catch (err: any) {
    appendMessage('error', err.message);
    state.chatHistory.pop();
    updatePromptLayout();
  }
}