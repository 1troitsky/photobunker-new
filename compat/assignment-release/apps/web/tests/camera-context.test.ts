import { beforeEach, expect, it, vi } from 'vitest'
import { cameraContext } from '../src/crypto/camera'
import { cachedContext, loadProtection, prepareContext, protectionEnabled } from '../src/crypto/store'
import { ensureAccountPhotos } from '../src/identity/setup'
import { checkCapture } from '../src/crypto/protocol'
import { account } from '../src/identity/store'
vi.mock('../src/identity/store', async () => ({ account: (await import('vue')).ref({ id: 'fixture' }) }))
vi.mock('../src/crypto/store', async () => ({ cachedContext: vi.fn(), loadProtection: vi.fn(), prepareContext: vi.fn(), protectionEnabled: (await import('vue')).ref(true) }))
vi.mock('../src/identity/setup', () => ({ ensureAccountPhotos: vi.fn() }))
vi.mock('../src/crypto/protocol', () => ({ checkCapture: vi.fn() }))
const context = { plan: { statement: {} } } as unknown as Awaited<ReturnType<typeof prepareContext>>
beforeEach(() => { vi.resetAllMocks(); account.value = { id: 'fixture' } as never; protectionEnabled.value = true; vi.mocked(cachedContext).mockRejectedValue(new Error('expired')); vi.mocked(prepareContext).mockResolvedValue(context) })
it('automatically prepares missing or expired personal camera context', async () => { await expect(cameraContext()).resolves.toBe(context); expect(prepareContext).toHaveBeenCalledWith(undefined, false); expect(checkCapture).toHaveBeenCalledWith(context.plan, 'fixture') })
it('uses a valid cached capture-only plan offline without accessing private archive keys', async () => { vi.mocked(cachedContext).mockResolvedValue(context); await cameraContext('task'); expect(loadProtection).not.toHaveBeenCalled(); expect(ensureAccountPhotos).not.toHaveBeenCalled(); expect(prepareContext).not.toHaveBeenCalled() })
it('connects photo setup automatically when it has not yet completed', async () => { protectionEnabled.value = false; await cameraContext(); expect(ensureAccountPhotos).toHaveBeenCalledOnce() })
it('preserves shared-recipient review rather than automatically approving participants', async () => { vi.mocked(prepareContext).mockRejectedValue(new Error('crypto.review_required')); await expect(cameraContext('task')).rejects.toThrow('crypto.review_required'); expect(prepareContext).toHaveBeenCalledWith('task', false) })
it('rejects a preparation completing after an account switch', async () => { vi.mocked(prepareContext).mockImplementation(async () => { account.value = { id: 'different' } as never; return context }); await expect(cameraContext()).rejects.toThrow('crypto.cancelled'); expect(checkCapture).not.toHaveBeenCalled() })
