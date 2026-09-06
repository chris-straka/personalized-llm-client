# Ccez Studio

My own version of a macOS desktop chatbot app tailored to how I want things to work. 

This repo is from a previous attempt I made back when AI wasn't that good.

The only thing that I know/remember from this repo is this README.md and the new imgs folder with the imgs I added.

I primarily borrow inspiration from the chatGPT desktop app and the google AI studio web UI.

Less clutter, better defaults, no agentic stuff.

BYOK - I have two keys that I want to use (Deepseek v4 pro and meta's muse spark 1.3 contributor).

I mostly intend to use this for language learning and general questions

I have a ~big 28" 4k screen 144hz. I own an Android phone (S24), a mac m4 mini and an m1 pro macbook.

## Things I want...

I'm not sure if these things come in either chatGPT or google AI studio

- The system prompt to default to "be brief, no summaries"
- Keyboard commands to switch between thinking levels (not too easy to hit, I rarely expect to change this, I usually use high).
- Keyboard commands to switch models or AI keys (not too easy to hit either, I rarely expect to change this)
- Option left-click on a msg should delete it (I frequently delete chats and msgs)
- Folding code snippets with color syntax and that have a button I can click to copy it to my clipboard 
- Code snippets should also recognize the programming language in that code block
- I should be able to easily fold previous messages (just like I can for code) so I can continue focusing on something that was said previously
- When I copy and paste something that is greater than 100 chars, I want it to replace what I pasted with a blurb that says "[Pasted content X chars]", and same thing if I paste an image "[Pasted an image]".
- When I give it an img, it'd be cool if it could compress it so I don't send anything with too many tokens
- When I type Chinese, I want it to detect if it's in Chinese and then enable a keyboard command shortcut (popups on a corner reminding me in faint text) to enable pinyin for the Chinese characters and have them show up above the hanzi. And even when the pinyin for all the characters is is off, if it could show the pinyin when I hover a word and hit right click. 
- I want the same thing for Japanese but for hiragana, it should detect, and the same keyboard shortcut should enable furigana and pinyin.
- Same thing for Arabic, where it adds Tashkeel or Harakat to characters when I do that shortcut so I can read it. 
- If it had vim keybindings so that it was trapped in the prompt box so I could use vim on my own text. And then I could hit a keyboard shortcut to hop out of the prompt box so I could hit J/K and stuff to scroll up and down the previous msgs that I've made.

Things that I want that are common in both.

- The ability to add attachments (images and files).
- Prompt box at the bottom.
- Cool desktop icon.

## Things I do/don't want from AI studio (web browser)

I do want this from AI studio...

- Something like "URL Context" and "Grounding with Google Search" to be the defaults.
- Total acrued token marker for the current chat.
- "option + enter" should take whatever is in my prompt box and append it to the top .
- "command + enter" should run what is in my prompt model and everything I pinned (same as AI studio).
- "branch from here" functionality.
- "copy as markdown" and "copy as text".
- The ability to delete chats quickly and all chats quickly (I almost never keep any chat, I freq delete).
- Token estimation for files and images I add.
- The ability to rerun a prompt.
- Error handling.
- When the chat gets long, different waypoints I can click on to jump up to previous msgs .

I don't want this from AI studio...

- Betwen my my msg and a response, AI studio leaves a giant "Thinking" bubble where I can view it's thoughts. I don't want this to clutter up my msgs by default, maybe some faint text that says thoughts that I can click on and expand. I'm thinking ctrl + o can hide or reveal the thoughts maybe. The point is, AI studio dedicates a MASSIVE portion to the AI thoughts and I don't want that.
- I don't want a dedicated "Sources" section at the bottom unless I ask for it.
- "Google Search Suggestions" citations in a response.
- Any app build features or agentic stuff.

## Things I do/don't want from the ChatGPT MacOS desktop app

I do want this from ChatGPT Desktop App...

- This is the most amazing feature that I love so much about chatGPT's desktop app. I will call it the "Annotation" feature. It is the ability to highlight text and ask a specific comment on exactly what I have selected and have that wrapped into my next main query. I have attached pictures in /imgs, and I want it to work exactly like that if not better. 

- I really like the voice chat feature in the desktop app. I rarely speak to chatGPT in the voice chat. Instead, I type and then it talks back to me and I see it's text read back to me. I like using the deepseek v4 pro and 1.3 spark contributor because the tokens are super cheap for me. I am not familiar with voice models or if there are similar keys that are just as cheap. I don't think I care if it gives me text and then I turn the text into voice data after and have that read back to me. But it would be nice if it the words in its response appeared to me as it was talking and wasn't dumped all at once. I am a language learner, so I need the pronunciations for different languages to be accurate and good. I also want the ability to highlight something similar to the annotation feature and then have it read what I have highlighted when I ask it to (it shouldn't read everything I highlight by default, only when I ask). Being able to easily download the audio for its response or to skip halfway through it without having to start from the beginning would be really nice too. I don't like talking to it directly, I want it to talk to me primarily. I want the design to look really clean here, it should tell me when I'm in voice chat mode, and the buttons and icons should have smooth bevels and stuff.

- When I hit command T a browser pops up and I can even use the annotate feature for things I find in the browser. This is probably really hard to do and it's not crucial, I mostly just use it to look up translations from google translate for singular words or sometimes sentences. I then ask the AI about the result I got back from google translate often and why Google translates it that way.

- I should be able to switch between multiple different chats

I don't want this from ChatGPT Desktop App...

- I don't want a name or a title for each of my conversations with chatGPT. 
- I don't want any cloud storage or cloud sync thing with my chats.
- I don't want to share my conversations with friends. 
- I don't want plugins

## Maybe later

It would be cool if I could host this on my cloudflare domain later but I want to focus primarily on desktop.

If I could have a mobile app for this too it'd be cool too. I would especially like the annotation

If there was some way where it could update to a newer version of the pro model (say 4.0) and the flash model (say 4.0), that would be cool.

## Other

If you have any good ideas for anything else I might like, please give them to me

## Added while planning (Sep 2026)

- Fenced-code input: typing ```lang + Enter inside the prompt box should open an
  inline code editor box within the prompt (auto-closing the fence for me), with the
  language label plus Collapse and Copy buttons. A Run button would be nice later
  but is not required. See `imgs/beforehittingshiftenter.png` and
  `imgs/Afterhittingshiftenter.png`.
- Reading aids (pinyin / furigana / tashkeel) are OFF by default; enabled only via
  the shortcut or hover+right-click.
- A small settings page for key entry, per-key model choice, and defaults.
- Day-one tooling: unit tests, lint/format, and browser-driven UI checks.
