// Separate low-resolution object for thumbnail-only grants; never CSS protection.
export async function restrictedThumbnail(source: Blob): Promise<Blob> {
  const image = new Image(),
    url = URL.createObjectURL(source),
    canvas = document.createElement('canvas')
  try {
    image.src = url
    await image.decode()
    const scale = Math.min(
      1,
      80 / Math.max(image.naturalWidth, image.naturalHeight),
    )
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (!context) throw new Error('workspace.thumbnail')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new Error('workspace.thumbnail')),
        'image/jpeg',
        0.8,
      ),
    )
  } finally {
    URL.revokeObjectURL(url)
    image.src = ''
    canvas.width = canvas.height = 0
  }
}
