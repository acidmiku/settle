export const LANGUAGES = [
  ['plaintext','Plain text'], ['markdown','Markdown'], ['javascript','JavaScript'],
  ['typescript','TypeScript'], ['json','JSON'], ['xml','HTML / XML'], ['css','CSS'],
  ['python','Python'], ['rust','Rust'], ['powershell','PowerShell'], ['bash','Bash'],
  ['sql','SQL'], ['yaml','YAML'], ['ini','INI / TOML'], ['c','C'], ['cpp','C++'],
  ['csharp','C#'], ['java','Java'], ['kotlin','Kotlin'], ['swift','Swift'], ['go','Go'],
  ['ruby','Ruby'], ['php','PHP'], ['lua','Lua'], ['r','R'], ['perl','Perl'],
  ['scss','SCSS'], ['less','Less'], ['graphql','GraphQL'], ['diff','Diff'],
  ['makefile','Makefile'], ['objectivec','Objective-C'], ['wasm','WebAssembly'],
];
export const normalizeSyntax = value => value === 'auto' || LANGUAGES.some(([id]) => id === value) ? value : 'auto';
export const languageName = value => LANGUAGES.find(([id]) => id === value)?.[1] || 'Plain text';
