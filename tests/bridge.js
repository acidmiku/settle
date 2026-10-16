export function installTestBridge({platform = 'windows', namespace = 'test.db', seed}) {
    const data = JSON.parse(localStorage.getItem(namespace) || 'null') || seed || { settings:{design:'scratch'}, notes:[] };
    data.folders ??= [];
    window.testState = { data, calls:[], clipboard:'', fail:null, delay:0 };
    const persist = () => localStorage.setItem(namespace, JSON.stringify(data));
    window.__TAURI__ = {
      core: { async invoke(command,args = {}) {
        window.testState.calls.push({command,args});
        if (window.testState.delay && ['create_note','copy_to_clipboard'].includes(command)) await new Promise(r => setTimeout(r,window.testState.delay));
        if (window.testState.fail === command) throw new Error('Simulated failure');
        if (command === 'create_note' && args.content === window.testState.failContent) throw new Error('Simulated tab save failure');
        switch(command) {
          case 'get_settings': return data.settings;
          case 'get_runtime_info': return {platform,version:'0.2.2'};
          case 'get_start_with_os': return data.startWithOs === true;
          case 'set_start_with_os': data.startWithOs = args.enabled; persist(); return data.startWithOs;
          case 'check_for_update': return window.testState.update || null;
          case 'install_update': {
            window.testState.installedWorkspace = data.settings.workspace;
            window.testState['settle:update-progress']?.({payload:{phase:'downloading',downloaded:50,total:100}});
            await new Promise(r => setTimeout(r,200));
            window.testState['settle:update-progress']?.({payload:{phase:'installing'}});
            return;
          }
          case 'get_db_info': return { path:'/local/settle.sqlite3', size_bytes:12345 };
          case 'set_setting': data.settings[args.key] = args.value; persist(); return;
          case 'create_note': {
            const note = {id:crypto.randomUUID(),content:args.content,title:args.title || null,folder_id:args.folderId || null,created_at:new Date().toISOString(),local_date:'2026-10-15',local_time:'14:22:00',tags:[]};
            data.notes.push(note); persist(); return note;
          }
          case 'update_note': data.notes.find(n => n.id === args.noteId).content = args.content; persist(); return;
          case 'delete_note': data.notes = data.notes.filter(n => n.id !== args.noteId); persist(); return;
          case 'list_dates': return data.notes.length ? [{local_date:'2026-10-15',note_count:data.notes.length}] : [];
          case 'list_notes_for_date': return data.notes.filter(n => n.local_date === args.localDate);
          case 'list_notes': return data.notes.filter(n => (!args.folderId || n.folder_id === args.folderId) && (!args.unfiled || !n.folder_id)).sort((a,b) => `${b.local_date} ${b.local_time} ${b.created_at || ''} ${b.id}`.localeCompare(`${a.local_date} ${a.local_time} ${a.created_at || ''} ${a.id}`)).slice(args.offset, args.offset + args.limit);
          case 'rename_note': data.notes.find(n => n.id === args.noteId).title = args.title; persist(); return;
          case 'move_note': data.notes.find(n => n.id === args.noteId).folder_id = args.folderId; persist(); return;
          case 'list_folders': return data.folders.map(f => ({...f,note_count:data.notes.filter(n => n.folder_id === f.id).length})).sort((a,b) => a.name.localeCompare(b.name));
          case 'create_folder': {
            const folder = {id:crypto.randomUUID(),name:args.name}; data.folders.push(folder); persist(); return folder;
          }
          case 'rename_folder': data.folders.find(f => f.id === args.folderId).name = args.name; persist(); return;
          case 'delete_folder': data.folders = data.folders.filter(f => f.id !== args.folderId); data.notes.filter(n => n.folder_id === args.folderId).forEach(n => n.folder_id = null); persist(); return;
          case 'search': return data.notes.filter(n => `${n.title || ''} ${n.content}`.toLowerCase().includes(args.query.toLowerCase())).map(n => ({...n,snippet:n.content}));
          case 'copy_to_clipboard': window.testState.clipboard = args.text; return;
          case 'open_preview_link': window.testState.openedUrl = args.url; return;
          case 'hide_main_window': window.testState.hidden = true; return;
          case 'export_json': case 'export_markdown': return {files_written:1, export_dir:'/local/exports/test'};
          default: throw new Error(`Unexpected command ${command}`);
        }
      } },
      event: { async listen(name,handler) { window.testState[name] = handler; return () => { delete window.testState[name]; }; } },
    };

}
