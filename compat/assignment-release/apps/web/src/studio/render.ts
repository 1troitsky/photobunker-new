import { editGeometry, outputPoint } from './geometry'
import type { EditDocument } from './versions'

export function renderEdits(
  image: HTMLImageElement,
  edits: EditDocument,
  maximum = Infinity,
): HTMLCanvasElement {
  const originalWidth = image.naturalWidth,
    originalHeight = image.naturalHeight
  const base = document.createElement('canvas'),
    output = document.createElement('canvas')
  if (
    !originalWidth ||
    !originalHeight ||
    originalWidth * originalHeight > 50_000_000
  )
    throw new Error('editor.invalid_dimensions')
  base.width = edits.rotation % 2 ? originalHeight : originalWidth
  base.height = edits.rotation % 2 ? originalWidth : originalHeight
  const source = base.getContext('2d')!
  source.translate(base.width / 2, base.height / 2)
  source.rotate((edits.rotation * Math.PI) / 2)
  source.scale(edits.mirror ? -1 : 1, 1)
  source.drawImage(image, -originalWidth / 2, -originalHeight / 2)
  const { cropWidth: width, cropHeight: height } = editGeometry(
    originalWidth,
    originalHeight,
    edits,
  )
  const scale = Math.min(1, maximum / Math.max(width, height))
  output.width = Math.max(1, Math.floor(width * scale))
  output.height = Math.max(1, Math.floor(height * scale))
  const context = output.getContext('2d')!
  const nativeFilter = typeof Reflect.get(context, 'filter') === 'string'
  if (nativeFilter)
    context.filter = `brightness(${edits.brightness}%) contrast(${edits.contrast}%) saturate(${edits.saturation}%)`
  context.drawImage(
    base,
    (base.width - width) / 2,
    (base.height - height) / 2,
    width,
    height,
    0,
    0,
    output.width,
    output.height,
  )
  if (nativeFilter) context.filter = 'none'
  else if (
    edits.brightness !== 100 ||
    edits.contrast !== 100 ||
    edits.saturation !== 100
  ) {
    const pixels = context.getImageData(0, 0, output.width, output.height),
      data = pixels.data
    for (let i = 0; i < data.length; i += 4) {
      const r =
        (((data[i]! * edits.brightness) / 100 - 128) * edits.contrast) / 100 +
        128
      const g =
        (((data[i + 1]! * edits.brightness) / 100 - 128) * edits.contrast) /
          100 +
        128
      const b =
        (((data[i + 2]! * edits.brightness) / 100 - 128) * edits.contrast) /
          100 +
        128
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b
      data[i] = luma + ((r - luma) * edits.saturation) / 100
      data[i + 1] = luma + ((g - luma) * edits.saturation) / 100
      data[i + 2] = luma + ((b - luma) * edits.saturation) / 100
    }
    context.putImageData(pixels, 0, 0)
  }
  if (
    edits.strokes?.length ||
    edits.texts?.some((layer) => layer.text.trim())
  ) {
    const annotations = document.createElement('canvas')
    annotations.width = originalWidth
    annotations.height = originalHeight
    const drawing = annotations.getContext('2d')!
    for (const stroke of edits.strokes ?? []) {
      if (!stroke.points.length) continue
      drawing.save()
      drawing.globalCompositeOperation =
        stroke.tool === 'eraser' ? 'destination-out' : 'source-over'
      drawing.globalAlpha = stroke.opacity
      drawing.strokeStyle = drawing.fillStyle = stroke.color
      drawing.lineCap = drawing.lineJoin = 'round'
      const size = stroke.width * Math.min(originalWidth, originalHeight)
      // The pencil has a precise, narrower edge; brush is a broad, soft dab.
      // Blur is rendered into annotations, never into the original source pixels.
      drawing.lineWidth = stroke.tool === 'pencil' ? Math.max(1, size * 0.45) : size
      if (stroke.tool === 'brush') {
        drawing.shadowColor = stroke.color
        drawing.shadowBlur = Math.max(2, size * 0.9)
      }
      const first = stroke.points[0]!
      if (stroke.points.length === 1) {
        drawing.beginPath()
        drawing.arc(
          first.x * originalWidth,
          first.y * originalHeight,
          drawing.lineWidth / 2,
          0,
          Math.PI * 2,
        )
        drawing.fill()
      } else {
        drawing.beginPath()
        drawing.moveTo(first.x * originalWidth, first.y * originalHeight)
        for (const point of stroke.points.slice(1))
          drawing.lineTo(point.x * originalWidth, point.y * originalHeight)
        drawing.stroke()
      }
      drawing.restore()
    }
    drawing.globalCompositeOperation = 'source-over'
    drawing.globalAlpha = 1
    drawing.textAlign = 'left'
    drawing.textBaseline = 'top'
    drawing.lineJoin = 'round'
    for (const layer of edits.texts ?? []) {
      const size = Math.max(10, layer.size * originalWidth)
      drawing.font = `600 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`
      drawing.fillStyle = layer.color
      drawing.strokeStyle = '#000000a0'
      drawing.lineWidth = Math.max(1, size * 0.05)
      drawing.save()
      drawing.translate(layer.x * originalWidth, layer.y * originalHeight)
      drawing.scale(layer.mirror ? -1 : 1, 1)
      drawing.rotate((-(layer.rotation ?? 0) * Math.PI) / 2)
      layer.text
        .split('\n')
        .slice(0, 6)
        .forEach((line, index) => {
          drawing.strokeText(line, 0, index * size * 1.3)
          drawing.fillText(line, 0, index * size * 1.3)
        })
      drawing.restore()
    }
    // The same transform as the photo keeps annotations attached when rotating,
    // mirroring or cropping after drawing. Colour filters affect the photo only.
    source.clearRect(
      -originalWidth / 2,
      -originalHeight / 2,
      originalWidth,
      originalHeight,
    )
    source.drawImage(annotations, -originalWidth / 2, -originalHeight / 2)
    context.drawImage(
      base,
      (base.width - width) / 2,
      (base.height - height) / 2,
      width,
      height,
      0,
      0,
      output.width,
      output.height,
    )
    annotations.width = annotations.height = 0
  }
  if (edits.text.trim()) {
    const lines = edits.text.trim().split('\n').slice(0, 6),
      size = Math.max(12, Math.round(output.width * 0.045))
    context.font = `600 ${size}px -apple-system, BlinkMacSystemFont, sans-serif`
    context.textAlign = 'center'
    context.lineJoin = 'round'
    context.lineWidth = Math.max(2, size * 0.12)
    context.strokeStyle = '#000000c0'
    context.fillStyle = '#ffffff'
    lines.forEach((line, i) => {
      const y = output.height - size * (lines.length - i) * 1.3
      context.strokeText(line, output.width / 2, y, output.width * 0.9)
      context.fillText(line, output.width / 2, y, output.width * 0.9)
    })
  }
  const shapes = edits.shapes ?? []
  for (const shape of [
    ...shapes.filter((s) => s.kind !== 'redact'),
    ...shapes.filter((s) => s.kind === 'redact'),
  ]) {
    const corners = [
      shape.from,
      shape.to,
      { x: shape.from.x, y: shape.to.y },
      { x: shape.to.x, y: shape.from.y },
    ].map((point) => outputPoint(point, originalWidth, originalHeight, edits))
    const x = Math.min(...corners.map((p) => p.x)) * output.width,
      y = Math.min(...corners.map((p) => p.y)) * output.height
    const w = Math.max(...corners.map((p) => p.x)) * output.width - x,
      h = Math.max(...corners.map((p) => p.y)) * output.height - y
    context.save()
    context.globalAlpha = 1
    context.globalCompositeOperation = 'source-over'
    context.strokeStyle = shape.color
    context.lineWidth = Math.max(
      1,
      shape.width * Math.min(output.width, output.height),
    )
    if (shape.kind === 'redact') {
      context.fillStyle = '#000000'
      context.fillRect(
        Math.floor(x) - 1,
        Math.floor(y) - 1,
        Math.ceil(w) + 3,
        Math.ceil(h) + 3,
      )
    } else if (shape.kind === 'ellipse') {
      context.beginPath()
      context.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      if (shape.filled === true) {
        context.fillStyle = shape.color
        context.fill()
      }
      context.stroke()
    } else {
      if (shape.filled === true) {
        context.fillStyle = shape.color
        context.fillRect(x, y, w, h)
      }
      context.strokeRect(x, y, w, h)
    }
    context.restore()
  }
  if (edits.watermark?.trim()) {
    const size = Math.max(12, Math.round(output.width * 0.025))
    context.save()
    context.globalAlpha = 1
    context.font = `600 ${size}px sans-serif`
    context.textAlign = 'right'
    context.textBaseline = 'bottom'
    context.lineWidth = Math.max(2, size * 0.1)
    context.strokeStyle = '#000'
    context.fillStyle = '#fff'
    context.strokeText(
      edits.watermark.trim().slice(0, 100),
      output.width - size,
      output.height - size,
      output.width * 0.9,
    )
    context.fillText(
      edits.watermark.trim().slice(0, 100),
      output.width - size,
      output.height - size,
      output.width * 0.9,
    )
    context.restore()
  }
  base.width = base.height = 0
  return output
}
