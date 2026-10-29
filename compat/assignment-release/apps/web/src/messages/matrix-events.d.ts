/**
 * PhotoBunker E2EE reaction event.
 *
 * matrix-js-sdk 44 deliberately skips encryption for standard m.reaction.
 * Register a separate timeline event with the SDK's extensible event map
 * so the runtime sendEvent overload is checked without unsafe casts.
 */
import 'matrix-js-sdk/lib/@types/event'

declare module 'matrix-js-sdk/lib/@types/event' {
  interface TimelineEvents {
    'org.photobunker.reaction.v2': {
      'org.photobunker.reaction': {
        event_id: string
        key: string
      }
    }
  }
}
