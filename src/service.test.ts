import { describe, expect, it, vi } from 'vitest';
import { fixture } from './test/chrome';
import { registerBackground } from './service';
import { isTrustedPage, validateMessage } from './messages';
import { exportBackup, parseBackup, normalizeSettings, ROOT_URL } from './model';

describe('extension messaging boundary', () => {
  it('accepts only the extension manager, including popup and query URLs', () => {
    const {api}=fixture();
    expect(isTrustedPage({id:'test',url:'chrome-extension://test/index.html?popup=1'},api.runtime)).toBe(true);
    for(const url of ['https://test/index.html','chrome-extension://test/index.html.evil','chrome-extension://other/index.html']) expect(isTrustedPage({id:'test',url},api.runtime)).toBe(false);
  });
  it('accepts the Firefox manager origin without equating its UUID to the Gecko add-on ID', () => {
    const runtime = { id: 'qiqian@augists', getURL: (path: string) => `moz-extension://browser-uuid/${path}` };
    expect(isTrustedPage({id:runtime.id,url:'moz-extension://browser-uuid/index.html#settings'},runtime)).toBe(true);
    expect(isTrustedPage({id:runtime.id,url:'moz-extension://other-uuid/index.html'},runtime)).toBe(false);
  });
  it('rejects malformed or overbroad mutations before invoking Chrome', async () => {
    const {api}=fixture(), worker=registerBackground(api);
    for(const m of [null, {},{type:'archive',scope:'bogus'},{type:'move',from:'a',to:'b',ids:'all'},{type:'patch',id:'a',patch:{items:{}}},{type:'settings',settings:{includePinned:'yes'}}]) await expect(worker.dispatch(m)).rejects.toThrow();
    expect(api.tabs.remove).not.toHaveBeenCalled();expect(api.bookmarks.create).not.toHaveBeenCalled();
  });
  it('handles the actual callback listener and keeps the response channel open', async () => {
    const {api}=fixture();const worker=registerBackground(api); const respond=vi.fn();
    expect(api.runtime.onMessage.emit({type:'create',title:'通过消息创建'},{id:'test',url:'chrome-extension://test/index.html'},respond)).toEqual([true]);
    await worker.idle(); expect(respond).toHaveBeenCalledWith({ok:true,data:expect.any(String)});
  });
  it('ignores messages from ordinary pages', async()=>{
    const {api}=fixture();const worker=registerBackground(api); const respond=vi.fn();
    api.runtime.onMessage.emit({type:'archive',scope:'all'},{id:'test',url:'https://example.com'},respond); await worker.idle();expect(respond).not.toHaveBeenCalled();expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it('recovers the write queue after a failed request and serializes root creation',async()=>{
    const {api,repo}=fixture(); const worker=registerBackground(api);
    const results=await Promise.allSettled([worker.dispatch({type:'bad'}),worker.dispatch({type:'create',title:'A'}),worker.dispatch({type:'create',title:'B'})]);
    expect(results.map(r=>r.status)).toEqual(['rejected','fulfilled','fulfilled']);expect(await repo.roots()).toHaveLength(1);expect((await repo.snapshot()).groups.map(g=>g.title)).toEqual(['B','A']);
  });
  it('preserves explicit task clearing through Chrome JSON serialization',async()=>{
    const {api,repo}=fixture(); const worker=registerBackground(api); const id=await repo.create('Tasks',[{title:'A',url:'https://a.test/'}]);
    await worker.dispatch({type:'item',id,url:'https://a.test/',patch:{task:'done'}});
    await worker.dispatch(JSON.parse(JSON.stringify({type:'item',id,url:'https://a.test/',patch:{task:null}})));
    expect((await repo.group(id)).items[0].task).toBeNull();
    expect(()=>validateMessage({type:'item',id,url:'https://a.test/',patch:{task:'invalid'}})).toThrow();
  });
  it('restores into the sending page window even if focus changes',async()=>{
    const {api,repo}=fixture();const worker=registerBackground(api);const id=await repo.create('G',[{title:'A',url:'https://a.test/'}]);
    await worker.dispatch({type:'restore',id,windowId:8},{tab:{windowId:7} as chrome.tabs.Tab});expect(api.tabs.create).toHaveBeenCalledWith(expect.objectContaining({windowId:7,active:true}));
  });
  it('creates context menus and applies saved popup settings on install',async()=>{
    const {api,storage}=fixture();storage.settings={popup:true};const worker=registerBackground(api);api.runtime.onInstalled.emit();await worker.idle();
    expect(api.contextMenus.removeAll).toHaveBeenCalled();expect(api.contextMenus.create).toHaveBeenCalledTimes(8);expect(api.action.setPopup).toHaveBeenCalledWith({popup:'index.html?popup=1'});
  });
  it('restores the saved popup preference on browser startup',async()=>{
    const {api,storage}=fixture();storage.settings={popup:true};const worker=registerBackground(api);
    api.runtime.onStartup.emit();await worker.idle();
    expect(api.action.setPopup).toHaveBeenCalledWith({popup:'index.html?popup=1'});
  });
  it('unknown keyboard commands never archive tabs',async()=>{
    const {api}=fixture();const worker=registerBackground(api);api.commands.onCommand.emit('unknown');await worker.idle();expect(api.tabs.remove).not.toHaveBeenCalled();
  });
  it('only permanently deletes unlocked trash without nested folders',async()=>{
    const {api,repo}=fixture();const worker=registerBackground(api);const id=await repo.create('G',[]);
    await expect(worker.dispatch({type:'purge',id})).rejects.toThrow();await repo.trash(id);await worker.dispatch({type:'purge',id});await expect(repo.group(id)).rejects.toThrow();
  });
});
describe('bookmarks portability and ordering',()=>{
  it('finds renamed roots using the portable marker',async()=>{
    const {api,repo}=fixture();const id=await repo.create('G',[]);const root=(await repo.group(id)).rootId;await api.bookmarks.update(root,{title:'My renamed archive'});
    expect((await repo.snapshot()).groups[0].id).toBe(id);expect((await api.bookmarks.getChildren(root)).some((n:any)=>n.url===ROOT_URL)).toBe(true);
  });
  it('moves down and up within a group using Chromium index semantics',async()=>{
    const {repo}=fixture();const id=await repo.create('G',['A','B','C','D'].map(title=>({title,url:`https://${title.toLowerCase()}.test/`})));
    const g=await repo.group(id);await repo.move(id,id,[g.items[0].id],undefined,g.items[2].id);expect((await repo.group(id)).items.map(t=>t.title)).toEqual(['B','A','C','D']);
    await repo.move(id,id,[g.items[3].id],undefined,g.items[1].id);expect((await repo.group(id)).items.map(t=>t.title)).toEqual(['D','B','A','C']);
  });
  it('moves multiple items without reversing their order',async()=>{
    const {repo}=fixture();const id=await repo.create('G',['A','B','C','D'].map(title=>({title,url:`https://${title.toLowerCase()}.test/`})));
    const g=await repo.group(id);await repo.move(id,id,[g.items[0].id,g.items[1].id],undefined,g.items[3].id);expect((await repo.group(id)).items.map(t=>t.title)).toEqual(['C','A','B','D']);
  });
  it('round trips full backup including metadata, empty groups and trash',async()=>{
    const {repo}=fixture();await repo.create('Note only',[],{note:'笔记',locked:true});await repo.create('Trash',[{title:'A',url:'https://a.test/'}],{trashed:true,items:{'https://a.test/':{starred:true,task:'todo',quick:true}}});
    const originals=(await repo.snapshot()).groups;const encoded=exportBackup(originals);expect(parseBackup(encoded)).toHaveLength(2);await repo.importBackup(encoded);
    const groups=(await repo.snapshot()).groups;expect(groups).toHaveLength(4);expect(new Set(groups.map(g=>g.meta.uuid)).size).toBe(4);expect(groups.filter(g=>g.meta.trashed).every(g=>g.items[0].quick)).toBe(true);
  });
  it('validates an entire JSON backup before any write',async()=>{
    const {api,repo}=fixture();const id=await repo.create('G',[{title:'A',url:'https://a.test/'}]);const data=JSON.parse(exportBackup([await repo.group(id)]));data.groups.push({...data.groups[0],items:[{title:'bad',url:'javascript:alert(1)'}]});api.bookmarks.create.mockClear();await expect(repo.importBackup(JSON.stringify(data))).rejects.toThrow();expect(api.bookmarks.create).not.toHaveBeenCalled();
  });
  it('rejects forged metadata links from normal text import',async()=>{
    const {repo}=fixture();await expect(repo.importText(ROOT_URL)).rejects.toThrow();
  });
  it('locks malformed metadata rather than silently dropping lock protection',async()=>{
    const {api,repo}=fixture();const id=await repo.create('G',[]);const meta=(await api.bookmarks.getChildren(id))[0];await api.bookmarks.update(meta.id,{url:meta.url+'broken'});expect((await repo.group(id)).meta.locked).toBe(true);await expect(repo.trash(id)).rejects.toThrow();
  });
  it('migrates legacy settings and ignores corrupted values',()=>{
    expect(normalizeSettings({design:'radix',theme:'unknown',excluded:55,popup:'yes'})).toMatchObject({theme:'light',excluded:'',popup:false});
  });
});
