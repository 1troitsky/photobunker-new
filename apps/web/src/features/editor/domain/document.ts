/** Ephemeral image edit document. Persistence/history across editor sessions is deliberately absent (ST-07 OPEN). */
export type Point=Readonly<{x:number;y:number}>
export type Stroke=Readonly<{id:string;tool:'brush'|'pencil'|'eraser';points:Point[];
  width:number;color:string;opacity:number}>
export type Shape=Readonly<{id:string;kind:'rectangle'|'ellipse'|'line'|'redact';
  from:Point;to:Point;color:string;width:number;filled:boolean}>
export type TextLayer=Readonly<{id:string;text:string;at:Point;color:string;size:number}>
export type EditDocument=Readonly<{v:1;brightness:number;contrast:number;saturation:number;
  strokes:Stroke[];shapes:Shape[];texts:TextLayer[]}>
export type Tool='brush'|'pencil'|'eraser'|'text'|'rectangle'|'ellipse'|'line'|'redact'
const point=(p:Point)=>Number.isFinite(p.x)&&Number.isFinite(p.y)&&p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1
export const emptyEdit=():EditDocument=>({v:1,brightness:100,contrast:100,saturation:100,
  strokes:[],shapes:[],texts:[]})
function check(doc:EditDocument):void{
 if(doc.v!==1||doc.strokes.length>250||doc.shapes.length>100||doc.texts.length>40||
  ![doc.brightness,doc.contrast,doc.saturation].every(x=>Number.isFinite(x)&&x>=0&&x<=200))
  throw Error('editor.invalid_document')
 for(const s of doc.strokes)
  if(s.points.length<1||s.points.length>3000||!s.points.every(point)||
    !['brush','pencil','eraser'].includes(s.tool)||s.width<.001||s.width>.12||
    s.opacity<0||s.opacity>1||!/^#[0-9a-fA-F]{6}$/.test(s.color))
    throw Error('editor.invalid_stroke')
 for(const s of doc.shapes)
  if(!point(s.from)||!point(s.to)||!['rectangle','ellipse','line','redact'].includes(s.kind)||
    s.width<.001||s.width>.12||!/^#[0-9a-fA-F]{6}$/.test(s.color))
    throw Error('editor.invalid_shape')
 for(const t of doc.texts)
  if(!point(t.at)||t.text.length>300||t.size<.01||t.size>.18||
    !/^#[0-9a-fA-F]{6}$/.test(t.color))
    throw Error('editor.invalid_text')
}
const copy=(doc:EditDocument)=>structuredClone(doc)
export class EditSession{
 private history:EditDocument[]=[emptyEdit()]
 private cursor=0
 private revision=0
 get current(){return copy(this.history[this.cursor]!)}
 get dirty(){return JSON.stringify(this.current)!==JSON.stringify(emptyEdit())}
 get canUndo(){return this.cursor>0}
 get canRedo(){return this.cursor<this.history.length-1}
 get version(){return this.revision}
 change(transform:(value:EditDocument)=>EditDocument):void{
  const next=transform(this.current);check(next)
  if(JSON.stringify(next)===JSON.stringify(this.current))return
  this.history=this.history.slice(0,this.cursor+1)
  this.history.push(copy(next))
  if(this.history.length>41)this.history.shift()
  this.cursor=this.history.length-1;this.revision++
 }
 undo(){if(this.canUndo){this.cursor--;this.revision++}}
 redo(){if(this.canRedo){this.cursor++;this.revision++}}
 reset(){this.history=[emptyEdit()];this.cursor=0;this.revision++}
}
export function normalizedPoint(x:number,y:number,width:number,height:number):Point{
 if(width<=0||height<=0||!Number.isFinite(width)||!Number.isFinite(height))throw Error('editor.no_surface')
 return{x:Math.min(1,Math.max(0,x/width)),y:Math.min(1,Math.max(0,y/height))}
}
export function updateText(doc:EditDocument,id:string,text:string):EditDocument{
 return{...doc,texts:doc.texts.map(t=>t.id===id?{...t,text:text.slice(0,300)}:t)}
}
