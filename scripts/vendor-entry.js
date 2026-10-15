import hljs from 'highlight.js/lib/common';
import powershell from 'highlight.js/lib/languages/powershell';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

hljs.registerLanguage('powershell', powershell);
export { hljs, marked, DOMPurify };
