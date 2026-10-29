declare module 'piexifjs' {
  type Directory = Record<number, unknown>
  export type Exif = { '0th': Directory; Exif: Directory; GPS: Directory; Interop: Directory; '1st': Directory; thumbnail: string | null }
  const piexif: { load(data: string): Exif; dump(data: Partial<Exif>): string }
  export default piexif
}
