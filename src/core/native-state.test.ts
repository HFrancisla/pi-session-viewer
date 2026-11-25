import { diffPersistedState } from "./native-diff"
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

it('仅在关联的 Assistant 及其声明区间使用补充来源，拒绝旧格式、跨分支和失败关联', () => {
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
    {type:'custom',customType:'pi-session-viewer.system-prompt',id:'old',parentId:'a',data:{prompt:'not native'}},
    assistant('b','old'),
    obs('o','b','old','b',source),
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
  expect(call('b')?.toolDefinition?.sourceInfo).toEqual(source)
  expect(call('c')?.toolDefinition?.sourceInfo).toEqual(source)
  expect(call('e')?.toolDefinition).toEqual({...tool,description:'two'})
  expect(call('bad')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('f')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('g')?.toolDefinition?.sourceInfo).toBeUndefined()
  expect(call('g')?.persistedState?.message.sections).toEqual({checkpoint:'kept'})
  expect(view.events.some(e=>['old','o','bad-o','cross'].includes(e.entryId))).toBe(false)
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
  expect(diffPersistedState(view.events[1].persistedState!)).toEqual(expect.arrayContaining([
    {kind:'section',name:'old',before:'remove',after:undefined},
    {kind:'section',name:'same',before:'before',after:'after'},
    {kind:'section',name:'new',before:undefined,after:'add'},
    {kind:'tool',name:'read',before:first,after:second},
    {kind:'tool',name:'write',before:deleted,after:undefined},
  ]))
})
