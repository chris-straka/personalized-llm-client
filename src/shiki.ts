import { createHighlighter, createJavaScriptRegexEngine } from 'shiki';

export const highlighter = await createHighlighter({
  engine: createJavaScriptRegexEngine(),
  themes: ['github-dark'],
  langs: ['javascript', 'typescript', 'python', 'html', 'css', 'json', 'bash', 'shell', 'java', 'c', 'cpp', 'csharp', 'go', 'rust', 'php', 'ruby', 'swift', 'kotlin', 'dart', 'sql', 'xml', 'yaml', 'markdown', 'zig']
});
