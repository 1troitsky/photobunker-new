import {describe,expect,it} from 'vitest'
import {EditSession,emptyEdit,normalizedPoint,updateText} from './document'
describe('R2-11 ephemeral edit document',()=>{
 it('undoes and redoes a single stroke without mutating previous snapshots',()=>{
  const session=new EditSession(),first=session.current
  session.change(doc=>({...doc,strokes:[...doc.strokes,{id:'s',tool:'brush',width:.01,
    color:'#cc2222',opacity:1,points:[{x:0,y:0},{x:1,y:1}]}]}))
  expect(session.dirty).toBe(true)
  expect(first.strokes).toHaveLength(0)
  expect(session.current.strokes).toHaveLength(1)
  session.undo()
  expect(session.current).toEqual(emptyEdit())
  session.redo()
  expect(session.current.strokes).toHaveLength(1)
  session.reset()
  expect(session.dirty).toBe(false)
  expect(session.current.strokes).toHaveLength(0)
 })
 it('limits in-session undo history and does not create persistent versions',()=>{
  const session=new EditSession()
  for(let i=0;i<90;i++)session.change(doc=>({...doc,brightness:i}))
  let count=0
  while(session.canUndo){session.undo();count++}
  expect(count).toBeLessThanOrEqual(40)
 })
 it('rejects unbounded paths, oversized text and dangerous color values',()=>{
  const session=new EditSession()
  expect(()=>session.change(doc=>({...doc,strokes:[{id:'bad',tool:'brush',
    width:.01,color:'url(javascript:evil)',opacity:1,points:[{x:0,y:0}]}]}))).toThrow('editor.invalid_stroke')
  expect(()=>session.change(doc=>({...doc,texts:[{id:'text',text:'x'.repeat(301),
    at:{x:.5,y:.5},size:.04,color:'#ffffff'}]}))).toThrow('editor.invalid_text')
  expect(updateText({...emptyEdit(),texts:[{id:'t',text:'',at:{x:0,y:0},size:.1,color:'#ffffff'}]},
    't','x'.repeat(301)).texts[0]?.text.length).toBe(300)
 })
 it('normalizes touch coordinates and fails closed on missing surface dimensions',()=>{
  expect(normalizedPoint(-10,500,100,200)).toEqual({x:0,y:1})
  expect(normalizedPoint(50,100,100,200)).toEqual({x:.5,y:.5})
  expect(()=>normalizedPoint(0,0,0,200)).toThrow('editor.no_surface')
 })
})
