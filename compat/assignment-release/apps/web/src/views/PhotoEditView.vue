<script setup lang="ts">
import { account } from '../identity/store'
import { securityError } from '../crypto/text'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router'
import { guardReload } from '../studio/unsaved'
import ScreenHeader from '../components/ScreenHeader.vue'
import AppIcon from '../components/AppIcon.vue'
import FormTabs from '../components/FormTabs.vue'
import PhotoDetailsFields from '../components/PhotoDetailsFields.vue'
import { readPhoto, updatePhoto } from '../server/photos'
import { libraryChanged } from '../local/library'
import type { Photo } from '../local/photos'
import {
  emptyEdits,
  listPhotoVersions,
  savePhotoVersion,
  type EditDocument,
  type Point,
  type Stroke,
  type TextLayer,
  type ShapeLayer,
} from '../studio/versions'
import {
  detailsFor,
  detailsDirty,
  detailsChanges,
  PhotoDetailsError,
} from '../studio/details'
import { clone } from '../studio/model'
import { renderEdits } from '../studio/render'
import {
  imagePoint,
  outputPoint,
  textCorners,
  textContains,
} from '../studio/geometry'
import { stripEncodedMetadata } from '../profiles/image'
import { capturePresetLabel, internalAuthor } from '../studio/disclosure'
import { s } from '../studio/text'
const route = useRoute(),
  router = useRouter(),
  photo = ref<Photo>(),
  preview = ref<HTMLCanvasElement>(),
  textEditor = ref<HTMLTextAreaElement>()
const edits = ref<EditDocument>(emptyEdits()),
  tab = ref('image'),
  compare = ref(false),
  busy = ref(false),
  error = ref(''),
  ready = ref(false),
  versionNotice = ref('')
const backPath = computed(
  () =>
    `/gallery/${route.params.id}${route.query.version ? `?version=${route.query.version}` : ''}`,
)
const data = ref(detailsFor()),
  dataSaved = ref(false)
const tool = ref<Stroke['tool']>('brush'),
  ink = ref('#e94545'),
  width = ref(6),
  opacity = ref(100),
  selectedText = ref(''),
  shapeTool = ref<ShapeLayer['kind']>('rectangle'),
  shapeFilled = ref(false)
const history = ref<EditDocument[]>([emptyEdits()]),
  cursor = ref(0)
const tabs = computed(() =>
  (
    [
      'image',
      'brightness',
      'drawing',
      'text',
      'shapes',
      'privacy',
      'photoData',
    ] as const
  ).map((id) => ({ id, label: s(id) })),
)
function signature(value: EditDocument) {
  return JSON.stringify({
    ...value,
    texts: value.texts.filter((layer) => layer.text.trim()),
    strokes: value.strokes.filter((stroke) => stroke.points.length),
  })
}
const initial = ref(signature(emptyEdits()))
const imageDirty = computed(() => signature(edits.value) !== initial.value)
const dataDirty = computed(() => detailsDirty(photo.value, data.value))
const dirty = computed(() => imageDirty.value || dataDirty.value)
guardReload(dirty, busy)
const image = new Image()
let originalUrl = '',
  saved = false,
  alive = true,
  frame = 0
let pointer:
  | {
      id: number
      before: EditDocument
      shape?: ShapeLayer
      stroke?: Stroke
      offset?: Point
    }
  | undefined
const activeText = computed(() =>
  edits.value.texts.find((layer) => layer.id === selectedText.value),
)
const textPosition = computed(() =>
  activeText.value
    ? outputPoint(
        activeText.value,
        image.naturalWidth,
        image.naturalHeight,
        edits.value,
      )
    : { x: 0.1, y: 0.1 },
)
function checkpoint() {
  const value = JSON.stringify(edits.value)
  if (value !== JSON.stringify(history.value[cursor.value])) {
    history.value = [
      ...history.value.slice(0, cursor.value + 1),
      clone(edits.value),
    ].slice(-40)
    cursor.value = history.value.length - 1
  }
}
function undo() {
  if (pointer || busy.value) return
  if (cursor.value > 0) edits.value = clone(history.value[--cursor.value]!)
}
function redo() {
  if (pointer || busy.value) return
  if (cursor.value < history.value.length - 1)
    edits.value = clone(history.value[++cursor.value]!)
}
function paint() {
  if (!ready.value || !preview.value || !alive) return
  try {
    const canvas = renderEdits(
      image,
      compare.value ? emptyEdits() : edits.value,
      1200,
    )
    // Reassigning canvas dimensions resets its bitmap and implicitly releases
    // pointer capture. Keep the live drawing gesture intact when the output
    // dimensions did not actually change.
    if (preview.value.width !== canvas.width) preview.value.width = canvas.width
    if (preview.value.height !== canvas.height) preview.value.height = canvas.height
    preview.value.getContext('2d')!.drawImage(canvas, 0, 0)
    if (tab.value === 'text' && activeText.value && !compare.value) {
      const context = preview.value.getContext('2d')!,
        location = outputPoint(
          activeText.value,
          image.naturalWidth,
          image.naturalHeight,
          edits.value,
        )
      const corners = textCorners(
        activeText.value,
        image.naturalWidth,
        image.naturalHeight,
      ).map((point) =>
        outputPoint(
          point,
          image.naturalWidth,
          image.naturalHeight,
          edits.value,
        ),
      )
      const left = Math.min(...corners.map((point) => point.x)) * canvas.width,
        top = Math.min(...corners.map((point) => point.y)) * canvas.height,
        right = Math.max(...corners.map((point) => point.x)) * canvas.width,
        bottom = Math.max(...corners.map((point) => point.y)) * canvas.height
      context.save()
      context.strokeStyle = '#bfcaff'
      context.lineWidth = 2
      context.setLineDash([5, 5])
      context.strokeRect(left - 4, top - 4, right - left + 8, bottom - top + 8)
      context.beginPath()
      context.arc(
        location.x * canvas.width,
        location.y * canvas.height,
        3,
        0,
        Math.PI * 2,
      )
      context.stroke()
      context.restore()
    }
    canvas.width = canvas.height = 0
  } catch {
    error.value = s('failed')
  }
}
watch(
  edits,
  () => {
    versionNotice.value = ''
  },
  { deep: true },
)
watch(
  [edits, compare, selectedText, tab],
  () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(paint)
  },
  { deep: true },
)
function point(event: PointerEvent): Point {
  const box = preview.value!.getBoundingClientRect()
  return imagePoint(
    {
      x: Math.max(0, Math.min(1, (event.clientX - box.left) / box.width)),
      y: Math.max(0, Math.min(1, (event.clientY - box.top) / box.height)),
    },
    image.naturalWidth,
    image.naturalHeight,
    edits.value,
  )
}
function focusText() {
  // Explicitly callable from a click to open the iOS software keyboard.
  textEditor.value?.focus()
}
function chooseText(id: string) {
  selectedText.value = id
  void nextTick(focusText)
}
function addText() {
  if (edits.value.texts.length >= 20) return
  const anchor = imagePoint(
    { x: 0.1, y: 0.15 },
    image.naturalWidth,
    image.naturalHeight,
    edits.value,
  )
  const layer: TextLayer = {
    rotation: edits.value.rotation,
    mirror: edits.value.mirror,
    id: crypto.randomUUID(),
    text: '',
    ...anchor,
    size: 0.05,
    color: '#ffffff',
  }
  edits.value.texts.push(layer)
  selectedText.value = layer.id
  checkpoint()
  // Vue must mount the new textarea before it can receive focus.
  void nextTick(focusText)
}
watch(tab, (value) => {
  if (value === 'text' && ready.value) {
    if (!edits.value.texts.length) addText()
    else if (!activeText.value) selectedText.value = edits.value.texts[0]!.id
  }
})
function down(event: PointerEvent) {
  if (
    !ready.value ||
    busy.value ||
    compare.value ||
    !['drawing', 'text', 'shapes', 'privacy'].includes(tab.value) ||
    event.button !== 0 ||
    pointer
  )
    return
  event.preventDefault()
  preview.value!.setPointerCapture(event.pointerId)
  pointer = { id: event.pointerId, before: clone(edits.value) }
  const value = point(event)
  if (tab.value === 'shapes' || tab.value === 'privacy') {
    edits.value.shapes ??= []
    if (edits.value.shapes.length >= 100) {
      pointer = undefined
      preview.value!.releasePointerCapture(event.pointerId)
      return
    }
    const shape: ShapeLayer = {
      id: crypto.randomUUID(),
      kind: tab.value === 'privacy' ? 'redact' : shapeTool.value,
      from: value,
      to: value,
      color: ink.value,
      width: width.value / 1000,
      filled: tab.value === 'shapes' && shapeFilled.value,
    }
    edits.value.shapes.push(shape)
    pointer.shape = edits.value.shapes.at(-1)
  } else if (tab.value === 'drawing') {
    if (edits.value.strokes.length >= 300) {
      pointer = undefined
      preview.value!.releasePointerCapture(event.pointerId)
      return
    }
    const stroke: Stroke = {
      id: crypto.randomUUID(),
      tool: tool.value,
      color: ink.value,
      width: width.value / 1000,
      opacity: opacity.value / 100,
      points: [value],
    }
    edits.value.strokes.push(stroke)
    pointer.stroke = edits.value.strokes.at(-1)
  } else {
    // Hit test in source coordinates. Annotation positions remain attached to
    // the original photo across rotation, mirror and crop changes.
    const hit = [...edits.value.texts]
      .reverse()
      .find((layer) =>
        textContains(layer, value, image.naturalWidth, image.naturalHeight),
      )
    if (hit) {
      selectedText.value = hit.id
      pointer.offset = { x: value.x - hit.x, y: value.y - hit.y }
    } else {
      if (!activeText.value) addText()
      activeText.value!.x = value.x
      activeText.value!.y = value.y
      pointer.offset = { x: 0, y: 0 }
    }
  }
}
function move(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return
  const value = point(event)
  if (pointer.shape) pointer.shape.to = value
  else if (pointer.stroke) {
    // Coalesced pen/touch samples remove gaps at high input frequencies.
    // The final event is included even when coalesced events are unavailable.
    const samples = event.getCoalescedEvents?.() ?? [event]
    for (const sample of samples.length ? samples : [event]) {
      if (pointer.stroke.points.length >= 4096) break
      pointer.stroke.points.push(point(sample))
    }
    if (pointer.stroke.points.length < 4096 &&
        (samples.at(-1)?.clientX !== event.clientX ||
         samples.at(-1)?.clientY !== event.clientY))
      pointer.stroke.points.push(value)
  } else if (activeText.value && pointer.offset) {
    activeText.value.x = value.x - pointer.offset.x
    activeText.value.y = value.y - pointer.offset.y
  }
}
function up(event: PointerEvent, cancel = false) {
  if (!pointer || pointer.id !== event.pointerId) return
  const gesture = pointer
  if (cancel) edits.value = gesture.before
  else {
    // Pointerup can be the only delivered movement on slow touch devices.
    const final = point(event)
    if (gesture.shape) gesture.shape.to = final
    else if (gesture.stroke && gesture.stroke.points.length < 4096) {
      const last = gesture.stroke.points.at(-1)!
      if (last.x !== final.x || last.y !== final.y)
        gesture.stroke.points.push(final)
    } else if (gesture.offset && activeText.value) {
      activeText.value.x = final.x - gesture.offset.x
      activeText.value.y = final.y - gesture.offset.y
    }
  }
  pointer = undefined
  if (preview.value?.hasPointerCapture(event.pointerId))
    preview.value.releasePointerCapture(event.pointerId)
  checkpoint()
  if (!cancel && gesture.offset) void nextTick(focusText)
}
function lostCapture(event: PointerEvent) {
  if (!pointer || pointer.id !== event.pointerId) return
  // pointercancel performs an explicit rollback first. A standalone capture
  // loss only means no more samples will arrive, so preserve and checkpoint
  // the points already shown instead of erasing the entire gesture.
  pointer = undefined
  checkpoint()
}
function setPosition(axis: 'x' | 'y', value: number) {
  if (!activeText.value || !Number.isFinite(value)) return
  value = Math.max(0, Math.min(100, value))
  const location = imagePoint(
    { ...textPosition.value, [axis]: value / 100 },
    image.naturalWidth,
    image.naturalHeight,
    edits.value,
  )
  activeText.value.x = location.x
  activeText.value.y = location.y
  checkpoint()
}
function keyboard(event: KeyboardEvent) {
  if (
    event.ctrlKey || event.metaKey
  ) {
    if (event.key.toLowerCase() === 'z') {
      event.preventDefault()
      if (event.shiftKey) redo()
      else undo()
    }
    return
  }
  if (tab.value !== 'text' || !activeText.value ||
      !event.key.startsWith('Arrow')) return
  event.preventDefault()
  const step = event.shiftKey ? 5 : 1
  const axis = ['ArrowLeft', 'ArrowRight'].includes(event.key) ? 'x' : 'y'
  setPosition(
    axis,
    Math.max(
      0,
      Math.min(
        100,
        textPosition.value[axis] * 100 +
          (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -step : step),
      ),
    ),
  )
}
onMounted(async () => {
  try {
    const result = await readPhoto(String(route.params.id))
    if (result.photo.workspaceAccess && !result.photo.workspaceAccess.edit)
      throw new Error('workspace.denied')
    if (!alive || result.photo.access?.role === 'viewer') return
    photo.value = result.photo
    data.value = detailsFor(result.photo)
    if (route.query.version) {
      const version = (await listPhotoVersions(result.photo)).find(
        (version) => version.id === route.query.version,
      )
      if (!version) throw new Error('version.unavailable')
      edits.value = {
        ...emptyEdits(),
        ...clone(version.edits),
        strokes: clone(version.edits.strokes ?? []),
        texts: clone(version.edits.texts ?? []),
      }
    }
    initial.value = signature(edits.value)
    history.value = [clone(edits.value)]
    selectedText.value = edits.value.texts[0]?.id ?? ''
    originalUrl = URL.createObjectURL(result.blob)
    image.src = originalUrl
    await image.decode()
    if (!alive) return
    ready.value = true
    if (tab.value === 'text' && !edits.value.texts.length) addText()
    await nextTick()
    paint()
  } catch (failure) {
    error.value =
      failure instanceof Error && failure.message === 'version.unavailable'
        ? s('versionUnavailable')
        : s('failed')
  }
})
async function saveDetails() {
  if (!photo.value || busy.value) return
  busy.value = true
  error.value = ''
  dataSaved.value = false
  try {
    photo.value = await updatePhoto(
      photo.value.id,
      detailsChanges(photo.value, data.value),
      photo.value.remoteRevision,
      photo.value,
    )
    data.value = detailsFor(photo.value)
    libraryChanged()
    dataSaved.value = true
  } catch (failure) {
    error.value =
      failure instanceof PhotoDetailsError ? failure.message : s('failed')
  } finally {
    busy.value = false
  }
}
async function save() {
  if (!photo.value || busy.value || !imageDirty.value) return
  if (dataDirty.value) {
    tab.value = 'photoData'
    error.value = s('saveDataFirst')
    return
  }
  busy.value = true
  error.value = ''
  let canvas: HTMLCanvasElement | undefined
  try {
    // Local encrypted version commit precedes any network synchronization.
    // A slow read of the remote photo must not block offline editing.
    const current = photo.value
    // Snapshot pixels and metadata together. UI changes during JPEG encoding
    // must never produce a version whose editable layers differ from its pixels.
    const snapshot = clone(edits.value)
    canvas = renderEdits(image, snapshot)
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas!.toBlob(
        (value) => (value ? resolve(value) : reject(new Error('encode'))),
        'image/jpeg',
        0.94,
      ),
    )
    const version = await savePhotoVersion(
      current,
      await stripEncodedMetadata(blob),
      canvas.width,
      canvas.height,
      snapshot,
      typeof route.query.version === 'string' ? route.query.version : null,
    )
    saved = true
    if (version.sync === 'pending') {
      saved = false
      initial.value = signature(snapshot)
      versionNotice.value = s('versionSavedLocal')
      return
    }
    // A late user change must stay in the editor, not vanish on navigation.
    if (signature(edits.value) !== signature(snapshot)) {
      saved = false
      initial.value = signature(snapshot)
      versionNotice.value = s('versionSaved')
      return
    }
    await router.replace({
      path: `/gallery/${photo.value.id}`,
      query: { version: version.id },
    })
  } catch (failure) {
    error.value =
      failure instanceof Error && failure.message.startsWith('crypto.')
        ? securityError(failure)
        : s('failed')
  } finally {
    if (canvas) canvas.width = canvas.height = 0
    busy.value = false
  }
}
onBeforeRouteLeave(
  () => saved || (!busy.value && (!dirty.value || confirm(s('leave')))),
)
watch(
  () => account.value?.id,
  () => {
    if (photo.value?.accountId) {
      alive = false
      ready.value = false
      photo.value = undefined
      image.src = ''
      if (preview.value) preview.value.width = preview.value.height = 0
      void router.replace('/gallery')
    }
  },
)
onBeforeUnmount(() => {
  alive = false
  cancelAnimationFrame(frame)
  if (originalUrl) URL.revokeObjectURL(originalUrl)
  image.src = ''
  if (preview.value) preview.value.width = preview.value.height = 0
})
</script>
<template>
  <section class="native-screen native-editor photo-editor">
    <ScreenHeader :title="s('editor')" :back="backPath"
      ><button
        class="app-icon-button"
        :aria-label="s('compare')"
        :aria-pressed="compare"
        @click="compare = !compare"
      >
        <AppIcon name="gallery" /></button
    ></ScreenHeader>
    <div
      class="editor-image-stage"
      :class="{
        'interactive-canvas':
          ['drawing', 'text', 'shapes', 'privacy'].includes(tab) && !compare,
      }"
    >
      <canvas
        v-if="ready"
        ref="preview"
        tabindex="0"
        :aria-label="s('preview')"
        @pointerdown="down"
        @pointermove="move"
        @pointerup="up($event)"
        @pointercancel="up($event, true)"
        @lostpointercapture="lostCapture"
        @keydown="keyboard"
      />
      <p v-else class="field-hint">{{ error || s('preview') }}</p>
    </div>
    <div class="editor-history">
      <button
        class="app-icon-button"
        :aria-label="s('undo')"
        :disabled="cursor === 0 || busy"
        @click="undo"
      >
        <AppIcon name="back" /></button
      ><button
        class="app-icon-button"
        :aria-label="s('redo')"
        :disabled="cursor === history.length - 1 || busy"
        @click="redo"
      >
        <AppIcon name="arrow" /></button
      ><button
        class="quiet-button"
        :disabled="!imageDirty || busy"
        @click="
          () => {
            edits = emptyEdits()
            checkpoint()
          }
        "
      >
        {{ s('resetEdits') }}
      </button>
    </div>
    <FormTabs v-model="tab" :items="tabs" />
    <div class="native-form photo-edit-controls">
      <fieldset :disabled="busy" class="editor-tools">
        <div v-if="tab === 'image'" class="form-section">
          <div class="image-tool-row">
            <button
              class="secondary-button"
              @click="
                () => {
                  edits.rotation = (edits.rotation + 1) % 4
                  checkpoint()
                }
              "
            >
              <AppIcon name="rotate" />{{ s('rotate') }}</button
            ><button
              class="secondary-button"
              :aria-pressed="edits.mirror"
              @click="
                () => {
                  edits.mirror = !edits.mirror
                  checkpoint()
                }
              "
            >
              <AppIcon name="flip" />{{ s('mirror') }}
            </button>
          </div>
          <label
            >{{ s('crop')
            }}<select
              :aria-label="s('crop')"
              v-model="edits.crop"
              @change="checkpoint"
            >
              <option value="native">{{ s('native') }}</option>
              <option
                v-for="ratio in ['1:1', '4:3', '3:2', '16:9']"
                :key="ratio"
              >
                {{ ratio }}
              </option>
            </select></label
          >
        </div>
        <div v-else-if="tab === 'brightness'" class="form-section">
          <label
            v-for="field in ['brightness', 'contrast', 'saturation'] as const"
            :key="field"
            >{{ s(field) }} · {{ edits[field]
            }}<input
              v-model.number="edits[field]"
              type="range"
              min="50"
              max="150"
              @change="checkpoint"
          /></label>
        </div>
        <div v-else-if="tab === 'drawing'" class="form-section">
          <div class="drawing-tools">
            <button
              v-for="value in ['brush', 'pencil', 'eraser'] as const"
              :key="value"
              class="secondary-button"
              :aria-pressed="tool === value"
              @click="tool = value"
            >
              <AppIcon :name="value" />{{ s(value) }}
            </button>
          </div>
          <div class="two-fields">
            <label>{{ s('color') }}<input v-model="ink" type="color" /></label
            ><label
              >{{ s('strokeWidth') }} · {{ width
              }}<input v-model.number="width" type="range" min="1" max="50"
            /></label>
          </div>
          <label
            >{{ s('opacity') }} · {{ opacity }}%<input
              v-model.number="opacity"
              type="range"
              min="10"
              max="100"
          /></label>
          <p class="field-hint">{{ s('drawingHint') }}</p>
        </div>
        <div v-else-if="tab === 'text'" class="form-section">
          <div class="text-layers">
            <button
              v-for="(layer, index) in edits.texts"
              :key="layer.id"
              class="quiet-button"
              :aria-pressed="selectedText === layer.id"
              @click="chooseText(layer.id)"
            >
              {{ s('text') }} {{ index + 1 }}</button
            ><button
              class="quiet-button"
              :disabled="edits.texts.length >= 20"
              @click="addText"
            >
              <AppIcon name="plus" />{{ s('addText') }}
            </button>
          </div>
          <template v-if="activeText"
            ><button type="button" class="quiet-button editor-focus-text"
              @click="focusText">{{ s('editText') }}</button><label
              >{{ s('text')
              }}<textarea
                ref="textEditor"
                v-model="activeText.text"
                rows="2"
                maxlength="200"
                @change="checkpoint"
              />
            </label>
            <div class="two-fields">
              <label
                >{{ s('color')
                }}<input
                  v-model="activeText.color"
                  type="color"
                  @change="checkpoint" /></label
              ><label
                >{{ s('textSize')
                }}<input
                  v-model.number="activeText.size"
                  type="range"
                  min="0.015"
                  max="0.15"
                  step="0.005"
                  @change="checkpoint"
              /></label>
            </div>
            <div class="two-fields">
              <label
                >{{ s('horizontal')
                }}<input
                  :value="Math.round(textPosition.x * 100)"
                  type="number"
                  min="0"
                  max="100"
                  @input="
                    ($event) => {
                      setPosition(
                        'x',
                        Number(($event.target as HTMLInputElement).value),
                      )
                    }
                  " /></label
              ><label
                >{{ s('vertical')
                }}<input
                  :value="Math.round(textPosition.y * 100)"
                  type="number"
                  min="0"
                  max="100"
                  @input="
                    ($event) => {
                      setPosition(
                        'y',
                        Number(($event.target as HTMLInputElement).value),
                      )
                    }
                  "
              /></label>
            </div>
            <button
              class="quiet-button subtle-danger"
              @click="
                () => {
                  edits.texts = edits.texts.filter(
                    (layer) => layer.id !== selectedText,
                  )
                  selectedText = edits.texts[0]?.id ?? ''
                  checkpoint()
                }
              "
            >
              {{ s('removeText') }}
            </button></template
          ><label v-if="edits.text"
            >{{ s('text')
            }}<textarea
              v-model="edits.text"
              maxlength="200"
              @change="checkpoint"
            />
          </label>
          <p class="field-hint">{{ s('textHint') }}</p>
        </div>
        <div
          v-else-if="tab === 'shapes' || tab === 'privacy'"
          class="form-section"
        >
          <template v-if="tab === 'shapes'">
            <label
              >{{ s('shape')
              }}<select v-model="shapeTool">
                <option value="rectangle">{{ s('rectangle') }}</option>
                <option value="ellipse">{{ s('ellipse') }}</option>
              </select></label
            >
            <label>{{ s('color') }}<input v-model="ink" type="color" /></label>
            <label
              >{{ s('strokeWidth')
              }}<input v-model.number="width" type="range" min="1" max="50"
            /></label>
            <label class="editor-fill-toggle"><input v-model="shapeFilled" type="checkbox" />
              {{ s('fill') }}</label>
          </template>
          <p class="field-hint">
            {{ s(tab === 'privacy' ? 'redactHint' : 'shapeHint') }}
          </p>
          <label v-if="tab === 'privacy'"
            >{{ s('watermark')
            }}<input
              v-model="edits.watermark"
              maxlength="100"
              @change="checkpoint"
          /></label>
          <p v-if="tab === 'privacy'" class="field-hint">
            {{ s('redactOriginalHint') }}
          </p>
        </div>
        <div v-else-if="photo" class="form-section">
          <dl class="native-facts">
            <div>
              <dt>{{ s('capturePreset') }}</dt>
              <dd>{{ capturePresetLabel(photo) }}</dd>
            </div>
            <div v-if="internalAuthor(photo)">
              <dt>{{ s('author') }}</dt>
              <dd>{{ internalAuthor(photo) }}</dd>
            </div>
          </dl>
          <PhotoDetailsFields v-model="data" :photo="photo" :busy="busy" />
          <p v-if="dataSaved && !dataDirty" class="field-hint" role="status">
            {{ s('dataSaved') }}
          </p>
        </div>
      </fieldset>
      <p v-if="versionNotice" class="field-hint" role="status">
        {{ versionNotice }}
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p class="field-hint">{{ s('editorHint') }}</p>
    </div>
    <footer class="editor-footer">
      <button
        class="secondary-button"
        :disabled="busy"
        @click="router.push(backPath)"
      >
        {{ s('cancel') }}</button
      ><button
        v-if="tab === 'photoData'"
        class="primary-button"
        :disabled="busy || !dataDirty"
        @click="saveDetails"
      >
        {{ s(busy ? 'saving' : 'save') }}</button
      ><button
        v-else
        class="primary-button"
        :disabled="busy || !ready || !imageDirty"
        @click="save"
      >
        {{ s(busy ? 'saving' : 'saveCopy') }}
      </button>
    </footer>
  </section>
</template>
