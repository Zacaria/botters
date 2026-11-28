import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createBottersTools } from '../tools.js'

test('preview tools return planning and readable refusal', async () => {
  const state={session:{agentToken:'agent'},roundsSeen:null}
  const match={id:'m1',phase:'pause',round:1,of:5,secondsLeft:60,slots:{you:3},score:{you:0,house:0},bot:{breed:'tank',gambits:[{if:'always',then:'hold'}]},rounds:[]}
  const fetchImpl=async (url,opts={}) => url.endsWith('/live-config.json') ? Response.json({rounds:true}) : opts.method==='POST' ? Response.json({error:'Refused: invalid bot'}, {status:400}) : Response.json({available:true,match})
  const server=await createBottersTools({server:'http://localhost',state,fetchImpl})
  const wait=await server._registeredTools.wait_for_pause.handler({})
  const result=JSON.parse(wait.content[0].text)
  assert.equal(result.round,1); assert.equal(result.yourSlots,3); assert.equal(result.yourBot.breed,'tank')
  assert.deepEqual(state.roundsSeen,{id:'m1',round:1})
  const refused=await server._registeredTools.set_bot.handler({round:1,gambits:[],why:'test'})
  assert.equal(refused.isError,true); assert.match(refused.content[0].text,/Refused/)
  match.phase='over'; match.result='Draw'
  const end=JSON.parse((await server._registeredTools.wait_for_pause.handler({})).content[0].text)
  assert.equal(end.matchOver,true); assert.equal(end.result,'draw')
})
