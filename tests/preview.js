// Browser-only demo data. This bridge is never included in the desktop bundle.
import { installTestBridge } from '/test-bridge.js';

const date = daysAgo => {
  const value = new Date(); value.setDate(value.getDate() - daysAgo);
  return `${value.getFullYear()}-${String(value.getMonth()+1).padStart(2,'0')}-${String(value.getDate()).padStart(2,'0')}`;
};
const content = '# A calmer workspace\n\nA place for **unfinished thoughts**, useful snippets, and things worth keeping.\n\n## This week\n\n- [x] Make room for the editor\n- [x] Give every note a home\n- [ ] Leave a little space to think\n\n> Start anywhere. Make sense of it later.\n';
const notes = [
  {id:'welcome',title:'A calmer workspace',content,folder_id:'work',local_date:date(0),local_time:'14:32:00'},
  {id:'ideas',title:'Small ideas, saved',content:'A running list of things to try.\n\nA reading lamp by the window.\nA keyboard with quieter switches.\nA weekend with no notifications.',folder_id:'ideas',local_date:date(0),local_time:'11:08:00'},
  {id:'code',title:'A useful little function',content:'```js\nconst groupByDay = notes =>\n  Object.groupBy(notes, note => note.local_date);\n```',folder_id:'work',local_date:date(0),local_time:'09:20:00'},
  {id:'weekend',title:'Weekend list',content:'Coffee beans, fresh bread, a long walk.\n\nRemember to take the camera.',folder_id:'personal',local_date:date(1),local_time:'18:45:00'},
  {id:'reading',title:'Reading notes',content:'Good tools get out of the way.\n\nKeep the interface quiet and the work close.',folder_id:null,local_date:date(1),local_time:'12:14:00'},
  {id:'trip',title:'Somewhere by the water',content:'A small cabin. A stack of books.\n\nNo fixed itinerary.',folder_id:'personal',local_date:date(3),local_time:'16:05:00'},
].map(n => ({...n,created_at:`${n.local_date}T${n.local_time}Z`,tags:[]}));
const workspace = {version:3,updatedAt:1,activeId:'welcome-tab',buffers:[
  {id:'welcome-tab',noteId:'welcome',title:'A calmer workspace',folderId:'work',text:content,original:content,syntax:'markdown',wysiwyg:true},
  {id:'draft-tab',noteId:null,title:'Something to come back to',text:'An unfinished thought.\n\nKeep it here for later.',original:'',syntax:'plaintext'},
]};
installTestBridge({namespace:'settle.preview.library',seed:{settings:{design:'scratch',workspace:JSON.stringify(workspace)},notes,folders:[{id:'work',name:'Work'},{id:'personal',name:'Personal'},{id:'ideas',name:'Ideas'}]}});
// Isolate browser draft recovery from other development previews on this origin.
localStorage.removeItem('settle.workspace.v3'); localStorage.removeItem('settle.workspace.v2');
await import('/js/app.js');
function showLibrary() {
  if (document.documentElement.dataset.ready !== 'true') { requestAnimationFrame(showLibrary); return; }
  document.getElementById('btn-history').click();
}
showLibrary();
