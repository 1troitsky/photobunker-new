import type {EditDocument} from '../domain/document'
const MAX_PIXELS=36_000_000,MAX_EDGE=4096
function canvas(width:number,height:number):HTMLCanvasElement{
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0||
  width*height>MAX_PIXELS)throw Error('editor.image_dimensions')
 const c=document.createElement('canvas')
 c.width=Math.round(width);c.height=Math.round(height)
 return c
}
/** All text/shapes/strokes are flattened into a fresh canvas JPEG with no EXIF. */
export function renderEdits(image:CanvasImageSource,sourceWidth:number,sourceHeight:number,
  doc:EditDocument,maxEdge=MAX_EDGE):HTMLCanvasElement{
 if(!Number.isInteger(sourceWidth)||!Number.isInteger(sourceHeight)||sourceWidth<1||
  sourceHeight<1||sourceWidth*sourceHeight>MAX_PIXELS)throw Error('editor.image_dimensions')
 const ratio=Math.min(1,maxEdge/Math.max(sourceWidth,sourceHeight))
 const width=Math.max(1,Math.round(sourceWidth*ratio)),height=Math.max(1,Math.round(sourceHeight*ratio))
 const output=canvas(width,height),context=output.getContext('2d',{willReadFrequently:false})
 if(!context)throw Error('editor.canvas_unavailable')
 context.fillStyle='#000000';context.fillRect(0,0,width,height)
 context.filter=`brightness(${doc.brightness}%) contrast(${doc.contrast}%) saturate(${doc.saturation}%)`
 context.drawImage(image,0,0,width,height);context.filter='none'
 const overlay=canvas(width,height),ctx=overlay.getContext('2d')
 if(!ctx)throw Error('editor.canvas_unavailable')
 const size=Math.min(width,height)
 for(const stroke of doc.strokes){
  if(!stroke.points.length)continue
  ctx.save()
  ctx.globalCompositeOperation=stroke.tool==='eraser'?'destination-out':'source-over'
  ctx.lineCap='round';ctx.lineJoin='round'
  ctx.globalAlpha=stroke.opacity
  ctx.strokeStyle=stroke.color;ctx.fillStyle=stroke.color
  ctx.lineWidth=Math.max(1,stroke.width*size*(stroke.tool==='pencil'?.5:1))
  if(stroke.tool==='brush'){ctx.shadowColor=stroke.color;ctx.shadowBlur=stroke.width*size*.7}
  const first=stroke.points[0]!
  ctx.beginPath();ctx.moveTo(first.x*width,first.y*height)
  for(const p of stroke.points.slice(1))ctx.lineTo(p.x*width,p.y*height)
  if(stroke.points.length===1){
   ctx.arc(first.x*width,first.y*height,ctx.lineWidth/2,0,Math.PI*2);ctx.fill()
  }else ctx.stroke()
  ctx.restore()
 }
 for(const shape of doc.shapes){
  const x=Math.min(shape.from.x,shape.to.x)*width,y=Math.min(shape.from.y,shape.to.y)*height
  const w=Math.abs(shape.to.x-shape.from.x)*width,h=Math.abs(shape.to.y-shape.from.y)*height
  ctx.save();ctx.strokeStyle=shape.color;ctx.fillStyle=shape.kind==='redact'?'#000000':shape.color
  ctx.lineWidth=Math.max(1,shape.width*size)
  if(shape.kind==='line'){
   ctx.beginPath();ctx.moveTo(shape.from.x*width,shape.from.y*height)
   ctx.lineTo(shape.to.x*width,shape.to.y*height);ctx.stroke()
  }else{
   ctx.beginPath()
   if(shape.kind==='ellipse')ctx.ellipse(x+w/2,y+h/2,Math.max(.5,w/2),Math.max(.5,h/2),0,0,2*Math.PI)
   else ctx.rect(x,y,w,h)
   if(shape.kind==='redact'||shape.filled)ctx.fill()
   else ctx.stroke()
  }
  ctx.restore()
 }
 for(const layer of doc.texts){
  if(!layer.text.trim())continue
  const sizePx=Math.max(10,layer.size*width)
  ctx.save();ctx.font=`600 ${sizePx}px system-ui, sans-serif`;ctx.textBaseline='top'
  ctx.fillStyle=layer.color;ctx.strokeStyle='#000000c0'
  ctx.lineWidth=Math.max(1,sizePx*.055);ctx.lineJoin='round'
  const lines=layer.text.split('\n').slice(0,8)
  for(let i=0;i<lines.length;i++){
   const yy=layer.at.y*height+i*sizePx*1.25
   ctx.strokeText(lines[i]!,layer.at.x*width,yy,Math.max(1,width-layer.at.x*width))
   ctx.fillText(lines[i]!,layer.at.x*width,yy,Math.max(1,width-layer.at.x*width))
  }
  ctx.restore()
 }
 context.drawImage(overlay,0,0)
 overlay.width=overlay.height=0
 return output
}
export async function flattenJpeg(source:CanvasImageSource,width:number,height:number,
  doc:EditDocument):Promise<Blob>{
 const output=renderEdits(source,width,height,doc)
 try{
  return await new Promise<Blob>((resolve,reject)=>output.toBlob(b=>{
   if(!b||b.type!=='image/jpeg'||!b.size||b.size>64*1024*1024)
    reject(Error('editor.encoding_failed'))
   else resolve(b)
  },'image/jpeg',.88))
 }finally{output.width=output.height=0}
}
