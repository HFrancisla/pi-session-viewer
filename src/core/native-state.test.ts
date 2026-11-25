import { diffPersistedState, diffPersistedStateLines } from "./native-diff"
import { expect, it } from 'vitest'
import { parseSessionJsonl } from './session-parser'
import { buildSessionView } from './session-view'

it('按分支历史位置重放原生分区、工具及压缩检查点，不制造缺失事件', () => {
  const tool = { name: 'read', description: 'old', parameters: {}, constrainedSampling: true }
  const rows = [
    {type:'session',id:'session'},
    {type:'message',id:'u',parentId:null,message:{role:'user',content:'hello'}},
    {type:'message',id:'s',parentId:'u',message:{role:'system',timestamp:1,content:'base',sections:{custom:'exact'},toolsAdded:[tool]}},
    {type:'message',id:'a',parentId:'s',message:{role:'assistant',content:[{type:'toolCall',id:'call',name:'read',arguments:{}}]}},
    {type:'message',id:'d',parentId:'a',message:{role:'system',timestamp:2,content:'',sections:{custom:null,next:'new'},toolsRemoved:[{name:'read'}]}},
    {type:'message',id:'r',parentId:'d',message:{role:'toolResult',toolCallId:'call',toolName:'read',content:'ok'}},
    {type:'compaction',id:'c',parentId:'r',summary:'compact'},
    {type:'message',id:'empty',parentId:'c',message:{role:'system',timestamp:3,content:''}},
    {type:'message',id:'sibling',parentId:'s',message:{role:'system',timestamp:4,content:'',sections:{custom:'sibling'}}},
  ]
  const parsed = parseSessionJsonl(rows.map(r=>JSON.stringify(r)).join('\n'))
  const view = buildSessionView(parsed,'empty')
  const at = (id:string) => view.events.find(e=>e.entryId===id)!
  expect(at('u').persistedState).toBeUndefined()
  expect(at('s').persistedState?.message.sections).toEqual({custom:'exact'})
  expect(at('a').toolDefinition).toEqual(tool)
  expect(at('r').toolDefinition).toEqual(tool)
  expect(at('d').persistedState?.message.sections).toEqual({next:'new'})
  expect(at('d').persistedState?.previous?.message.sections).toEqual({custom:'exact'})
  expect(at('c').persistedState).toBeUndefined()
  expect(at('empty').persistedState?.message.content).toBe('')
  expect(at('empty').persistedState?.previous?.entryId).toBe('d')
  expect(view.events.filter(e=>e.kind==='system-prompt').map(e=>e.entryId)).toEqual(['s','d','c','empty'])
  expect(buildSessionView(parsed,'sibling').events.at(-1)?.persistedState?.message.sections).toEqual({custom:'sibling'})
})

it('仅在关联的 Assistant 及其声明区间使用补充来源，拒绝跨分支和失败关联', () => {
  const tool = { name: 'read', description: 'one', parameters: {} }
  const source = { path: '/extension/one.ts', source: 'local' }
  const message = (id:string, parentId:string|null, message:object) => ({type:'message',id,parentId,message})
  const assistant = (id:string,parentId:string,stopReason='toolUse') => message(id,parentId,{role:'assistant',stopReason,content:[{type:'toolCall',name:'read',id:'call-'+id,arguments:{}}]})
  const obs = (id:string,parentId:string,anchorEntryId:string,assistantEntryId:string,sourceInfo:unknown) => ({
    type:'custom',customType:'pi-session-viewer.observation',id,parentId,
    data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId,assistantEntryId,toolSources:[{name:'read',sourceInfo}]},
  })
  const rows = [
    {type:'session',id:'session'},
    message('s',null,{role:'system',timestamp:1,content:'',toolsAdded:[tool]}),
    assistant('a','s'),
    message('u','a',{role:'user',content:'next'}),
    assistant('b','u'),
    obs('o','b','u','b',source),
    assistant('c','o'),
    message('d','c',{role:'system',timestamp:2,content:'',toolsAdded:[{...tool,description:'two'}]}),
    assistant('e','d'),
    assistant('bad','e','aborted'),
    obs('bad-o','bad','e','bad',source),
    assistant('f','bad-o'),
    obs('cross','f','o','f',source),
    {type:'compaction',id:'checkpoint',parentId:'cross',summary:'summary',systemMessage:{role:'system',timestamp:3,content:'',sections:{checkpoint:'kept'},toolsAdded:[tool]}},
    assistant('g','checkpoint'),
    assistant('sibling','a'),
  ]
  const parsed = parseSessionJsonl(rows.map(r=>JSON.stringify(r)).join('\n'))
  const view = buildSessionView(parsed,'g')
  const call = (id:string) => view.events.find(e=>e.entryId===id && e.kind==='tool-call')
  expect(call('a')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(view.events.find(e=>e.entryId==='s' && e.kind==='tool-definitions')?.toolDefinitions?.[0].sourceInfo).toBeUndefined()
  expect(call('b')?.toolDefinition?.sourceInfo).toEqual(source)
  expect(call('c')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('e')?.toolDefinition).toEqual({...tool,description:'two'})
  expect(call('bad')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('f')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('g')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('g')?.persistedState?.message.sections).toEqual({checkpoint:'kept'})
  expect(view.events.some(e=>['o','bad-o','cross'].includes(e.entryId))).toBe(false)
  expect(buildSessionView(parsed,'sibling').events.find(e=>e.entryId==='sibling')?.toolDefinition?.sourceInfo).toBeUndefined()
})

it('差异以同分支前一已知状态为基线，包含删除、替换与新增', () => {
  const first = { name:'read', description:'one', parameters:{} }
  const second = { name:'read', description:'two', parameters:{}, constrainedSampling:true }
  const deleted = { name:'write', description:'write', parameters:{} }
  const entries = [
    {type:'session',id:'session'},
    {type:'message',id:'a',parentId:null,message:{role:'system',timestamp:1,content:'',sections:{old:'remove',same:'before'},toolsAdded:[first,deleted]}},
    {type:'message',id:'b',parentId:'a',message:{role:'system',timestamp:2,content:'',sections:{old:null,same:'after',new:'add'},toolsRemoved:[deleted],toolsAdded:[second]}},
  ]
  const view = buildSessionView(parseSessionJsonl(entries.map(e=>JSON.stringify(e)).join('\n')))
  expect(diffPersistedState(view.events[0].persistedState!)).toBeUndefined()
  expect(diffPersistedState(view.events.find(event => event.entryId === 'b' && event.kind === 'system-prompt')!.persistedState!)).toEqual(expect.arrayContaining([
    {kind:'section',name:'old',before:'remove',after:undefined},
    {kind:'section',name:'same',before:'before',after:'after'},
    {kind:'section',name:'new',before:undefined,after:'add'},
    {kind:'tool',name:'read',before:first,after:second},
    {kind:'tool',name:'write',before:deleted,after:undefined},
  ]))
})

it('仅在原生工具声明变更或压缩检查点产生工具定义行，原始记录和历史来源不被改写', () => {
  const read = { name: 'read', description: 'one', parameters: {}, constrainedSampling: true }
  const rows = [
    {type:'session',id:'session'},
    {type:'message',id:'s',parentId:null,message:{role:'system',timestamp:1,content:'',toolsAdded:[read]}},
    {type:'message',id:'p',parentId:'s',message:{role:'system',timestamp:2,content:'',sections:{note:'x'}}},
    {type:'message',id:'a',parentId:'p',message:{role:'assistant',content:[{type:'toolCall',id:'call',name:'read',arguments:{}}]}},
    {type:'custom',id:'o',parentId:'a',customType:'pi-session-viewer.observation',data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId:'p',assistantEntryId:'a',toolSources:[{name:'read',sourceInfo:{path:'builtin:read'}}]}},
    {type:'message',id:'d',parentId:'o',message:{role:'system',timestamp:3,content:'',toolsRemoved:[{name:'read'}]}},
    {type:'compaction',id:'c',parentId:'d',summary:'summary',systemMessage:{role:'system',timestamp:4,content:'',toolsAdded:[read]}},
  ]
  const parsed = parseSessionJsonl(rows.map(e=>JSON.stringify(e)).join('\n'))
  const view = buildSessionView(parsed)
  const tools = view.events.filter(event=>event.kind==='tool-definitions')
  expect(tools.map(event=>event.entryId)).toEqual(['s','d','c'])
  expect(tools[0].raw).toBe(parsed.entries.find(entry=>entry.id==='s')?.raw)
  expect(tools[0].toolDefinitions?.[0].sourceInfo).toEqual({path:'builtin:read'})
  expect(tools[0].toolDefinitions?.[0].constrainedSampling).toBe(true)
  expect(tools[1].toolDefinitions).toEqual([])
  expect(tools[2].toolDefinitions?.[0].sourceInfo).toBeUndefined()
  expect(view.events.find(event=>event.entryId==='a')?.toolDefinitionsEntryId).toBe('s')
  expect(view.events.find(event=>event.kind==='tool-call')?.toolDefinition?.sourceInfo).toEqual({path:'builtin:read'})
})

it('逐行差异保留未变行、真实分区名称和工具变更', () => {
  const rows: unknown[] = [
    {type:'session',id:'session'},
    {type:'message',id:'s',parentId:null,message:{role:'system',timestamp:1,content:'',sections:{rules:'same\nbefore'},toolsAdded:[{name:'read',description:'old',parameters:{}}]}},
    {type:'message',id:'d',parentId:'s',message:{role:'system',timestamp:2,content:'',sections:{rules:'same\nafter',constructor:'custom'},toolsAdded:[{name:'read',description:'new',parameters:{}}]}},
  ]
  const view = buildSessionView(parseSessionJsonl(rows.map(e=>JSON.stringify(e)).join('\n')))
  const state = view.events.find(event=>event.entryId==='d' && event.kind==='system-prompt')!.persistedState!
  const diff = diffPersistedStateLines(state)!
  expect(diff.lines).toEqual(expect.arrayContaining([
    expect.objectContaining({type:'unchanged',text:'same'}),
    expect.objectContaining({type:'removed',text:'before'}),
    expect.objectContaining({type:'added',text:'after'}),
    expect.objectContaining({type:'added',text:'[Section: constructor]'}),
    expect.objectContaining({type:'removed',text:'  "description": "old",'}),
    expect.objectContaining({type:'added',text:'  "description": "new",'}),
  ]))
  expect(diff.lines.some(line=>line.text.includes('function Object'))).toBe(false)
})

it('工具定义使用同分支首次关联请求的来源，不反向改写历史调用或跨越声明边界', () => {
  const tool = (name: string) => ({name, description: name, parameters: {}})
  const builtin = {path: 'builtin:read', source: 'builtin'}
  const extension = {path: '/extensions/custom/read.ts', source: 'local'}
  const write = {path: '/extensions/custom/write.ts', source: 'local'}
  const later = {path: '/extensions/later/read.ts', source: 'local'}
  const msg = (id:string, parentId:string|null, message:object) => ({type:'message',id,parentId,message})
  const system = (id:string, parentId:string|null, added:object[], removed:object[] = []) =>
    msg(id,parentId,{role:'system',timestamp:1,content:'',toolsAdded:added,toolsRemoved:removed})
  const assistant = (id:string,parentId:string,name='read',stopReason='toolUse') =>
    msg(id,parentId,{role:'assistant',stopReason,content:[{type:'toolCall',name,id:'call-'+id,arguments:{}}]})
  const obs = (id:string,parentId:string,anchorEntryId:string,assistantEntryId:string,toolSources:object[]) =>
    ({type:'custom',customType:'pi-session-viewer.observation',id,parentId,
      data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId,assistantEntryId,toolSources}})
  const source = (name:string,sourceInfo:unknown) => ({name,sourceInfo})
  const rows = [
    {type:'session',id:'session'},
    system('s',null,[tool('read'),tool('write')]),
    msg('u','s',{role:'user',content:'hello'}),
    {type:'custom',id:'meta',parentId:'u',customType:'duration',data:1},
    assistant('a','meta'),
    obs('o','a','u','a',[source('read',builtin),source('write',write)]),
    assistant('a2','o'),
    obs('o2','a2','o','a2',[source('read',later)]),
    system('d','o2',[tool('read')]), // 同 schema 重声明也必须切断旧来源
    system('e','d',[tool('read')]), // d 尚未参与任何请求即被替换
    assistant('b','e'),
    obs('o3','b','e','b',[source('read',extension)]),
    system('remove','o3',[],[{name:'read'}]),
    system('readd','remove',[tool('read')]),
    assistant('c','readd'),
    {type:'compaction',id:'cp',parentId:'c',summary:'summary',systemMessage:{role:'system',timestamp:2,content:'',toolsAdded:[tool('read'),tool('write')]}},
    assistant('cp-a','cp'),
    obs('cp-o','cp-a','cp','cp-a',[source('read',later),source('write',write)]),
    {type:'compaction',id:'no-cp',parentId:'cp-o',summary:'summary'},
    system('after-cp','no-cp',[tool('read')]),
    assistant('last','after-cp'),
    // 兄弟分支使用不同来源，不能污染主分支。
    assistant('sib','u'),
    obs('sib-o','sib','u','sib',[source('read',extension)]),
  ]
  const parsed = parseSessionJsonl(rows.map(r=>JSON.stringify(r)).join('\n'))
  const view = buildSessionView(parsed,'last')
  const definition = (id:string,name:string) => view.events.find(e=>e.entryId===id && e.kind==='tool-definitions')?.toolDefinitions?.find(t=>t.name===name)?.sourceInfo
  const call = (id:string) => view.events.find(e=>e.entryId===id && e.kind==='tool-call')?.toolDefinition?.sourceInfo
  expect(definition('s','read')).toEqual(builtin)
  expect(definition('s','write')).toEqual(write)
  expect(call('a')).toEqual(builtin)
  expect(call('a2')).toEqual(later)
  expect(definition('d','read')).toBeUndefined()
  expect(definition('d','write')).toEqual(write)
  expect(definition('e','read')).toEqual(extension)
  expect(call('b')).toEqual(extension)
  expect(definition('remove','read')).toBeUndefined()
  expect(definition('readd','read')).toBeUndefined()
  expect(call('c')).toBeUndefined()
  expect(definition('cp','read')).toEqual(later)
  expect(definition('cp','write')).toEqual(write)
  expect(definition('after-cp','read')).toBeUndefined()
  expect(call('last')).toBeUndefined()
  const sibling = buildSessionView(parsed,'sib-o').events.find(e=>e.entryId==='s' && e.kind==='tool-definitions')
  expect(sibling?.toolDefinitions?.find(t=>t.name==='read')?.sourceInfo).toEqual(extension)
  expect(sibling?.toolDefinitions?.find(t=>t.name==='write')?.sourceInfo).toBeUndefined()
  const beforeObservation = buildSessionView(parsed,'a').events.find(e=>e.entryId==='s' && e.kind==='tool-definitions')
  expect(beforeObservation?.toolDefinitions?.every(t=>t.sourceInfo === undefined)).toBe(true)
})

it('首次请求失败、缺少观测或观测关联不明确时，不给工具定义补写来源', () => {
  const tool = {name:'read',description:'read',parameters:{}}
  const message = (id:string,parentId:string|null,message:object) => ({type:'message',id,parentId,message})
  const assistant = (id:string,parentId:string,stopReason='stop') => message(id,parentId,{role:'assistant',stopReason,content:[]})
  const obs = (id:string,parentId:string,anchorEntryId:string,assistantEntryId:string,toolSources:object[] = [{name:'read',sourceInfo:{path:'builtin:read'}}]) =>
    ({type:'custom',customType:'pi-session-viewer.observation',id,parentId,
      data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId,assistantEntryId,toolSources}})
  const base = [
    {type:'session',id:'session'},
    message('s',null,{role:'system',timestamp:1,content:'',toolsAdded:[tool]}),
    message('u','s',{role:'user',content:'hello'}),
  ]
  const cases = [
    [assistant('a','u','error'),obs('o','a','u','a')],
    [assistant('a','u','aborted'),obs('o','a','u','a')],
    [assistant('a','u'),assistant('b','a'),obs('o','b','a','b')],
    [assistant('a','u'),obs('o','a','u','a'),obs('o2','o','u','a')],
    [assistant('a','u'),obs('o','a','missing','a')],
    [assistant('a','u'),obs('o','a','u','a',[{name:'read',sourceInfo:{path:'builtin:read'}},{name:'read',sourceInfo:{path:'/extension/read.ts'}}])],
  ]
  for (const rows of cases) {
    const view = buildSessionView(parseSessionJsonl([...base,...rows].map(r=>JSON.stringify(r)).join('\n')))
    const definition = view.events.find(e=>e.kind==='tool-definitions')
    expect(definition?.toolDefinitions?.[0].sourceInfo).toBeUndefined()
  }
})

it('来源明确撤销时，下一声明使用未知来源且既往调用与定义保持原值', () => {
  const tool = (name:string) => ({name,description:name,parameters:{}})
  const original = {path:'builtin:read',source:'builtin'}
  const rows = [
    {type:'session',id:'session'},
    {type:'message',id:'s',parentId:null,message:{role:'system',timestamp:1,content:'',toolsAdded:[tool('read')]}},
    {type:'message',id:'a',parentId:'s',message:{role:'assistant',content:[{type:'toolCall',id:'call-a',name:'read',arguments:{}}]}},
    {type:'custom',id:'o',parentId:'a',customType:'pi-session-viewer.observation',data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId:'s',assistantEntryId:'a',toolSources:[{name:'read',sourceInfo:original}]}},
    {type:'message',id:'d',parentId:'o',message:{role:'system',timestamp:2,content:'',toolsAdded:[tool('write')]}},
    {type:'message',id:'b',parentId:'d',message:{role:'assistant',content:[{type:'toolCall',id:'call-b',name:'read',arguments:{}}]}},
    {type:'custom',id:'o2',parentId:'b',customType:'pi-session-viewer.observation',data:{schemaVersion:1,piVersion:'1.6.0',anchorEntryId:'d',assistantEntryId:'b',toolSources:[{name:'read',sourceInfo:null}]}},
    {type:'message',id:'r',parentId:'o2',message:{role:'toolResult',toolCallId:'call-a',toolName:'read',content:'ok'}},
  ]
  const view = buildSessionView(parseSessionJsonl(rows.map(r=>JSON.stringify(r)).join('\n')))
  const definition = (id:string) => view.events.find(e=>e.entryId===id && e.kind==='tool-definitions')?.toolDefinitions?.find(t=>t.name==='read')?.sourceInfo
  const call = (id:string) => view.events.find(e=>e.entryId===id && e.kind==='tool-call')?.toolDefinition?.sourceInfo
  expect(definition('s')).toEqual(original)
  expect(call('a')).toEqual(original)
  expect(definition('d')).toBeUndefined()
  expect(call('b')).toBeUndefined()
  expect(view.events.find(e=>e.entryId==='r')?.toolDefinition?.sourceInfo).toEqual(original)
})
