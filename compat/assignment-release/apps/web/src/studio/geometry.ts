import type { EditDocument, Point, TextLayer } from './versions'

export function editGeometry(width: number, height: number, edits: EditDocument) {
  const rotatedWidth = edits.rotation % 2 ? height : width, rotatedHeight = edits.rotation % 2 ? width : height
  const ratio = edits.crop === 'native' ? rotatedWidth / rotatedHeight : Number(edits.crop.split(':')[0]) / Number(edits.crop.split(':')[1])
  const cropWidth = Math.min(rotatedWidth, rotatedHeight * ratio), cropHeight = cropWidth / ratio
  return { rotatedWidth, rotatedHeight, cropWidth, cropHeight, left: (rotatedWidth - cropWidth) / 2, top: (rotatedHeight - cropHeight) / 2 }
}
export function imagePoint(point: Point, width: number, height: number, edits: EditDocument): Point {
  const shape = editGeometry(width, height, edits)
  const x = shape.left + point.x * shape.cropWidth - shape.rotatedWidth / 2, y = shape.top + point.y * shape.cropHeight - shape.rotatedHeight / 2
  const rotation = edits.rotation % 4
  const originalX = rotation === 1 ? y : rotation === 2 ? -x : rotation === 3 ? -y : x
  const originalY = rotation === 1 ? -x : rotation === 2 ? -y : rotation === 3 ? x : y
  return { x: ((edits.mirror ? -originalX : originalX) + width / 2) / width, y: (originalY + height / 2) / height }
}
export function outputPoint(point: Point, width: number, height: number, edits: EditDocument): Point {
  const shape = editGeometry(width, height, edits), rotation = edits.rotation % 4
  const x = (point.x * width - width / 2) * (edits.mirror ? -1 : 1), y = point.y * height - height / 2
  const rotatedX = rotation === 1 ? -y : rotation === 2 ? -x : rotation === 3 ? y : x
  const rotatedY = rotation === 1 ? x : rotation === 2 ? -y : rotation === 3 ? -x : y
  return { x: (rotatedX + shape.rotatedWidth / 2 - shape.left) / shape.cropWidth, y: (rotatedY + shape.rotatedHeight / 2 - shape.top) / shape.cropHeight }
}

// Text is horizontal in the visible canvas when created, then follows later
// image transforms. Positions and hit testing use the same source coordinates.
export function textCorners(layer: TextLayer, width: number, height: number): Point[] {
  const size = layer.size * width, lines = layer.text.split('\n')
  const textWidth = Math.max(...lines.map(line => line.length), 1) * size * .65, textHeight = Math.max(1, lines.length) * size * 1.3
  const angle = (layer.rotation ?? 0) * Math.PI / 2, cosine = Math.cos(angle), sine = Math.sin(angle)
  return [{ x: 0, y: 0 }, { x: textWidth, y: 0 }, { x: 0, y: textHeight }, { x: textWidth, y: textHeight }].map(point => ({ x: layer.x + (cosine * point.x + sine * point.y) * (layer.mirror ? -1 : 1) / width, y: layer.y + (-sine * point.x + cosine * point.y) / height }))
}
export function textContains(layer: TextLayer, point: Point, width: number, height: number): boolean {
  const x = (point.x - layer.x) * width * (layer.mirror ? -1 : 1), y = (point.y - layer.y) * height
  const angle = (layer.rotation ?? 0) * Math.PI / 2, localX = Math.cos(angle) * x - Math.sin(angle) * y, localY = Math.sin(angle) * x + Math.cos(angle) * y
  const size = layer.size * width, lines = layer.text.split('\n')
  return localX >= 0 && localY >= 0 && localX <= Math.max(...lines.map(line => line.length), 1) * size * .65 && localY <= Math.max(1, lines.length) * size * 1.3
}
