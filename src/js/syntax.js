import { hljs, marked, DOMPurify } from '../vendor/editor.js';
import { LANGUAGES } from './languages.js';
import { escapeHtml } from './utils.js';

const detectable = LANGUAGES.map(([id]) => id).filter(id => !['plaintext','markdown','ini','makefile'].includes(id));
export function detectSyntax(text) {
  const sample = text.slice(0,10000);
  if (!sample.trim()) return 'plaintext';
  // Prefer explicit document markers over statistical guesses on prose.
  if (/^\s*[\[{]/.test(sample)) {
    try { JSON.parse(text); return 'json'; } catch { /* It may be unfinished code. */ }
  }
  if (/^ {0,3}(?:#{1,6}\s+\S|```|~~~|>\s+\S|[-*+] \[[ xX]\])/m.test(sample)
    || /\[[^\]\n]+\]\([^)\n]+\)|\*\*[^*\n]+\*\*/.test(sample)
    || /^(?: {0,3}[-*+] |\d+\. ).+\n(?: {0,3}[-*+] |\d+\. )/m.test(sample)) return 'markdown';
  const result = hljs.highlightAuto(sample, detectable);
  return result.relevance >= 5 ? result.language || 'plaintext' : 'plaintext';
}
export function highlight(text, language) {
  if (language === 'plaintext' || !hljs.getLanguage(language)) return escapeHtml(text);
  try { return hljs.highlight(text, {language, ignoreIllegals:true}).value; }
  catch { return escapeHtml(text); }
}
export function renderMarkdown(text, target) {
  target.innerHTML = DOMPurify.sanitize(marked.parse(text, {gfm:true, async:false}), {
    ALLOWED_TAGS:['p','br','hr','h1','h2','h3','h4','h5','h6','strong','em','del','s','blockquote','pre','code','ul','ol','li','a','img','table','thead','tbody','tr','th','td','input','details','summary'],
    ALLOWED_ATTR:['href','title','alt','src','class','start','align','type','checked','disabled','open'],
    ALLOW_DATA_ATTR:false,
  });
  target.querySelectorAll('[class]').forEach(element => {
    const language = element.tagName === 'CODE' && [...element.classList].find(name => /^language-[\w-]+$/.test(name));
    if (language) element.className = language;
    else element.removeAttribute('class');
  });
  // Preview is a document, never a form or a navigation surface for local files.
  target.querySelectorAll('input').forEach(input => { input.type = 'checkbox'; input.disabled = true; });
  target.querySelectorAll('img').forEach(img => {
    if (!/^data:image\/(?:png|jpeg|gif|webp);base64,/i.test(img.getAttribute('src') || '')) {
      const alt = document.createElement('span');
      alt.className = 'preview-image'; alt.textContent = img.alt || 'Image';
      img.replaceWith(alt);
    }
  });
  target.querySelectorAll('a').forEach(link => {
    if (!/^(https?:|mailto:)/i.test(link.getAttribute('href') || '')) link.removeAttribute('href');
  });
  target.querySelectorAll('pre code').forEach(code => {
    const language = [...code.classList].find(c => c.startsWith('language-'))?.slice(9);
    if (language && hljs.getLanguage(language)) code.innerHTML = highlight(code.textContent, language);
  });
}
