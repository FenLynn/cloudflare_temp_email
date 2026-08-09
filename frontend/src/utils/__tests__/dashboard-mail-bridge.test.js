// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../api', () => ({
  api: { fetch: vi.fn() },
}))

import { api } from '../../api'
import { initDashboardMailBridge } from '../dashboard-mail-bridge'

describe('dashboard mail bridge', () => {
  const originalParent = window.parent
  let parentWindow

  beforeEach(() => {
    parentWindow = { postMessage: vi.fn() }
    Object.defineProperty(window, 'parent', { configurable: true, value: parentWindow })
    vi.stubEnv('VITE_DASHBOARD_ORIGINS', window.location.origin)
    window.history.replaceState({}, '', `/?dashboard_bridge=1&parent_origin=${encodeURIComponent(window.location.origin)}`)
    api.fetch.mockReset()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    Object.defineProperty(window, 'parent', { configurable: true, value: originalParent })
    window.history.replaceState({}, '', '/')
  })

  it('returns compact notifications only to the configured parent', async () => {
    const payload = { items: [{ id: 7, subject: 'Login code', verificationCode: '123456' }] }
    api.fetch.mockResolvedValue(payload)
    const dispose = initDashboardMailBridge()

    expect(parentWindow.postMessage).toHaveBeenCalledWith(
      { type: 'sci-mail:notifications:ready' },
      window.location.origin,
    )

    window.dispatchEvent(new MessageEvent('message', {
      source: parentWindow,
      origin: window.location.origin,
      data: { type: 'sci-dashboard:mail-notifications:request', requestId: 'mail-1', limit: 50 },
    }))
    await vi.waitFor(() => expect(api.fetch).toHaveBeenCalledWith('/admin/notifications?limit=20'))
    expect(parentWindow.postMessage).toHaveBeenLastCalledWith({
      type: 'sci-mail:notifications:response',
      requestId: 'mail-1',
      ok: true,
      payload,
    }, window.location.origin)

    dispose()
  })
})
