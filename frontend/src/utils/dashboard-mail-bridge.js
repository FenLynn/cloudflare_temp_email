import { api } from '../api'

const REQUEST_TYPE = 'sci-dashboard:mail-notifications:request'
const RESPONSE_TYPE = 'sci-mail:notifications:response'
const READY_TYPE = 'sci-mail:notifications:ready'
const DEFAULT_DASHBOARD_ORIGINS = [
  'https://thisisatemplinkurlfortestverify.660415.xyz',
  'http://localhost:5173',
  'http://127.0.0.1:5173',
]

function getAllowedOrigins() {
  const configured = String(import.meta.env.VITE_DASHBOARD_ORIGINS || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean)
  return new Set(configured.length ? configured : DEFAULT_DASHBOARD_ORIGINS)
}

function getBridgeParentOrigin() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('dashboard_bridge') !== '1') return ''
  const parentOrigin = String(params.get('parent_origin') || '').trim()
  return getAllowedOrigins().has(parentOrigin) ? parentOrigin : ''
}

export function initDashboardMailBridge() {
  const parentOrigin = getBridgeParentOrigin()
  if (!parentOrigin || window.parent === window) return () => {}

  const handleMessage = async event => {
    if (event.source !== window.parent || event.origin !== parentOrigin) return
    if (event.data?.type !== REQUEST_TYPE || !event.data?.requestId) return

    const requestId = String(event.data.requestId)
    const limit = Math.min(Math.max(Number(event.data.limit) || 8, 1), 20)
    try {
      const payload = await api.fetch(`/admin/notifications?limit=${limit}`)
      window.parent.postMessage({ type: RESPONSE_TYPE, requestId, ok: true, payload }, parentOrigin)
    } catch (error) {
      window.parent.postMessage({
        type: RESPONSE_TYPE,
        requestId,
        ok: false,
        error: error?.message || '邮件读取失败',
      }, parentOrigin)
    }
  }

  window.addEventListener('message', handleMessage)
  window.parent.postMessage({ type: READY_TYPE }, parentOrigin)
  return () => window.removeEventListener('message', handleMessage)
}
