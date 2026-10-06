import { useEffect, useState } from 'react'

// Renders `value` as a QR code image. The generator is loaded on demand so it
// is not part of the main bundle; the value never leaves the browser.
export function QrCode({ value, size = 176, label = 'QR code' }) {
  const [src, setSrc] = useState('')

  useEffect(() => {
    let cancelled = false
    import('qrcode')
      .then((module) => (module.default ?? module).toString(value, { type: 'svg', margin: 1, width: size }))
      .then((svg) => { if (!cancelled) setSrc(`data:image/svg+xml;utf8,${encodeURIComponent(svg)}`) })
      .catch(() => { if (!cancelled) setSrc('') })
    return () => { cancelled = true }
  }, [value, size])

  if (!src) return null
  return <img src={src} width={size} height={size} alt={label} className="rounded-md border bg-white p-1" />
}
